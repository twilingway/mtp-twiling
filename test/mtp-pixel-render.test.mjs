import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/model/", import.meta.url));
const modules = new Map();
function load(relative) {
  const file = path.resolve(root, relative).replace(/\.js$/, ".ts");
  assert.ok(file.startsWith(root));
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
  }).outputText;
  new vm.Script(`(function(require,module,exports){${code}\n})`, {
    filename: file
  }).runInThisContext()(
    (specifier) => load(path.relative(root, path.resolve(path.dirname(file), specifier))),
    module,
    module.exports
  );
  return module.exports;
}
const { ScreenLineSimplifier } = load("screen-line-simplifier.ts");
const { MtpModel, MTP_COMBINED_PERIODS } = load("mtp.ts");

function simplify(points, tolerance) {
  if (!points.length) return [];
  const output = [points[0]],
    line = new ScreenLineSimplifier(tolerance);
  line.reset(points[0].x, points[0].y);
  for (const point of points.slice(1)) {
    const emitted = line.push(point.x, point.y);
    if (emitted) output.push(emitted);
  }
  const last = line.finish();
  if (last) output.push(last);
  return output;
}
function verifyError(points, output, tolerance) {
  assert.deepEqual(output[0], points[0]);
  assert.deepEqual(output.at(-1), points.at(-1));
  let segment = 0,
    maxError = 0;
  for (const point of points) {
    while (segment + 1 < output.length - 1 && output[segment + 1].x < point.x) segment++;
    const start = output[segment],
      end = output[segment + 1] ?? start;
    const projected =
      end.x === start.x
        ? start.y
        : start.y + ((end.y - start.y) * (point.x - start.x)) / (end.x - start.x);
    maxError = Math.max(maxError, Math.abs(projected - point.y));
  }
  assert.ok(maxError <= tolerance + 1e-9, `${maxError} exceeds ${tolerance}`);
  return maxError;
}
function context(record = true) {
  const paths = [];
  let vertices = 0;
  return {
    paths,
    get vertices() {
      return vertices;
    },
    save() {},
    restore() {},
    setLineDash() {},
    beginPath() {},
    stroke() {},
    moveTo(x, y) {
      vertices++;
      if (record) paths.push([{ x, y }]);
    },
    lineTo(x, y) {
      vertices++;
      if (record) paths.at(-1).push({ x, y });
    }
  };
}
function modelWith(length) {
  const model = new MtpModel();
  model.reset(
    Array.from({ length }, (_, index) => ({
      close: 150 + index / 500 + Math.sin(index / 41) * 7 + Math.sin(index / 3) / 5
    })),
    MTP_COMBINED_PERIODS
  );
  return model;
}

test("streaming corridor bounds every original vertex at fractional physical pixels", () => {
  for (const dpr of [1, 1.25, 2, 2.75, 3])
    for (const shape of ["straight", "curve", "saw", "spike"]) {
      const points = Array.from({ length: 10000 }, (_, index) => ({
        x: index * 0.03,
        y:
          shape === "straight"
            ? 50 + index * 0.07
            : shape === "curve"
              ? 50 + Math.sin(index / 40) * 7
              : shape === "saw"
                ? (index % 2) * 10
                : index === 5000
                  ? 100
                  : 0
      }));
      const output = simplify(points, 0.25 / dpr);
      verifyError(points, output, 0.25 / dpr);
      assert.ok(output.length <= points.length);
      if (shape === "straight") assert.equal(output.length, 2);
      if (shape === "spike") assert.ok(output.some((point) => point.y === 100));
      if (shape === "saw") assert.equal(output.length, points.length);
    }
});

test("duplicate, reversing and numerically degenerate X preserve remaining actual vertices", () => {
  for (const xs of [
    [0, 0, 1, 2],
    [0, -1, 1, 2],
    [1, 1 + Number.EPSILON, 2, 3]
  ]) {
    const points = xs.map((x, index) => ({ x, y: index * index }));
    assert.deepEqual(simplify(points, 0.25), points);
  }
  assert.deepEqual(simplify([{ x: 0, y: 10 }], 0.25), [{ x: 0, y: 10 }]);
});

test("dense MTP retains every path endpoint and gap within 0.25 physical pixels", () => {
  const model = modelWith(7000);
  const extrema = JSON.stringify(model.extrema(0, 6999));
  for (const dpr of [1, 2.75, 3])
    for (const logarithmic of [false, true]) {
      const x = (index) => (index === 3400 ? null : (index * 294) / 7000);
      const y = (price) =>
        price > 155 && price < 155.01
          ? NaN
          : logarithmic
            ? 900 - Math.log(price) * 100
            : 600 - price * 3;
      const original = context(),
        reduced = context();
      model.draw(original, 0, 7200, x, y);
      model.draw(reduced, 0, 7200, x, y, { verticalPixelRatio: dpr });
      assert.equal(reduced.paths.length, original.paths.length);
      for (let path = 0; path < original.paths.length; path++)
        verifyError(original.paths[path], reduced.paths[path], 0.25 / dpr);
      assert.ok(reduced.vertices < original.vertices / 3);
    }
  assert.equal(JSON.stringify(model.extrema(0, 6999)), extrema);
  assert.equal(model.data.length, 7000);
});

test("normal spacing, missing DPR and invalid DPR preserve exact original MTP geometry", () => {
  const model = modelWith(700);
  for (const spacing of [1, 1.001, 5]) {
    const x = (index) => index * spacing,
      y = (price) => 600 - price * 3;
    const original = context(),
      actual = context();
    model.draw(original, 0, 699, x, y);
    model.draw(actual, 0, 699, x, y, { verticalPixelRatio: 2.75 });
    assert.deepEqual(actual.paths, original.paths);
  }
  for (const bitmap of [undefined, { verticalPixelRatio: NaN }, { verticalPixelRatio: 0 }]) {
    const x = (index) => index / 10,
      y = (price) => 600 - price * 3;
    const original = context(),
      actual = context();
    model.draw(original, 0, 699, x, y);
    model.draw(actual, 0, 699, x, y, bitmap);
    assert.deepEqual(actual.paths, original.paths);
  }
});

test("dense rendering uses the existing sample phase and current tail after replace/append", () => {
  const model = modelWith(700),
    data = [...model.data];
  for (const change of ["initial", "replace", "append"]) {
    if (change === "replace") {
      data[data.length - 1] = { close: 400 };
      model.update(data);
    }
    if (change === "append") {
      data.push({ close: 50 });
      model.update(data);
    }
    const original = context(),
      actual = context();
    model.draw(
      original,
      0,
      900,
      (i) => i / 10,
      (p) => p
    );
    model.draw(
      actual,
      0,
      900,
      (i) => i / 10,
      (p) => p,
      { verticalPixelRatio: 3 }
    );
    assert.equal(original.paths.length, actual.paths.length);
    for (let path = 0; path < original.paths.length; path++)
      verifyError(original.paths[path], actual.paths[path], 0.25 / 3);
  }
});

test("adversarial oscillations take one corridor step per input with no recursion or vertex cap", () => {
  const points = Array.from({ length: 200000 }, (_, index) => ({ x: index / 1000, y: index % 2 }));
  const output = simplify(points, 0.01);
  assert.equal(output.length, points.length);
  assert.deepEqual(output[123456], points[123456]);
});

test(
  "optional synthetic draw benchmark excludes canvas/GPU and reports retained vertex counts",
  {
    skip: !process.env.MTP_PIXEL_BENCHMARK
  },
  (t) => {
    const model = modelWith(19583),
      frames = 20;
    const x = (i) => (i * 294) / model.data.length,
      y = (p) => 600 - p * 3;
    const original = context(false),
      reduced = context(false);
    for (let i = 0; i < 3; i++) {
      model.draw(original, 0, 19582, x, y);
      model.draw(reduced, 0, 19582, x, y, { verticalPixelRatio: 2.75 });
    }
    const oldStart = original.vertices,
      newStart = reduced.vertices;
    const start = performance.now();
    for (let i = 0; i < frames; i++) model.draw(original, 0, 19582, x, y);
    const middle = performance.now();
    for (let i = 0; i < frames; i++)
      model.draw(reduced, 0, 19582, x, y, { verticalPixelRatio: 2.75 });
    const end = performance.now();
    t.diagnostic(
      JSON.stringify({
        frames,
        old: { vertices: (original.vertices - oldStart) / frames, ms: (middle - start) / frames },
        current: { vertices: (reduced.vertices - newStart) / frames, ms: (end - middle) / frames }
      })
    );
  }
);

import test from "node:test";
import assert from "node:assert/strict";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";
const { MtpModel, MTP_COMBINED_PERIODS, lightweightMtp } = createSourceLoader()("model/mtp.js");

function modelWith(length = 1100) {
  const model = new MtpModel();
  model.reset(
    Array.from({ length }, (_, index) => ({ close: 100 + index / 10 + Math.sin(index / 7) * 20 })),
    MTP_COMBINED_PERIODS
  );
  return model;
}
function canvas(record = true) {
  const paths = [];
  return {
    paths,
    save() {},
    restore() {},
    scale() {},
    setLineDash() {},
    beginPath() {
      if (record) paths.push([]);
    },
    moveTo(x, y) {
      if (record) paths.at(-1).push(["move", x, y]);
    },
    lineTo(x, y) {
      if (record) paths.at(-1).push(["line", x, y]);
    },
    stroke() {}
  };
}
// Independent copy of the original draw traversal, including its warmup and sampling phase.
function originalDraw(model, ctx, from, to, xFor, yFor) {
  const start = Math.max(0, Math.floor(from) - 1);
  const end = Math.min(model.data.length - 1, Math.ceil(to) + 1);
  if (end < start) return;
  const step = Math.max(1, Math.ceil((end - start) / 3000));
  for (const period of model.periods) {
    ctx.beginPath();
    let begun = false;
    for (let i = Math.max(start, period - 1); i <= end; i += step) {
      const x = xFor(i),
        y = yFor(model.sma(i, period));
      if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) {
        begun = false;
        continue;
      }
      if (!begun) {
        ctx.moveTo(x, y);
        begun = true;
      } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
function primitiveFor(model, project, mode, range = { from: 650.2, to: 1050.8 }) {
  let primitive;
  let yCalls = 0,
    xCalls = 0;
  const series = {
    priceToCoordinate(price) {
      yCalls++;
      return project(price);
    },
    attachPrimitive(value) {
      primitive = value;
    },
    detachPrimitive() {}
  };
  if (mode !== undefined) series.priceScale = () => ({ options: () => ({ mode }) });
  lightweightMtp(
    {
      timeScale: () => ({
        getVisibleLogicalRange: () => range,
        logicalToCoordinate(index) {
          xCalls++;
          return index * 4.25 - 2400;
        }
      })
    },
    series,
    model
  );
  return {
    primitive,
    draw(ctx) {
      primitive
        .paneViews()[0]
        .renderer()
        .drawBackground({
          useBitmapCoordinateSpace(draw) {
            draw({ context: ctx, horizontalPixelRatio: 2, verticalPixelRatio: 1.5 });
          }
        });
    },
    counts: () => ({ x: xCalls, y: yCalls })
  };
}
function sameGeometry(actual, expected, tolerance = 0) {
  assert.equal(actual.length, expected.length);
  for (let line = 0; line < actual.length; line++) {
    assert.equal(actual[line].length, expected[line].length);
    for (let point = 0; point < actual[line].length; point++) {
      const a = actual[line][point],
        b = expected[line][point];
      assert.equal(a[0], b[0]);
      assert.equal(a[1], b[1]);
      assert.ok(Math.abs(a[2] - b[2]) <= tolerance, `${a[2]} vs ${b[2]}`);
    }
  }
}

test("cached X preserves every original vertex, warmup, sampling phase and native gaps", () => {
  for (const [length, from, to] of [
    [1100, -10, 900],
    [8000, 0, 8005],
    [1100, 1000.2, 1300]
  ]) {
    const model = modelWith(length),
      actual = canvas(),
      expected = canvas();
    const calls = new Map();
    const x = (i) => (i % 17 === 0 ? null : i % 19 === 0 ? NaN : i * 4.25);
    const y = (p) => (p > 196 && p < 198 ? null : Math.log(p));
    originalDraw(model, expected, from, to, x, y);
    model.draw(
      actual,
      from,
      to,
      (i) => {
        calls.set(i, (calls.get(i) ?? 0) + 1);
        return x(i);
      },
      y
    );
    sameGeometry(actual.paths, expected.paths);
    assert.ok([...calls.values()].every((count) => count === 1));
    assert.ok([...calls.keys()].every((index) => index >= 0 && index < length));
  }
});

test("LW affine modes match native projection and reduce Y calls to three per frame", () => {
  const model = modelWith();
  for (const mode of [0, 2, 3])
    for (const base of [175, -175])
      for (const inverted of [false, true]) {
        const project = (price) => {
          const transformed =
            mode === 0
              ? price
              : ((100 * (price - base)) / base + (mode === 3 ? 100 : 0)) * (base < 0 ? -1 : 1);
          return (inverted ? 1 : -1) * (transformed - 80) * 2.17 + 516;
        };
        const fixture = primitiveFor(model, project, mode),
          actual = canvas(),
          expected = canvas();
        originalDraw(model, expected, 650.2, 1050.8, (i) => i * 4.25 - 2400, project);
        fixture.draw(actual);
        sameGeometry(actual.paths, expected.paths, 1e-7);
        assert.deepEqual(fixture.counts(), { x: 404, y: 3 });
        assert.deepEqual(fixture.primitive.autoscaleInfo(650.2, 1050.8), {
          priceRange: model.extrema(650.2, 1050.8)
        });
      }
});

test("logarithmic and unknown modes always use native Y, including discontinuities", () => {
  const model = modelWith();
  for (const mode of [1, 47, undefined]) {
    const project = (p) =>
      p > 190 && p < 192 ? NaN : p > 193 && p < 194 ? null : 400 - Math.log(p) * 45;
    const fixture = primitiveFor(model, project, mode),
      actual = canvas(),
      expected = canvas();
    originalDraw(model, expected, 650.2, 1050.8, (i) => i * 4.25 - 2400, project);
    fixture.draw(actual);
    sameGeometry(actual.paths, expected.paths);
    assert.deepEqual(fixture.counts(), { x: 404, y: 404 * 151 });
  }
});

test("flat, unavailable, nonfinite and unexpectedly nonlinear scales retain native Y", () => {
  for (const variant of ["flat", "null", "infinity", "nonlinear", "tiny"]) {
    const model = modelWith();
    if (variant === "flat" || variant === "tiny")
      model.reset(
        Array.from({ length: 1100 }, (_, i) => ({
          close: variant === "flat" ? 0 : 1e-10 + i * 1e-20
        })),
        MTP_COMBINED_PERIODS
      );
    const project = (p) =>
      variant === "null"
        ? null
        : variant === "infinity"
          ? Infinity
          : variant === "nonlinear"
            ? p * p
            : 600 - p * 3;
    const fixture = primitiveFor(model, project, 0),
      actual = canvas(),
      expected = canvas();
    originalDraw(model, expected, 650.2, 1050.8, (i) => i * 4.25 - 2400, project);
    fixture.draw(actual);
    sameGeometry(actual.paths, expected.paths);
    assert.ok(fixture.counts().y >= 404 * 151);
  }
});

test("projection is rebuilt on each frame and after tail replace/append", () => {
  const model = modelWith(),
    data = [...model.data];
  let factor = 2;
  const project = (p) => 700 - p * factor;
  const fixture = primitiveFor(model, project, 0, { from: 1050, to: 1300 });
  for (const change of ["initial", "scale", "replace", "append"]) {
    if (change === "scale") factor = -7;
    if (change === "replace") {
      data[data.length - 1] = { close: 300 };
      model.update(data);
    }
    if (change === "append") {
      data.push({ close: 500 });
      model.update(data);
    }
    const actual = canvas(),
      expected = canvas();
    originalDraw(model, expected, 1050, 1300, (i) => i * 4.25 - 2400, project);
    fixture.draw(actual);
    sameGeometry(actual.paths, expected.paths, 1e-7);
  }
});

test("nonfinite source values retain original gaps without contaminating affine output", () => {
  const model = modelWith();
  const data = [...model.data];
  data[data.length - 1] = { close: NaN };
  model.update(data);
  const project = (price) => 700 - price * 2;
  const fixture = primitiveFor(model, project, 0, { from: 1050, to: 1300 });
  const actual = canvas(),
    expected = canvas();
  originalDraw(model, expected, 1050, 1300, (i) => i * 4.25 - 2400, project);
  fixture.draw(actual);
  sameGeometry(actual.paths, expected.paths, 1e-7);
  assert.equal(fixture.counts().y, 3 + 151);
});

test("LW raster integration paints the original full paths once at native DPR", () => {
  const originalCanvas = globalThis.OffscreenCanvas;
  const surfaces = [];
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.context = { ...canvas(), setTransform() {} };
      surfaces.push(this);
    }
    getContext() {
      return this.context;
    }
  };
  try {
    const model = modelWith(),
      expected = canvas();
    const xFor = (index) => index / 10,
      yFor = (price) => 500 - price * 2;
    model.draw(expected, 0, 1099, xFor, yFor);
    let primitive,
      blits = 0;
    const series = {
      priceToCoordinate: yFor,
      priceScale: () => ({ options: () => ({ mode: 0 }) }),
      attachPrimitive(value) {
        primitive = value;
      },
      detachPrimitive() {}
    };
    const mtp = lightweightMtp(
      {
        timeScale: () => ({
          getVisibleLogicalRange: () => ({ from: 0, to: 1099 }),
          logicalToCoordinate: xFor
        })
      },
      series,
      model
    );
    const context = {
      ...canvas(false),
      translate() {},
      drawImage() {
        blits++;
      },
      globalCompositeOperation: "source-over",
      filter: "none",
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      lineCap: "butt",
      lineJoin: "miter",
      miterLimit: 10
    };
    const target = {
      useBitmapCoordinateSpace(draw) {
        draw({
          context,
          horizontalPixelRatio: 2.75,
          verticalPixelRatio: 2.75,
          bitmapSize: { width: 808, height: 1848 }
        });
      }
    };
    const renderer = primitive.paneViews()[0].renderer();
    renderer.drawBackground(target);
    assert.equal(surfaces.length, 1);
    sameGeometry(surfaces[0].context.paths, expected.paths, 1e-7);
    renderer.drawBackground(target);
    assert.equal(surfaces.length, 1, "unchanged geometry reuses the full-quality settled image");
    assert.equal(blits, 2);
    mtp.destroy();
    assert.equal(surfaces[0].width, 0);
  } finally {
    if (originalCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = originalCanvas;
  }
});

test(
  "optional pure draw microbenchmark (synthetic SDK conversion; excludes canvas/GPU)",
  {
    skip: !process.env.MTP_BENCHMARK
  },
  (t) => {
    const model = modelWith(10000),
      from = 640,
      to = 1640,
      frames = 300;
    const ctx = canvas(false),
      project = (p) => 720 - (p - 100) * 2.17;
    let oldX = 0,
      oldY = 0;
    const x = (i) => {
      oldX++;
      return i * 4.25 - 2400;
    };
    const y = (p) => {
      oldY++;
      return project(p);
    };
    const fixture = primitiveFor(model, project, 0, { from, to });
    for (let i = 0; i < 20; i++) {
      originalDraw(model, ctx, from, to, x, y);
      fixture.draw(ctx);
    }
    oldX = oldY = 0;
    const before = fixture.counts();
    const start = performance.now();
    for (let i = 0; i < frames; i++) originalDraw(model, ctx, from, to, x, y);
    const middle = performance.now();
    for (let i = 0; i < frames; i++) fixture.draw(ctx);
    const end = performance.now(),
      after = fixture.counts();
    t.diagnostic(
      JSON.stringify({
        frames,
        verticesPerFrame: oldY / frames,
        old: {
          xPerFrame: oldX / frames,
          yPerFrame: oldY / frames,
          msPerFrame: (middle - start) / frames
        },
        current: {
          xPerFrame: (after.x - before.x) / frames,
          yPerFrame: (after.y - before.y) / frames,
          msPerFrame: (end - middle) / frames
        }
      })
    );
  }
);

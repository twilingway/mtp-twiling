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
  new vm.Script(`(function(require,module,exports){${code}\n})`).runInThisContext()(
    (specifier) => load(path.relative(root, path.resolve(path.dirname(file), specifier))),
    module,
    module.exports
  );
  return module.exports;
}
const { MtpModel, MTP_COMBINED_PERIODS, lightweightMtp } = load("mtp.ts");
const { MtpRasterCache } = load("mtp-raster-cache.ts");

function fixture(fit = false) {
  const model = new MtpModel();
  const data = Array.from({ length: 15083 }, (_, i) => ({
    timestamp: i * 1800000,
    open: 100 + i / 100,
    high: 110 + i / 100,
    low: 90 + i / 100,
    close: 100 + i / 100 + Math.sin(i / 11),
    volume: 100
  }));
  model.reset(data, []);
  const counts = { extrema: 0, bounds: 0, x: 0, y: 0, scope: 0, canvas: 0 };
  const extrema = model.extrema.bind(model);
  model.extrema = (from, to) => {
    counts.extrema++;
    counts.bounds += Math.max(
      0,
      Math.min(model.bounds.length, Math.ceil(to) + 1) - Math.max(0, Math.floor(from))
    );
    return extrema(from, to);
  };
  const context = new Proxy(
    {
      globalCompositeOperation: "source-over",
      filter: "none",
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0
    },
    {
      get(target, key) {
        return key in target
          ? target[key]
          : () => {
              counts.canvas++;
            };
      }
    }
  );
  let primitive;
  const mtp = lightweightMtp(
    {
      timeScale: () => ({
        getVisibleLogicalRange: () => (fit ? { from: 0, to: 15082 } : { from: 14800, to: 15028 }),
        logicalToCoordinate(i) {
          counts.x++;
          return fit ? i * 0.0155 : (i - 14800) * 1.015;
        }
      })
    },
    {
      priceScale: () => ({ options: () => ({ mode: 0 }) }),
      priceToCoordinate(p) {
        counts.y++;
        return 800 - p * 2;
      },
      attachPrimitive(p) {
        primitive = p;
      },
      detachPrimitive() {}
    },
    model
  );
  const renderer = primitive.paneViews()[0].renderer();
  const draw = () =>
    renderer.drawBackground({
      useBitmapCoordinateSpace(action) {
        counts.scope++;
        action({
          context,
          horizontalPixelRatio: 2.75,
          verticalPixelRatio: 2.75,
          bitmapSize: { width: 808, height: 1848 }
        });
      }
    });
  return { model, data, counts, draw, primitive, mtp };
}

test("empty periods never enter canvas, bounds, projection or primitive bitmap scope", () => {
  for (const fit of [false, true]) {
    const f = fixture(fit);
    f.model.bounds = new Proxy(f.model.bounds, {
      get() {
        throw new Error("bounds read");
      }
    });
    f.draw();
    assert.equal(f.primitive.autoscaleInfo(0, 15082), null);
    assert.deepEqual(f.counts, { extrema: 0, bounds: 0, x: 0, y: 0, scope: 0, canvas: 0 });
    const forbidden = () => {
      throw new Error("disabled work");
    };
    const context = new Proxy({}, { get: forbidden });
    f.model.draw(context, 0, 15082, forbidden, forbidden);
    assert.equal(MtpModel.prototype.extrema.call(f.model, 0, 15082), null);
    const raster = new MtpRasterCache(forbidden);
    assert.equal(
      raster.draw({
        model: f.model,
        get scope() {
          return {};
        }
      }),
      false
    );
    raster.destroy();
    f.mtp.destroy();
  }
});

test("disabled tail update and append retain close SMA inputs for exact reenable", () => {
  const f = fixture();
  const beforeRevision = f.model.revision;
  f.model.update(f.data);
  assert.equal(f.model.revision, beforeRevision + 1, "revision no-op semantics are preserved");
  f.data[f.data.length - 1] = { ...f.data.at(-1), close: 400 };
  f.model.update(f.data);
  f.data.push({ ...f.data.at(-1), timestamp: f.data.at(-1).timestamp + 1800000, close: 70 });
  f.model.update(f.data);
  const last = f.data.length - 1;
  for (const period of MTP_COMBINED_PERIODS) {
    const independent = f.data.slice(-period).reduce((sum, bar) => sum + bar.close, 0) / period;
    assert.ok(Math.abs(f.model.sma(last, period) - independent) < 1e-7);
  }
  f.model.reset(f.data, MTP_COMBINED_PERIODS);
  const fresh = new MtpModel();
  fresh.reset(f.data, MTP_COMBINED_PERIODS);
  assert.deepEqual(f.model.bounds, fresh.bounds);
  assert.deepEqual(f.model.prefix, fresh.prefix);
  f.mtp.destroy();
});

function recordingContext() {
  const paths = [];
  return {
    paths,
    globalCompositeOperation: "source-over",
    filter: "none",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    lineCap: "butt",
    lineJoin: "miter",
    miterLimit: 10,
    save() {},
    restore() {},
    translate() {},
    scale() {},
    drawImage() {},
    setTransform() {},
    setLineDash() {},
    beginPath() {
      paths.push({ points: [] });
    },
    moveTo(x, y) {
      paths.at(-1).points.push(["M", x, y]);
    },
    lineTo(x, y) {
      paths.at(-1).points.push(["L", x, y]);
    },
    stroke() {
      Object.assign(paths.at(-1), {
        color: this.strokeStyle,
        width: this.lineWidth,
        alpha: this.globalAlpha
      });
    }
  };
}

function heavyFixture() {
  const f = fixture();
  f.model.reset(f.data, MTP_COMBINED_PERIODS);
  f.model.styleKey = "mtpAll";
  f.model.styles = { mtpAll: { color: "#abcdef", opacity: 0.43, width: 2 } };
  let timer,
    paints = 0;
  const captures = [],
    surfaces = [],
    view = new EventTarget(),
    container = new EventTarget();
  container.ownerDocument = { defaultView: view };
  const cache = new MtpRasterCache(() => {}, container, {
    delay(action) {
      timer = action;
      return 1;
    },
    cancel() {
      timer = undefined;
    },
    canvas(width, height) {
      const surface = {
        width,
        height,
        context: recordingContext(),
        getContext() {
          return this.context;
        }
      };
      surfaces.push(surface);
      return surface;
    }
  });
  function frame(from = 14600, to = 14828, pan = 0, yScale = 1) {
    const xFor = (i) => (i - 14600) * 1.015 + pan,
      yFor = (p) => (600 - p * 2) * yScale;
    return {
      model: f.model,
      from,
      to,
      mode: 0,
      xFor,
      yFor,
      scope: {
        context: recordingContext(),
        bitmapSize: { width: 620, height: 1848 },
        horizontalPixelRatio: 2.75,
        verticalPixelRatio: 2.75
      },
      paint(ctx, captureFrom = from, captureTo = to) {
        paints++;
        captures.push({ from: captureFrom, to: captureTo });
        f.model.draw(ctx, captureFrom, captureTo, xFor, yFor);
      }
    };
  }
  return {
    ...f,
    cache,
    frame,
    captures,
    surfaces,
    paints: () => paints,
    input(type) {
      (type === "pointerdown" ? container : view).dispatchEvent(
        Object.assign(new Event(type), { pointerId: 1, button: 0 })
      );
    },
    settle() {
      const action = timer;
      timer = undefined;
      action?.();
    },
    destroy() {
      cache.destroy();
      f.mtp.destroy();
    }
  };
}

function clippedSegments(points, width) {
  const output = [];
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1],
      b = points[index];
    if (b[0] === "M" || b[1] < 0 || a[1] > width) continue;
    const x0 = Math.max(0, a[1]),
      x1 = Math.min(width, b[1]);
    const at = (x) => a[2] + ((x - a[1]) / (b[1] - a[1])) * (b[2] - a[2]);
    output.push([x0, at(x0), x1, at(x1)]);
  }
  return output;
}

test("ordinary heavy pan/Y preview hits padded capture and settled paths retain all 151 styled lines", () => {
  const f = heavyFixture(),
    initial = f.frame();
  assert.equal(
    f.cache.draw(initial),
    false,
    "expanded capture leaves the settled frame to native draw"
  );
  assert.ok(f.captures[0].from < initial.from && f.captures[0].to > initial.to);
  assert.equal(f.surfaces[0].context.paths.length, 151);
  f.input("pointerdown");
  const moved = f.frame(14595, 14823, 5.075, 1.01);
  for (let i = 0; i < 20; i++) assert.equal(f.cache.draw(moved), true);
  assert.equal(
    f.cache.draw(f.frame(14595, 14823, 5.075, 2)),
    true,
    "2x price scale uses the same covered preview"
  );
  assert.equal(f.cache.draw(moved), true);
  assert.equal(
    f.paints(),
    1,
    "pan changes required indices but stays inside captured logical padding"
  );
  f.input("pointerup");
  f.settle();
  assert.equal(f.cache.draw(moved), false, "settled frame always uses the exact native range");
  assert.equal(f.paints(), 2);
  assert.equal(f.surfaces[0].width, 0);
  const expected = recordingContext();
  f.model.draw(expected, moved.from, moved.to, moved.xFor, moved.yFor);
  const actual = f.surfaces[1].context.paths;
  assert.equal(actual.length, 151);
  for (let line = 0; line < 151; line++) {
    assert.deepEqual(
      clippedSegments(actual[line].points, 620 / 2.75),
      clippedSegments(expected.paths[line].points, 620 / 2.75),
      "left and right boundary intersection segments match native geometry exactly"
    );
    assert.deepEqual(
      actual[line].points.filter((p) => p[1] >= 0 && p[1] <= 620 / 2.75),
      expected.paths[line].points.filter((p) => p[1] >= 0 && p[1] <= 620 / 2.75)
    );
    for (const key of ["color", "width", "alpha"])
      assert.equal(actual[line][key], expected.paths[line][key]);
  }
  assert.ok(f.surfaces[1].width * f.surfaces[1].height * 4 <= 16 * 1024 * 1024);
  f.destroy();
});

test("ordinary cache handles affine modes, DPR/style/history invalidation and refused oversized frames", () => {
  for (const mode of [0, 2, 3]) {
    const f = heavyFixture(),
      frame = { ...f.frame(), mode };
    assert.equal(f.cache.draw(frame), false);
    f.model.styles.mtpAll.color = "#123456";
    assert.equal(f.cache.draw(frame), false);
    assert.equal(f.paints(), 2);
    f.model.resetRevision++;
    f.cache.draw(frame);
    assert.equal(f.paints(), 3);
    f.model.data.push({ ...f.model.data.at(-1), timestamp: 999999999 });
    f.cache.draw(frame);
    assert.equal(f.paints(), 4);
    f.cache.draw({ ...frame, scope: { ...frame.scope, horizontalPixelRatio: 3 } });
    assert.equal(f.paints(), 5);
    for (const bad of [1, undefined]) assert.equal(f.cache.draw({ ...frame, mode: bad }), false);
    assert.equal(
      f.cache.draw({
        ...frame,
        scope: { ...frame.scope, bitmapSize: { width: 2049, height: 2049 } }
      }),
      false
    );
    assert.ok(f.surfaces.every((surface) => surface.width === 0 && surface.height === 0));
    f.destroy();
  }
});

test(
  "optional normal heavy CPU replay compares native paths with warm affine raster submission",
  {
    skip: !process.env.MTP_EMPTY_BENCHMARK
  },
  (t) => {
    const f = heavyFixture(),
      frame = f.frame(),
      frames = 300;
    // Use real model math with a counting sink; no chart, real canvas, rasterization or GPU timing.
    let vertices = 0,
      strokes = 0;
    const ctx = {
      save() {},
      restore() {},
      setLineDash() {},
      beginPath() {},
      moveTo() {
        vertices++;
      },
      lineTo() {
        vertices++;
      },
      stroke() {
        strokes++;
      }
    };
    const native = () => f.model.draw(ctx, frame.from, frame.to, frame.xFor, frame.yFor);
    for (let i = 0; i < 30; i++) native();
    vertices = strokes = 0;
    const before = performance.now();
    for (let i = 0; i < frames; i++) native();
    const nativeMs = (performance.now() - before) / frames;
    f.cache.draw(frame);
    f.input("pointerdown");
    const warm = performance.now();
    for (let i = 0; i < frames; i++) {
      const delta = (i % 10) / 10;
      f.cache.draw(f.frame(14600 - delta, 14828 - delta, delta * 1.015, 1.005));
    }
    const cacheMs = (performance.now() - warm) / frames;
    t.diagnostic(
      JSON.stringify({
        frames,
        nativeMs,
        warmSubmissionMs: cacheMs,
        nativeVerticesPerFrame: vertices / frames,
        nativeStrokesPerFrame: strokes / frames,
        warmRerasterizations: f.paints() - 1
      })
    );
    assert.equal(f.paints(), 1);
    f.destroy();
  }
);

test("ordinary lightweight work stays native and empty raster clears allocated storage before probes", () => {
  const f = heavyFixture();
  f.model.reset(f.data, [4]);
  assert.equal(f.cache.draw(f.frame()), false);
  assert.equal(f.surfaces.length, 0);
  f.model.reset(f.data, MTP_COMBINED_PERIODS);
  assert.equal(f.cache.draw(f.frame()), false);
  f.model.periods = [];
  const forbidden = () => {
    throw new Error("empty raster projection");
  };
  assert.equal(
    f.cache.draw({ ...f.frame(), xFor: forbidden, yFor: forbidden, paint: forbidden }),
    false
  );
  assert.equal(f.surfaces[0].width, 0);
  f.destroy();
});

test("ordinary heavy missing edge coverage rerasterizes; sampled captures retain native range", () => {
  const f = heavyFixture();
  f.cache.draw(f.frame());
  f.input("pointerdown");
  f.cache.draw(f.frame(14300, 14528, 304.5));
  assert.equal(f.paints(), 2, "new edge is outside the captured logical indices");
  const sampled = f.frame(10000, 14000);
  f.cache.draw(sampled);
  assert.equal(f.paints(), 3);
  assert.deepEqual(f.captures.at(-1), { from: 10000, to: 14000 });
  f.destroy();
});

test(
  "optional empty-period primitive CPU benchmark (offline model; excludes chart/canvas/GPU)",
  {
    skip: !process.env.MTP_EMPTY_BENCHMARK
  },
  (t) => {
    for (const fit of [false, true]) {
      const f = fixture(fit);
      for (let i = 0; i < 1000; i++) f.draw();
      for (const key of Object.keys(f.counts)) f.counts[key] = 0;
      const frames = 1000,
        batches = [];
      for (let batch = 0; batch < 7; batch++) {
        const start = performance.now();
        for (let i = 0; i < frames; i++) f.draw();
        batches.push((performance.now() - start) / frames);
      }
      t.diagnostic(
        JSON.stringify({
          fit,
          frames: frames * batches.length,
          data: f.data.length,
          medianMs: [...batches].sort((a, b) => a - b)[3],
          batches,
          perFrame: Object.fromEntries(
            Object.entries(f.counts).map(([key, value]) => [key, value / (frames * batches.length)])
          )
        })
      );
      f.mtp.destroy();
    }
  }
);

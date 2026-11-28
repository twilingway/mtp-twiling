import test from "node:test";
import assert from "node:assert/strict";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";
const { MtpRasterCache } = createSourceLoader()("model/mtp-raster-cache.js");

function fixture() {
  const timers = new Map(),
    surfaces = [],
    blits = [],
    transforms = [];
  let timerId = 0,
    paints = 0,
    updates = 0;
  const context = {
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
    translate(...args) {
      transforms.push(["translate", ...args]);
    },
    scale(...args) {
      transforms.push(["scale", ...args]);
    },
    drawImage(...args) {
      blits.push(args);
    }
  };
  const environment = {
    canvas(width, height) {
      const target = {
        width,
        height,
        context: {
          setTransform(...args) {
            transforms.push(["raster", ...args]);
          }
        },
        getContext() {
          return this.context;
        }
      };
      surfaces.push(target);
      return target;
    },
    delay(action) {
      timers.set(++timerId, action);
      return timerId;
    },
    cancel(id) {
      timers.delete(id);
    }
  };
  const view = new EventTarget(),
    container = new EventTarget();
  container.ownerDocument = { defaultView: view };
  const cache = new MtpRasterCache(() => updates++, container, environment);
  const model = {
    revision: 1,
    resetRevision: 1,
    data: Array.from({ length: 1000 }, (_, i) => ({ timestamp: i * 1000, close: 20 })),
    periods: [4],
    styleKey: "mtpAll",
    styles: { mtpAll: { color: "#123456", opacity: 0.65, width: 1 } },
    extrema: () => ({ minValue: 10, maxValue: 30 })
  };
  const frame = {
    scope: {
      context,
      bitmapSize: { width: 200, height: 200 },
      horizontalPixelRatio: 2,
      verticalPixelRatio: 2
    },
    model,
    from: 0,
    to: 999,
    mode: 0,
    xFor: (i) => i * 0.1,
    yFor: (p) => 100 - p * 2,
    paint() {
      paints++;
    }
  };
  return {
    cache,
    frame,
    model,
    surfaces,
    timers,
    blits,
    transforms,
    paints: () => paints,
    updates: () => updates,
    flush() {
      const actions = [...timers.values()];
      timers.clear();
      for (const action of actions) action();
    },
    input(type, extra = {}) {
      const event = Object.assign(new Event(type), { pointerId: 1, button: 0, ...extra });
      (type === "pointerdown" || type === "wheel" ? container : view).dispatchEvent(event);
    }
  };
}

test("exact geometry cache hits rasterize once and do not postpone idle indefinitely", () => {
  const f = fixture();
  assert.equal(f.cache.draw(f.frame), true);
  assert.equal(f.paints(), 1);
  for (let i = 0; i < 100; i++) assert.equal(f.cache.draw(f.frame), true);
  assert.equal(f.paints(), 1);
  assert.equal(f.blits.length, 101);
  assert.equal(f.timers.size, 0);
  assert.equal(f.surfaces[0].context.lineCap, "butt");
  assert.deepEqual(f.transforms[0], ["raster", 2, 0, 0, 2, 39, 39]);
  f.cache.destroy();
});

test("affine pointer preview reuses native image, then refreshes the exact settled view", () => {
  const f = fixture();
  f.cache.draw(f.frame);
  f.input("pointerdown");
  const moved = { ...f.frame, xFor: (i) => i * 0.11 + 3, yFor: (p) => (100 - p * 2) * 0.9 + 5 };
  for (let i = 0; i < 20; i++) f.cache.draw(moved);
  assert.equal(f.paints(), 1);
  assert.equal(f.timers.size, 0, "a held stationary pointer must not trigger a costly reraster");
  assert.ok(f.transforms.some((t) => t[0] === "scale" && Math.abs(t[1] - 1.1) < 1e-9));
  f.input("pointerup");
  assert.equal(f.timers.size, 1);
  f.cache.draw(moved);
  assert.equal(f.timers.size, 1);
  f.flush();
  assert.equal(f.updates(), 1);
  f.cache.draw(moved);
  assert.equal(f.paints(), 2);
  assert.equal(f.surfaces[0].width, 0, "old storage is released before the replacement allocation");
  f.cache.draw(moved);
  assert.equal(f.paints(), 2);
  f.cache.destroy();
});

test("SDK-compatible integer-only logical projection keeps panning on the warm cache", () => {
  const f = fixture();
  const nativeX = (pan) => (index) => (Number.isInteger(index) ? index * 0.1 + pan : 0);
  f.cache.draw({ ...f.frame, xFor: nativeX(0) });
  f.input("pointerdown");
  for (const pan of [1, 2, 3, 4, 5]) f.cache.draw({ ...f.frame, xFor: nativeX(pan) });
  assert.equal(f.paints(), 1, "all three coordinate probes must be real logical bar indices");
  f.input("pointerup");
  f.flush();
  f.cache.draw({ ...f.frame, xFor: nativeX(5) });
  assert.equal(f.paints(), 2);
  assert.equal(
    f.cache.draw({
      ...f.frame,
      model: { ...f.model, data: f.model.data.slice(0, 2) },
      from: 0,
      to: 1,
      xFor: nativeX(0)
    }),
    false,
    "fewer than three distinct probes use the native path"
  );
  f.cache.destroy();
});

test("wheel, native inertial changes, cancel and blur all settle without leaving a held cache", () => {
  for (const finish of ["pointerup", "pointercancel", "blur", "wheel"]) {
    const f = fixture();
    f.cache.draw(f.frame);
    if (finish !== "wheel") f.input("pointerdown");
    else f.input("wheel", { deltaY: 3, deltaX: 0 });
    const moved = { ...f.frame, xFor: (i) => i * 0.1 + 5 };
    f.cache.draw(moved);
    if (finish !== "wheel") f.input(finish);
    f.flush();
    f.cache.draw(moved);
    assert.equal(f.paints(), 2, finish);
    const inertia = { ...f.frame, xFor: (i) => i * 0.1 + 6 };
    f.cache.draw(inertia);
    assert.equal(f.paints(), 2);
    f.flush();
    f.cache.draw(inertia);
    assert.equal(f.paints(), 3);
    f.cache.destroy();
  }
});

test("tail replacements defer only while held; prepend, append and styles invalidate immediately", () => {
  const f = fixture();
  f.cache.draw(f.frame);
  f.input("pointerdown");
  f.model.revision++;
  f.model.data.at(-1).close = 21;
  f.cache.draw(f.frame);
  assert.equal(f.paints(), 1);
  f.input("pointerup");
  f.flush();
  f.cache.draw(f.frame);
  assert.equal(f.paints(), 2);
  f.input("pointerdown");
  f.model.resetRevision++;
  f.cache.draw(f.frame);
  assert.equal(f.paints(), 3, "historical reset cannot preview a different dataset");
  f.model.data.push({ timestamp: 1000000, close: 22 });
  f.cache.draw({ ...f.frame, to: 1000 });
  assert.equal(f.paints(), 4);
  f.model.styles.mtpAll.color = "#abcdef";
  f.cache.draw({ ...f.frame, to: 1000 });
  assert.equal(f.paints(), 5);
  f.cache.destroy();
});

test("partial-history coverage miss and extreme zoom never reuse missing or blurry geometry", () => {
  const f = fixture();
  const partial = { ...f.frame, from: 300, to: 600 };
  f.cache.draw(partial);
  f.input("pointerdown");
  f.cache.draw({ ...partial, from: 200, to: 500, xFor: (i) => i * 0.1 + 10 });
  assert.equal(f.paints(), 2);
  f.cache.draw({ ...f.frame, xFor: (i) => i * 0.3 });
  assert.equal(f.paints(), 3, "a 3x raster enlargement must rerasterize even during input");
  f.cache.destroy();
});

test("partial views extending past loaded history reuse identical frames without missing real indices", () => {
  const f = fixture();
  const partial = { ...f.frame, from: 100, to: 1100, xFor: (i) => i * 0.1 - 10 };
  for (let repeat = 0; repeat < 3; repeat++) assert.equal(f.cache.draw(partial), true);
  assert.equal(f.paints(), 1, "future whitespace does not require uncached candle geometry");
  f.input("pointerdown");
  f.cache.draw({ ...partial, from: 99.5, to: 1099.5, xFor: (i) => i * 0.1 - 9.95 });
  assert.equal(
    f.paints(),
    2,
    "the predecessor required by the new draw range must still be cached"
  );
  f.cache.destroy();
});

test("unsupported, nonlinear, unavailable and oversized paths fall back without stale cache", () => {
  const f = fixture();
  for (const mode of [undefined, 1, 99]) assert.equal(f.cache.draw({ ...f.frame, mode }), false);
  assert.equal(
    f.cache.draw({ ...f.frame, scope: { ...f.frame.scope, bitmapSize: undefined } }),
    false
  );
  assert.equal(
    f.cache.draw({
      ...f.frame,
      scope: { ...f.frame.scope, bitmapSize: { width: 5000, height: 5000 } }
    }),
    false
  );
  assert.equal(f.surfaces.length, 0);
  f.cache.draw(f.frame);
  const nonlinear = { ...f.frame, yFor: (p) => p * p };
  f.cache.draw(nonlinear);
  assert.equal(f.paints(), 2, "non-affine change must not transform an old raster");
  f.cache.draw({ ...nonlinear, xFor: (i) => i * 0.1 + 1 });
  assert.equal(f.paints(), 2);
  assert.equal(f.cache.draw({ ...f.frame, mode: 1 }), false);
  assert.equal(f.surfaces.at(-1).width, 0);
  f.cache.destroy();
});

test("DPR, dimensions and bounded allocation changes rebuild, teardown releases observers and timers", () => {
  const f = fixture();
  const phone = {
    ...f.frame,
    scope: {
      ...f.frame.scope,
      bitmapSize: { width: 808, height: 1848 },
      horizontalPixelRatio: 2.75,
      verticalPixelRatio: 2.75
    }
  };
  f.cache.draw(phone);
  assert.ok(f.surfaces[0].width * f.surfaces[0].height * 4 <= 16 * 1024 * 1024);
  f.cache.draw({ ...phone, scope: { ...phone.scope, verticalPixelRatio: 3 } });
  assert.equal(f.paints(), 2);
  f.input("wheel", { deltaY: 1, deltaX: 0 });
  assert.equal(f.timers.size, 1);
  f.cache.destroy();
  assert.equal(f.timers.size, 0);
  assert.ok(f.surfaces.every((surface) => surface.width === 0 && surface.height === 0));
  f.input("pointerdown");
  f.input("pointerup");
  assert.equal(f.timers.size, 0);
  assert.equal(f.cache.draw(phone), false);
});

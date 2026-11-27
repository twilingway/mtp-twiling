import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";
import { nativeFixture } from "./native-technical-fixture.mjs";

const load = sourceLoader();
const { OpaqueRectCuller, OpaqueRectUnsupportedError } = load("model/opaque-rect-culler.ts");
function bridgeFixture(control = {}) {
  const instances = [];
  class Tracked extends OpaqueRectCuller {
    constructor(width, height) { super(width, height); instances.push(this); }
    cull() { if (control.failCull) throw new OpaqueRectUnsupportedError(); super.cull(); }
    get memoryBytes() { return control.overBudget ? 17 * 1024 * 1024 : super.memoryBytes; }
  }
  const { createLightweightNativeRectCull } = sourceLoader({
    "model/opaque-rect-culler.ts": { OpaqueRectCuller: Tracked, OpaqueRectUnsupportedError }
  })("charts/lightweight-native-rect-cull.ts");
  return { bridge: createLightweightNativeRectCull(), instances };
}
function surface(width = 24, height = 35) {
  let style = "#000000";
  const writes = [], pixels = Array(width * height).fill("background");
  const context = {
    canvas: { width, height }, globalAlpha: 1, globalCompositeOperation: "source-over",
    filter: "none", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, shadowColor: "rgba(0,0,0,0)",
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getContextAttributes: () => ({ colorSpace: "srgb", colorType: "unorm8" }),
    get fillStyle() { return style; },
    set fillStyle(next) { writes.push(["style", next]); style = next; },
    fillRect(x, y, w, h) {
      writes.push(["rect", x, y, w, h]);
      for (let yy = Math.max(0, Math.min(y, y + h)); yy < Math.min(height, Math.max(y, y + h)); yy++)
        for (let xx = Math.max(0, Math.min(x, x + w)); xx < Math.min(width, Math.max(x, x + w)); xx++)
          pixels[yy * width + xx] = style;
    },
    getImageData: () => assert.fail("bridge must not read back RGBA"),
    putImageData: () => assert.fail("bridge must not upload RGBA"),
    drawImage: () => assert.fail("bridge must not upload a scratch canvas")
  };
  return { context, writes, pixels,
    scope: { context, bitmapSize: { width, height }, horizontalPixelRatio: 1, verticalPixelRatio: 1 } };
}
const rectangles = (items) => (context) => {
  for (const [style, ...rect] of items) { context.fillStyle = style; context.fillRect(...rect); }
};
const draw = rectangles([["#f00", 2, 1, 4, 6]]);

test("bridge preserves winning pixels, negative geometry, clipping and final native style", () => {
  const { bridge, instances } = bridgeFixture();
  const actual = surface(), expected = surface();
  const items = [["#f00", 2, 1, 4, 33], ["#0f0", 5, 7, -4, -4], ["#00f", -2, 28, 8, 10],
    ["transparent", 0, 0, 24, 35], ["#f00", 4, 8, 2, 12]];
  rectangles(items.filter(([style]) => style !== "transparent"))(expected.context);
  assert.equal(bridge.hook(actual.scope, (ctx) => {
    assert.equal(ctx.fillRect, ctx.fillRect, "the native hot path must get a stable method");
    rectangles(items)(ctx);
  }, 0.5), true);
  assert.deepEqual(actual.pixels, expected.pixels);
  assert.equal(actual.context.fillStyle, "#f00");
  assert.equal(instances.length, 1);
  assert.ok(instances[0].memoryBytes <= 16 * 1024 * 1024);
  bridge.dispose();
  assert.equal(instances[0].memoryBytes, 0);
});

test("ordinary CSS or physical spacing is native with no allocation or callback execution", () => {
  for (const [spacing, ratio] of [[1, 1], [8, 2.75], [0.5, 2], [0.9, 2.75], [NaN, 1], [0, 1]]) {
    const { bridge, instances } = bridgeFixture();
    const frame = surface(); frame.scope.horizontalPixelRatio = ratio;
    assert.equal(bridge.hook(frame.scope, () => assert.fail("native should run only outside the hook"), spacing), false);
    assert.equal(instances.length, 0);
    assert.equal(frame.writes.length, 0);
  }
});

test("unsupported canvas state/metadata returns native before allocation and any main write", () => {
  const cases = [
    (c) => { c.globalAlpha = 0.5; }, (c) => { c.globalCompositeOperation = "copy"; },
    (c) => { c.filter = "blur(1px)"; }, (c) => { c.shadowBlur = 1; },
    (c) => { c.shadowOffsetX = 1; }, (c) => { c.shadowOffsetY = 1; },
    (c) => { c.shadowColor = "#000"; },
    (c) => { c.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 1, f: 0 }); },
    (c) => { c.getContextAttributes = () => ({ colorSpace: "display-p3", colorType: "unorm8" }); },
    (c) => { c.getContextAttributes = () => ({ colorSpace: "srgb", colorType: "float16" }); },
    (c) => { c.getContextAttributes = () => ({ colorSpace: "srgb" }); },
    (c) => { c.getContextAttributes = () => ({ colorSpace: "srgb", pixelFormat: "rgba-float16" }); },
    (c) => { c.getTransform = () => { throw Error("unreadable state"); }; },
    (c) => { c.canvas.width++; }
  ];
  for (const mutate of cases) {
    const frame = surface(), { bridge, instances } = bridgeFixture();
    mutate(frame.context);
    assert.equal(bridge.hook(frame.scope, draw, 0.5), false);
    assert.equal(instances.length, 0);
    assert.equal(frame.writes.length, 0);
  }
});

test("opaque CSS and exact alpha zero are supported while partial, contextual and unknown colors fall back midpass", () => {
  for (const style of ["#abc", "#abcdef", "#abcf", "#abcdefff", "rgb(1,2,3)",
    "rgba(1,2,3,1)", "rgba(10%,20%,30%,100%)", "red", "transparent", "#1230", "#12345600", "rgba(1,2,3,0)"]) {
    const frame = surface(), { bridge } = bridgeFixture();
    assert.equal(bridge.hook(frame.scope, rectangles([[style, 0, 0, 2, 2]]), 0.5), true, style);
    if (["transparent", "#1230", "#12345600", "rgba(1,2,3,0)"].includes(style))
      assert.ok(frame.pixels.every((pixel) => pixel === "background"));
    assert.equal(frame.context.fillStyle, style);
    bridge.dispose();
  }
  for (const style of ["#abcd", "#abcdef44", "rgba(1,2,3,.001)", "rgba(1,2,3,.999)",
    "rgba(1,2,3,0.999999999999999999999)", "rgb(nope)", "rgb(1,2,3) trailing", "rgb(300,2,3)",
    "rgb(1%,2,3)", "rgb(1.,2,3)", "rgb(1,2.,3)", "rgb(1,2,3.)", "rgba(1,2,3,0.)",
    "rgba(1,2,3,1.)", "rgba(1,2,3,100.%)", "\u00a0transparent\u00a0", "rgb(\u00a01,2,3)",
    "rgba(1,2,3,\u00a00)", "\u000btransparent", "transparent\u0000", "inherit", "initial", "unset", "revert", "revert-layer", "currentColor",
    "CanvasText", "var(--c)", "url(#c)", "notacolor", {}, null]) {
    const frame = surface(), { bridge, instances } = bridgeFixture();
    assert.equal(bridge.hook(frame.scope, (ctx) => {
      draw(ctx); ctx.fillStyle = style; ctx.fillRect(0, 0, 2, 2);
    }, 0.5), false, String(style));
    assert.equal(frame.writes.length, 0, String(style));
    assert.equal(frame.context.fillStyle, "#000000");
    assert.equal(instances[0].memoryBytes, 0);
  }
});

test("invalid CSS numbers/whitespace preserve the preceding native fillStyle through fallback", () => {
  for (const invalid of ["rgba(1,2,3,0.)", "rgba(1,2,3,1.)", "rgb(1.,2,3)",
    "\u00a0transparent\u00a0", "rgb(\u00a01,2,3)", "rgba(1,2,3,\u00a00)", "\u000btransparent", "transparent\u0000"]) {
    const frame = surface(), { bridge } = bridgeFixture();
    const descriptor = Object.getOwnPropertyDescriptor(frame.context, "fillStyle");
    Object.defineProperty(frame.context, "fillStyle", {
      get: descriptor.get,
      // Canvas ignores these invalid CSS assignments and retains its previous color.
      set(value) { if (value !== invalid) descriptor.set.call(this, value); }
    });
    frame.context.fillStyle = "red";
    const before = frame.writes.length;
    const native = rectangles([["red", 0, 0, 2, 2], [invalid, 0, 0, 2, 2]]);
    assert.equal(bridge.hook(frame.scope, native, 0.5), false, invalid);
    assert.equal(frame.writes.length, before, "unsupported recording cannot change the main canvas");
    assert.equal(frame.context.fillStyle, "red");
    native(frame.context); // The SDK's unchanged fallback retains and paints the preceding red.
    assert.equal(frame.context.fillStyle, "red");
    assert.equal(frame.pixels[0], "red");
    bridge.dispose();
  }
});

test("unknown recording methods, caught errors, invalid geometry and cull errors cannot paint partially", () => {
  for (const run of [
    (ctx) => { draw(ctx); ctx.clearRect(0, 0, 1, 1); },
    (ctx) => { draw(ctx); try { ctx.clearRect(0, 0, 1, 1); } catch {} draw(ctx); },
    (ctx) => { draw(ctx); ctx.globalAlpha = 0.5; },
    (ctx) => { draw(ctx); Object.defineProperty(ctx, "clearRect", { value() {} }); },
    (ctx) => { draw(ctx); ctx.fillRect(1.5, 0, 1, 1); },
    (ctx) => { draw(ctx); throw Error("unexpected native failure"); }
  ]) {
    const frame = surface(), { bridge } = bridgeFixture();
    assert.equal(bridge.hook(frame.scope, run, 0.5), false);
    assert.equal(frame.writes.length, 0);
  }
  for (const control of [{ failCull: true }, { overBudget: true }]) {
    const frame = surface(), { bridge } = bridgeFixture(control);
    assert.equal(bridge.hook(frame.scope, draw, 0.5), false);
    assert.equal(frame.writes.length, 0);
  }
});

test("palette/cache reset each frame, remain bounded, and resize/dispose release old core arrays", () => {
  const { bridge, instances } = bridgeFixture();
  for (let frame = 0; frame < 3; frame++) {
    const target = surface();
    assert.equal(bridge.hook(target.scope, (ctx) => {
      for (let index = 0; index < 200; index++) {
        ctx.fillStyle = `#${(frame * 200 + index).toString(16).padStart(6, "0")}`;
        ctx.fillRect(0, 0, 1, 1);
      }
    }, 0.5), true);
  }
  assert.equal(instances.length, 1);
  assert.equal(bridge.hook(surface().scope, (ctx) => {
    for (let index = 0; index < 256; index++) ctx.fillStyle = `#${index.toString(16).padStart(6, "0")}`;
  }, 0.5), false);
  assert.equal(instances[0].memoryBytes, 0);
  const transparentOverflow = surface();
  assert.equal(bridge.hook(transparentOverflow.scope, (ctx) => {
    for (let index = 0; index < 257; index++) ctx.fillStyle = `#${index.toString(16).padStart(6, "0")}00`;
  }, 0.5), false, "the parse cache is bounded even when every color is alpha zero");
  assert.equal(transparentOverflow.writes.length, 0);
  assert.equal(bridge.hook(surface().scope, draw, 0.5), true);
  const beforeResize = instances.at(-1);
  assert.equal(bridge.hook(surface(25, 36).scope, draw, 0.5), true);
  assert.equal(beforeResize.memoryBytes, 0);
  const current = instances.at(-1);
  assert.equal(bridge.hook(surface().scope, draw, 1), false);
  assert.equal(current.memoryBytes, 0, "ordinary scale releases the dense-frame core");
  bridge.dispose(); bridge.dispose();
  assert.equal(current.memoryBytes, 0);
  assert.equal(bridge.hook(surface().scope, draw, 0.5), false);
  assert.equal(instances.length, 4);
});

test("paint failures propagate, preventing a second native pass after a partial visible write", () => {
  const { bridge } = bridgeFixture(), frame = surface();
  const failure = Error("paint failed"), fill = frame.context.fillRect;
  frame.context.fillRect = (...args) => { fill(...args); throw failure; };
  assert.throws(() => bridge.hook(frame.scope, draw, 0.5), (error) => error === failure);
  assert.equal(frame.writes.filter(([kind]) => kind === "rect").length, 1);
  bridge.dispose();
});

test("only main Candlestick opts in; adapter destroy disables its hook and native OHLC stays unchanged", () => {
  const bars = [{ timestamp: 1700000000000, open: 10, high: 12, low: 9, close: 11, volume: 1 }];
  for (const chartType of ["candles", "bars", "line", "area"]) {
    const f = nativeFixture("lightweight", [], { settings: { chartType } });
    const main = f.activeSeries()[0];
    const hook = main.options().mtpNativeRectCull;
    assert.equal(typeof hook, chartType === "candles" ? "function" : "undefined");
    assert.ok(f.activeSeries().slice(1).every((series) => series.options().mtpNativeRectCull === undefined));
    f.adapter.setData(bars, false);
    if (chartType === "candles") {
      assert.deepEqual(main.data, [{ time: 1700000000, open: 10, high: 12, low: 9, close: 11 }]);
      assert.equal(hook(surface().scope, draw, 0.5), true);
    }
    f.adapter.destroy();
    if (hook) assert.equal(hook(surface().scope, draw, 0.5), false);
  }
});

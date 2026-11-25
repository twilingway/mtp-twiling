import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/charts/kline-price-scale.ts", import.meta.url), "utf8"),
  output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
function priceScaleApi() {
  const context = vm.createContext({
    MouseEvent: class {
      constructor(type, options) {
        this.type = type;
        Object.assign(this, options);
      }
    }
  });
  const module = { exports: {} };
  new vm.Script(`(function(require,module,exports){${output}\n})`).runInContext(context)(
    () => ({ DomPosition: { YAxis: "yAxis", Main: "main" } }),
    module,
    module.exports
  );
  return module.exports;
}
const { freezeKlinePriceScale: freeze, beginKlinePan, resetKlinePriceScale } = priceScaleApi();

test("KLine public axis bridge enters manual mode without changing vertical range", () => {
  let start = null,
    manual = false,
    range = 37.25;
  const before = range;
  freeze({
    getDom(pane, position) {
      assert.equal(pane, "candle_pane");
      assert.equal(position, "yAxis");
      return {
        getBoundingClientRect: () => ({ left: 1000, top: 89, width: 60, height: 500 }),
        dispatchEvent(event) {
          if (event.type === "mousedown") start = event;
          if (event.type === "mousemove") {
            assert.ok(start);
            assert.ok(Math.abs(event.clientX - start.clientX) >= 5);
            assert.equal(event.clientY, start.clientY);
            range *= event.clientY / start.clientY;
            manual = true;
          }
          if (event.type === "mouseup") {
            assert.equal(event.buttons, 0);
            start = null;
          }
        }
      };
    }
  });
  assert.equal(manual, true);
  assert.equal(range, before);
  assert.equal(start, null);
});

test("KLine reset uses native axis double click pairs without a price-range override", () => {
  const events = [];
  resetKlinePriceScale({
    getDom: () => ({
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 60, height: 500 }),
      dispatchEvent: (event) => events.push(event)
    })
  });
  assert.equal(events.map((event) => event.type).join(","), "mousedown,mouseup,mousedown,mouseup");
  assert.ok(events.every((event) => event.clientY === 300 && event.clientX === 130));
  assert.equal(events.at(-1).buttons, 0);
});

test("first substantive KLine movement restores original native pane drag after freezing", () => {
  const paneEvents = [];
  beginKlinePan(
    {
      getDom(_pane, position) {
        return {
          getBoundingClientRect: () => ({ left: 40, top: 90, width: 60, height: 500 }),
          dispatchEvent(event) {
            if (position === "main") paneEvents.push(event);
          }
        };
      }
    },
    { x: 200, y: 120 }
  );
  assert.equal(paneEvents.length, 1);
  assert.equal(paneEvents[0].type, "mousedown");
  assert.equal(paneEvents[0].clientX, 240);
  assert.equal(paneEvents[0].clientY, 210);
});

const navigationOutput = ts.transpileModule(
  readFileSync(new URL("../src/charts/navigation.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
).outputText;
const navigationModule = { exports: {} };
new vm.Script(`(function(module,exports){${navigationOutput}\n})`).runInNewContext()(
  navigationModule,
  navigationModule.exports
);
const { focusRange, isPanMovement } = navigationModule.exports;

test("click and slight pointer jitter retain autoscale; deliberate drag crosses the threshold", () => {
  const start = { x: 300, y: 200 };
  assert.equal(isPanMovement(start, start), false);
  assert.equal(isPanMovement(start, { x: 302, y: 201 }), false);
  assert.equal(isPanMovement(start, { x: 304, y: 200 }), true);
});

test("object focusing leaves visible anchors still and keeps exact zoom for offscreen anchors", () => {
  const viewport = { from: 10, to: 50 };
  assert.equal(focusRange([10, 20, 50], viewport), null);
  assert.equal(focusRange([], viewport), null);
  assert.equal(focusRange([Number.NaN], viewport), null);
  for (const points of [
    [-20, -10],
    [70, 90],
    [-200, 400]
  ]) {
    const result = focusRange(points, viewport);
    assert.equal(result.to - result.from, 40);
    assert.equal((result.to + result.from) / 2, (Math.min(...points) + Math.max(...points)) / 2);
  }
});

test("KLine unavailable or collapsed price axis is a safe no-op", () => {
  freeze({ getDom: () => null });
  for (const size of [
    { width: 0, height: 500 },
    { width: 60, height: 0 }
  ])
    freeze({
      getDom: () => ({
        getBoundingClientRect: () => ({ left: 0, top: 0, ...size }),
        dispatchEvent() {
          assert.fail("collapsed axis must not receive events");
        }
      })
    });
});

import test from "node:test";
import assert from "node:assert/strict";
import { nativeFixture } from "./native-technical-fixture.mjs";

test("KLine static DRAWINGS projects line text, rectangle and Fibonacci", () => {
  let paint = () => {};
  const f = nativeFixture("kline", [], { paint: (...args) => paint(...args) });
  const { paintDrawings } = f.load("model/drawing-model.ts");
  const { createTechnicalIndicatorInstance: create } = f.load(
    "model/technical-indicators/instances.ts"
  );
  const start = Date.UTC(2025, 0, 1),
    commands = [];
  const drawings = [
    {
      id: "line",
      name: "segment",
      points: [
        { timestamp: start, value: 100 },
        { timestamp: start + 86400000, value: 120 }
      ],
      settings: { color: "#ffff00", lineOpacity: 1, text: "Entry" }
    },
    {
      id: "area",
      name: "rectangle",
      points: [
        { timestamp: start, value: 100 },
        { timestamp: start + 86400000, value: 120 }
      ],
      settings: { color: "#398aff", fill: true, opacity: 0.41 }
    },
    {
      id: "fib",
      name: "fibonacciLine",
      points: [
        { timestamp: start, value: 100 },
        { timestamp: start + 86400000, value: 120 }
      ],
      settings: { color: "#ffff00", fill: true, opacity: 0.3, labels: false, prices: false }
    }
  ];
  paint = (ctx, width, height, project, layer) => {
    if (layer === "back") paintDrawings(ctx, drawings, project, width, height, null);
  };
  const ctx = new Proxy(
    { measureText: () => ({ width: 10 }) },
    {
      get(target, key) {
        if (key in target) return target[key];
        return (...args) =>
          commands.push({
            method: key,
            args,
            alpha: target.globalAlpha,
            color: target.strokeStyle
          });
      }
    }
  );
  f.adapter.setData([
    { timestamp: start, open: 100, high: 120, low: 90, close: 110, volume: 1 },
    { timestamp: start + 86400000, open: 110, high: 130, low: 100, close: 120, volume: 1 }
  ]);
  f.adapter.updateTechnicalIndicators(
    [create("rsi", "one"), create("rsi", "two", { pane: { kind: "pane", id: "one" } })],
    []
  );
  f.ready();
  f.adapter.redrawDrawings();
  const entry = f.activeIndicators().find((item) => item.name === "DRAWINGS_PERSONAL"),
    size = f.adapter.plotSize();
  entry.draw({
    indicator: entry,
    ctx,
    bounding: size,
    xAxis: { convertToPixel: (index) => index * 100 + 20 },
    yAxis: { convertToPixel: (value) => ((150 - value) / 100) * size.height }
  });
  assert.ok(
    commands.some(
      (command) => command.method === "stroke" && command.alpha === 1 && command.color === "#ffff00"
    )
  );
  assert.ok(commands.some((command) => command.method === "fillRect" && command.alpha === 0.3));
  assert.ok(commands.some((command) => command.method === "fillRect" && command.alpha === 0.41));
  assert.ok(
    commands.some((command) => command.method === "strokeRect" && command.color === "#398aff")
  );
  assert.ok(
    commands.some((command) => command.method === "fillText" && command.args[0] === "Entry")
  );
  assert.ok(
    commands.some((command) => command.method === "rect" && command.args[3] === size.height)
  );
  f.adapter.destroy();
  const count = commands.length;
  entry.draw({ indicator: entry });
  assert.equal(commands.length, count);
});

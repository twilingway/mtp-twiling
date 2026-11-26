import test from "node:test";
import assert from "node:assert/strict";
import { fixture, graph, plot } from "./ta-render-lightweight-fixture.mjs";
import { klineFixture, output, compiled } from "./ta-render-kline-fixture.mjs";

test("LW collapsed pane suppresses fallback tick text without changing the main axis or numeric series", () => {
  const item = plot({ kind: "line", gaps: "break" }, [null, 110], { paneKey: "pane:empty" });
  item.style.visible = false;
  item.presentation.visible = false;
  const closed = graph([item]);
  closed.groups[0].preference = { paneId: "empty", heightRatio: 0.2, collapsed: true };
  const f = fixture(closed),
    before = f.chart.panes()[0].priceScale("right").options();
  try {
    f.render();
    assert.equal(f.panes[1].priceScale("right").options().textColor, "transparent");
    assert.deepEqual(f.panes[0].priceScale("right").options(), before);
    assert.deepEqual(f.series()[0].data, [{ time: 1 }, { time: 2, value: 110 }]);
    const opened = graph([
      {
        ...item,
        style: { ...item.style, visible: true },
        presentation: { ...item.presentation, visible: true }
      }
    ]);
    f.render(opened);
    assert.equal(f.panes[1].priceScale("right").options().textColor, "#d4d4d4");
    assert.deepEqual(f.panes[0].priceScale("right").options(), before);
  } finally {
    f.adapter.dispose();
  }
});

test("installed KLine compact axis skips only cramped tick labels and inherits the unchanged numeric scale", async (t) => {
  const f = klineFixture(8);
  t.after(() => f.dispose());
  const options = [],
    create = f.chart.createIndicator.bind(f.chart);
  f.chart.createIndicator = (value, stack, paneOptions, done) => {
    options.push(paneOptions);
    return create(value, stack, paneOptions, done);
  };
  const p = output("hidden", [null, 110]);
  p.paneKey = "pane:empty";
  p.style.visible = false;
  p.presentation.visible = false;
  f.set(compiled([p]));
  await f.ready();
  const name = options.find((o) => o.id === "technical:empty").axisOptions.name,
    Axis = f.sdk.getYAxisClass(name),
    originalTicks = [{ coord: 15, value: 6, text: "6.000000" }];
  assert.equal(name, "PERSONAL_TA_COMPACT_AXIS");
  assert.equal(Axis.prototype.calcRange, f.sdk.YAxisImp.prototype.calcRange);
  assert.equal(Axis.prototype.convertToPixel, f.sdk.YAxisImp.prototype.convertToPixel);
  assert.deepEqual(
    Array.from(
      Axis.prototype.createTicks({ bounding: { height: 30 }, defaultTicks: originalTicks })
    ),
    []
  );
  assert.equal(
    Axis.prototype.createTicks({ bounding: { height: 31 }, defaultTicks: originalTicks }),
    originalTicks
  );
  assert.equal(
    Axis.prototype.createTicks({ bounding: { height: 200 }, defaultTicks: originalTicks }),
    originalTicks
  );
  assert.deepEqual(originalTicks, [{ coord: 15, value: 6, text: "6.000000" }]);
  assert.ok(f.entries("technical:empty").every((i) => i.figures.length === 0));
  assert.ok(options.every((o) => o.id !== "candle_pane"));
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  klineFixture,
  output,
  fill,
  compiled,
  recordingContext
} from "./ta-render-kline-fixture.mjs";

const nativeOwners = (f, pane) => f.entries(pane).filter((entry) => !entry.name.includes("FILL_"));
const nativeFills = (f, pane) => f.entries(pane).filter((entry) => entry.name.includes("FILL_"));

test("native registered cross draws disconnected orthogonal glyphs and contributes only actual values", async (t) => {
  const f = klineFixture();
  t.after(() => f.dispose());
  const plot = output("sar", [null, 1, null, 3, 4, null], {
    kind: "cross",
    size: { unit: "pine-relative", value: 1 }
  });
  f.set(compiled([plot]));
  await f.ready();
  const owner = nativeOwners(f)[0],
    params = f.params(owner);
  assert.equal(owner.draw(params), true);
  assert.equal(params.ctx.calls.filter((value) => value[0] === "stroke").length, 3);
  assert.equal(params.ctx.calls.filter((value) => value[0] === "lineTo").length, 6);
  assert.deepEqual(params.ctx.calls.filter((value) => value[0] === "moveTo").slice(0, 2), [
    ["moveTo", 7, 90],
    ["moveTo", 10, 87]
  ]);
  assert.equal(owner.figures.length, 1);
  assert.deepEqual(Object.keys(owner.result[0]), ["value"]);
  assert.ok(f.range().from > 0 && f.range().to >= 4);
});

test("linebr preserves indexed null gaps, singleton caps, projection failures and visible clipping", async (t) => {
  const f = klineFixture();
  t.after(() => f.dispose());
  const plot = output("trend", [null, 1, 2, null, 4, 5, null, 8]);
  f.set(compiled([plot]));
  await f.ready();
  const owner = nativeOwners(f)[0],
    params = f.params(owner);
  owner.draw(params);
  assert.equal(params.ctx.calls.filter((value) => value[0] === "stroke").length, 3);
  assert.deepEqual(
    params.ctx.calls.filter((value) => value[0] === "moveTo"),
    [
      ["moveTo", 10, 90],
      ["moveTo", 40, 60],
      ["moveTo", 69.5, 20]
    ]
  );
  assert.deepEqual(
    params.ctx.calls.filter((value) => value[0] === "lineTo"),
    [
      ["lineTo", 20, 80],
      ["lineTo", 50, 50],
      ["lineTo", 70.5, 20]
    ]
  );
  assert.ok(
    params.ctx.calls.some((value) => value[0] === "rect" && value[3] === 300 && value[4] === 200)
  );
  const invalid = f.params(owner);
  invalid.yAxis.convertToPixel = (value) => (value === 4 ? NaN : 100 - value * 10);
  owner.draw(invalid);
  assert.equal(invalid.ctx.calls.filter((value) => value[0] === "stroke").length, 2);
  assert.deepEqual(
    invalid.ctx.calls.filter((value) => value[0] === "lineTo"),
    [
      ["lineTo", 20, 80],
      ["lineTo", 70.5, 20]
    ]
  );
  const clipped = f.params(owner);
  clipped.visibleRange = { from: 2, to: 3 };
  owner.draw(clipped);
  assert.deepEqual(
    clipped.ctx.calls.filter((value) => value[0] === "lineTo"),
    [["lineTo", 20, 80]]
  );
});

test("paired fills break at missing anchors and remain independent of stroke visibility", async (t) => {
  const f = klineFixture();
  t.after(() => f.dispose());
  const plot = output("trend", [null, 1, 2, null, 4, 5, null, 8]),
    background = fill(plot, [null, 2, 3, null, 8, 9, null, 9], plot.values);
  f.set(compiled([plot]));
  await f.ready();
  const baseline = f.range();
  f.set(compiled([plot], [background]));
  await f.ready();
  assert.deepEqual(f.range(), baseline, "hidden body9 contributes no scale value");
  const companion = nativeFills(f)[0],
    params = f.params(companion);
  companion.draw(params);
  assert.equal(params.ctx.calls.filter((value) => value[0] === "fill").length, 2);
  assert.deepEqual(Array.from(companion.figures), []);
  assert.deepEqual(Array.from(companion.result), []);
  const hidden = {
    ...plot,
    style: { ...plot.style, visible: false },
    presentation: { ...plot.presentation, visible: false }
  };
  f.set(compiled([hidden], [background]));
  await f.ready();
  assert.equal(nativeOwners(f)[0].figures.length, 0);
  assert.equal(nativeFills(f)[0].visible, true);
  const stillVisible = f.params(nativeFills(f)[0]);
  nativeFills(f)[0].draw(stillVisible);
  assert.equal(stillVisible.ctx.calls.filter((value) => value[0] === "fill").length, 2);
});

test("actual SDK per-bar figure styles use shared sign/change palette and explicit solid opacity", async (t) => {
  const f = klineFixture();
  t.after(() => f.dispose());
  const plot = output(
    "macd",
    [null, -2, -1, -1, 0, 1, 1, null, 1],
    { kind: "columns", base: 0 },
    "legacy-fixed-6"
  );
  plot.paneKey = "pane:osc";
  plot.presentation = {
    ...plot.presentation,
    color: { kind: "palette", id: "macd-sign-change-v1" }
  };
  f.set(compiled([plot]));
  await f.ready();
  const owner = nativeOwners(f, "technical:osc")[0],
    colors = [];
  for (const index of [1, 2, 3, 4, 5, 6, 8])
    f.sdk.eachFigures(f.bars, owner, index, f.params(owner).defaultStyles, (_figure, style) =>
      colors.push(style.color)
    );
  assert.deepEqual(colors, [
    "#FF5252",
    "#FFCDD2",
    "#FF5252",
    "#26A69A",
    "#26A69A",
    "#B2DFDB",
    "#B2DFDB"
  ]);
  assert.equal(owner.draw(f.params(owner)), false, "columns use native figures paint");
  plot.presentation = {
    ...plot.presentation,
    color: { kind: "solid", color: "#123456" },
    opacity: 0.25
  };
  plot.style = { ...plot.style, opacity: 0.25 };
  f.set(compiled([plot]));
  await f.ready();
  const manual = nativeOwners(f, "technical:osc")[0],
    actual = [];
  f.sdk.eachFigures(f.bars, manual, 2, f.params(manual).defaultStyles, (_figure, style) =>
    actual.push(style.color)
  );
  assert.deepEqual(actual, ["rgba(18,52,86,0.25)"]);
});

for (const initial of [6, 8])
  test(`G7: actual registered create/sync/range is neutral at initial precision${initial}, hide/collapse/move/remove`, async (t) => {
    const f = klineFixture(initial);
    t.after(() => f.dispose());
    if (initial === 8) {
      f.bars[0].high += 1e-10;
      f.bars[0].low -= 1e-10;
    }
    const emptyBaseline = f.range();
    const plot = output("trend", Array(8).fill(1)),
      background = fill(plot, Array(8).fill(100), Array(8).fill(1));
    for (const precision of [6, 8, 6]) {
      f.precision(precision);
      f.set(compiled([plot]));
      await f.ready();
      const baseline = f.range();
      f.set(compiled([plot], [background]));
      await f.ready();
      assert.deepEqual(f.range(), baseline);
      assert.ok(
        f
          .entries()
          .every(
            (entry) => entry.precision === precision && entry.series === f.sdk.IndicatorSeries.Price
          )
      );
      assert.ok(
        f
          .entries()
          .every(
            (entry) =>
              entry.minValue === null && entry.maxValue === null && entry.shouldOhlc === false
          )
      );
      for (const hiddenFill of [false, true]) {
        const hidden = {
          ...plot,
          style: { ...plot.style, visible: false },
          presentation: { ...plot.presentation, visible: false }
        };
        f.set(compiled([hidden]));
        await f.ready();
        const hiddenBaseline = f.range();
        f.set(compiled([hidden], [{ ...background, visible: !hiddenFill }]));
        await f.ready();
        assert.deepEqual(f.range(), hiddenBaseline);
        assert.equal(nativeOwners(f)[0].figures.length, 0);
      }
    }
    plot.paneKey = "pane:moved";
    background.paneKey = plot.paneKey;
    f.set(compiled([plot], [background]));
    await f.ready();
    f.precision(8);
    assert.ok(f.entries("technical:moved").every((entry) => entry.precision === 8));
    f.precision(6);
    assert.ok(f.entries("technical:moved").every((entry) => entry.precision === 6));
    assert.ok(
      f.descriptors
        .filter((entry) => entry.value.name.includes("PRICE_"))
        .every((entry) => !Object.hasOwn(entry.value, "precision"))
    );
    f.set(compiled([]));
    await f.ready();
    assert.equal(f.entries("technical:moved").length, 0);
    f.precision(initial);
    assert.deepEqual(f.range(), emptyBaseline);
  });

test("legacy overlay and metadata lower pane retain explicit6 native path", async (t) => {
  const f = klineFixture(8);
  t.after(() => f.dispose());
  const legacy = output("legacy", Array(8).fill(1));
  delete legacy.presentation;
  const columns = output("osc", Array(8).fill(1), { kind: "columns", base: 0 }, "legacy-fixed-6");
  columns.paneKey = "pane:osc";
  f.set(compiled([legacy, columns]));
  await f.ready();
  f.precision(6);
  f.precision(8);
  assert.equal(nativeOwners(f)[0].precision, 6);
  assert.equal(nativeOwners(f, "technical:osc")[0].precision, 6);
  assert.equal(nativeOwners(f)[0].name, "PERSONAL_TA_0");
});

test("actual SDK overrides reorder negative companions, below price and above grid/legacy layers", async (t) => {
  const f = klineFixture();
  t.after(() => f.dispose());
  const a = output("a", Array(8).fill(1)),
    b = output("b", Array(8).fill(1));
  b.order = 2;
  const fa = fill(a, Array(8).fill(2), a.values),
    fb = fill(b, Array(8).fill(3), b.values);
  fa.color = "#AA0000";
  fb.color = "#00BB00";
  for (const [name, zLevel] of [
    ["MTP_TEST", -1],
    ["DRAWINGS_TEST", -2]
  ]) {
    f.sdk.registerIndicator({
      name,
      series: f.sdk.IndicatorSeries.Price,
      zLevel,
      figures: [],
      calc: () => [],
      draw: () => true
    });
    await f.store.addInstance({ name }, "candle_pane", true);
  }
  f.set(compiled([a, b], [fa, fb]));
  await f.ready();
  assert.deepEqual(
    nativeFills(f).map((entry) => entry.extendData.context.outputs[0].instanceId),
    ["b", "a"]
  );
  a.order = 4;
  b.order = 0;
  f.set(compiled([b, a], [fb, fa]));
  await f.ready();
  assert.deepEqual(
    nativeFills(f).map((entry) => entry.extendData.context.outputs[0].instanceId),
    ["a", "b"]
  );
  assert.ok(nativeFills(f).every((entry) => entry.zLevel <= -3));
  const calls = f.paint(),
    fills = calls.filter((entry) => entry[0] === "fill");
  assert.equal(fills[0][1], "rgba(170,0,0,0.1)");
  assert.equal(fills[0][2], "destination-over");
  assert.equal(fills[1][1], "rgba(0,187,0,0.1)");
  const strokes = calls.filter((entry) => entry[0] === "stroke");
  assert.equal(strokes.at(-1)[1], "#GRID");
  assert.equal(strokes.at(-1)[2], "destination-over");
});

test("owned removal clears contexts and late native calc callbacks cannot reschedule disposed owners", async () => {
  const f = klineFixture(),
    plot = output("owned", [null, 1, 1]);
  f.set(compiled([plot], [fill(plot, [null, 2, 2], plot.values)]));
  const captured = f.entries().slice();
  f.dispose();
  const calls = f.calls.length;
  await f.ready();
  assert.equal(f.entries().length, 0);
  assert.equal(f.frames.size, 0);
  assert.equal(f.calls.length, calls);
  for (const entry of captured) {
    const context = entry.extendData.context;
    assert.equal(context.disposed, true);
    assert.equal(context.outputs.length, 0);
    assert.equal(context.fills.length, 0);
    const ctx = recordingContext();
    entry.draw(f.params(entry, ctx));
    assert.equal(ctx.calls.length, 0);
  }
});

test("AO native callback colors use immediate change including equality and previous null", async (t) => {
  const f = klineFixture();
  t.after(() => f.dispose());
  const plot = output(
    "ao",
    [null, -2, -1, -1, 0, 1, 1, null, 1],
    { kind: "columns", base: 0 },
    "legacy-fixed-6"
  );
  plot.presentation = { ...plot.presentation, color: { kind: "palette", id: "ao-change-v1" } };
  f.set(compiled([plot]));
  await f.ready();
  const owner = nativeOwners(f)[0],
    colors = [];
  for (const index of [1, 2, 3, 4, 5, 6, 8])
    f.sdk.eachFigures(f.bars, owner, index, f.params(owner).defaultStyles, (_figure, style) =>
      colors.push(style.color)
    );
  assert.deepEqual(colors, [
    "#009688",
    "#009688",
    "#F44336",
    "#009688",
    "#009688",
    "#F44336",
    "#009688"
  ]);
});

test("legacy-fixed-6 companion follows legacy owner range without affecting native-price policy", async (t) => {
  const f = klineFixture(8);
  t.after(() => f.dispose());
  const plot = output("band", Array(8).fill(1), { kind: "line", gaps: "break" }, "legacy-fixed-6"),
    background = fill(plot, Array(8).fill(100), plot.values);
  f.set(compiled([plot]));
  await f.ready();
  const baseline = f.range();
  f.set(compiled([plot], [background]));
  await f.ready();
  assert.deepEqual(f.range(), baseline);
  assert.ok(f.entries().every((entry) => entry.precision === 6));
  f.precision(2);
  assert.ok(f.entries().every((entry) => entry.precision === 6));
});

test("100 owned instances reuse bounded registered names across replacement datasets", async (t) => {
  const f = klineFixture();
  t.after(() => f.dispose());
  const before = f.sdk.getSupportedIndicators().length;
  for (let generation = 0; generation < 3; generation++) {
    const plots = Array.from({ length: 100 }, (_, index) => {
      const value = output(`${generation}-${index}`, [null, 1, null, 1]);
      value.order = index * 2;
      return value;
    });
    f.set(
      compiled(
        plots,
        plots.map((plot) => fill(plot, [null, 2, null, 2], plot.values))
      )
    );
    await f.ready();
    assert.equal(f.entries().length, 200);
    assert.equal(f.sdk.getSupportedIndicators().length - before, 200);
  }
});

test("metadata columns base0 affects native range but not paint/tooltip/axis/crosshair output lists", async (t) => {
  const f = klineFixture();
  t.after(() => f.dispose());
  for (const value of [3, -3]) {
    const plot = output(
      "columns",
      Array(8).fill(value),
      { kind: "columns", base: 0 },
      "legacy-fixed-6"
    );
    plot.paneKey = "pane:columns";
    f.set(compiled([plot]));
    await f.ready();
    const owner = nativeOwners(f, "technical:columns")[0],
      range = f.range("technical:columns"),
      context = owner.extendData.context;
    assert.equal(context.columnsBase.kind, "columns-base0");
    assert.equal(owner.figures[0].key, context.columnsBase.key);
    assert.ok(range.from <= Math.min(0, value) && range.to >= Math.max(0, value));
    const visible = [];
    f.sdk.eachFigures(f.bars, owner, 7, f.params(owner).defaultStyles, (figure) =>
      visible.push(figure.key)
    );
    assert.deepEqual(visible, ["value"]);
    assert.deepEqual(
      Array.from(f.tooltip(owner).values, (legend) => legend.value.text),
      [`${value.toFixed(6)}`]
    );
    assert.deepEqual(f.axisLabels("technical:columns"), [value.toFixed(6)]);
    const crosshair = f.crosshair("technical:columns");
    assert.deepEqual(Object.keys(crosshair.indicatorData["technical:columns"]), [owner.name]);
    assert.deepEqual(Object.keys(crosshair.indicatorData["technical:columns"][owner.name]), [
      "value"
    ]);
    assert.ok(!JSON.stringify(crosshair).includes(context.columnsBase.key));
  }
  const priceColumns = output(
    "paint",
    Array(8).fill(3),
    { kind: "columns", base: 0 },
    "legacy-fixed-6"
  );
  f.set(compiled([priceColumns]));
  await f.ready();
  assert.equal(
    f.paint().filter((entry) => entry[0] === "fill").length,
    8,
    "no scale-only glyph/bar is painted"
  );
});

test("columns base0 is known only at finite visible column slots; hidden/collapse/all-null/remove restore negative-only scale", async (t) => {
  const f = klineFixture();
  t.after(() => f.dispose());
  const other = output(
    "negative",
    [-5, -4, -5, -4, -5, -4, -5, -4],
    { kind: "line", gaps: "break" },
    "legacy-fixed-6"
  );
  other.paneKey = "pane:shared";
  const plot = output(
    "columns",
    [-3, null, null, -3, null, -3, null, null],
    { kind: "columns", base: 0 },
    "legacy-fixed-6"
  );
  plot.paneKey = other.paneKey;
  f.set(compiled([other]));
  await f.ready();
  const baseline = f.range("technical:shared");
  f.set(compiled([other, plot]));
  await f.ready();
  assert.equal(f.range("technical:shared").to, 0);
  const original = nativeOwners(f, "technical:shared").find(
    (entry) => entry.extendData.context.outputs[0].instanceId === "columns"
  );
  f.viewport(1, 2);
  const nullViewport = f.range("technical:shared");
  assert.ok(nullViewport.to < 0);
  f.set(compiled([other]));
  await f.ready();
  assert.deepEqual(f.range("technical:shared"), nullViewport);
  f.viewport(0, 7);
  for (const mode of ["hide", "all-null"]) {
    const styled =
      mode === "all-null"
        ? {
            ...plot,
            values: Array(8).fill(null),
            presentation: { ...plot.presentation, values: Array(8).fill(null) }
          }
        : {
            ...plot,
            style: { ...plot.style, visible: false },
            presentation: { ...plot.presentation, visible: false }
          };
    const snapshot = compiled([other, styled]);
    f.set(snapshot);
    await f.ready();
    assert.deepEqual(f.range("technical:shared"), baseline);
  }
  const hide = (value) => ({
      ...value,
      style: { ...value.style, visible: false },
      presentation: { ...value.presentation, visible: false }
    }),
    hiddenOther = hide(other),
    hiddenColumns = hide(plot),
    legacyHidden = { ...hiddenColumns };
  delete legacyHidden.presentation;
  f.set(compiled([hiddenOther, legacyHidden]));
  await f.ready();
  const collapsedBaseline = f.range("technical:shared");
  const collapsed = compiled([hiddenOther, hiddenColumns]);
  collapsed.groups[0].preference = { collapsed: true };
  f.set(collapsed);
  await f.ready();
  assert.deepEqual(f.range("technical:shared"), collapsedBaseline);
  f.set(compiled([other, plot]));
  await f.ready();
  const sameOwner = nativeOwners(f, "technical:shared").find(
    (entry) => entry.extendData.context.outputs[0].instanceId === "columns"
  );
  f.set(compiled([other, { ...plot, style: { ...plot.style, visible: false } }]));
  await f.ready();
  assert.equal(
    nativeOwners(f, "technical:shared").find(
      (entry) => entry.extendData.context.outputs[0].instanceId === "columns"
    ),
    sameOwner
  );
  assert.ok(original.extendData.context.disposed);
  f.set(compiled([other]));
  await f.ready();
  assert.deepEqual(f.range("technical:shared"), baseline);
});

test("columns scale semantic cannot collide with an actual output ID", async (t) => {
  const f = klineFixture();
  t.after(() => f.dispose());
  const plot = output(
    "collision",
    Array(8).fill(-3),
    { kind: "columns", base: 0 },
    "legacy-fixed-6"
  );
  plot.outputId = "__mtpColumnsBase0";
  plot.key = `collision/${plot.outputId}`;
  plot.presentation = { ...plot.presentation, id: plot.outputId };
  f.set(compiled([plot]));
  await f.ready();
  const owner = nativeOwners(f)[0],
    base = owner.extendData.context.columnsBase;
  assert.notEqual(base.key, plot.outputId);
  assert.equal(owner.result[0][plot.outputId], -3);
  assert.equal(owner.result[0][base.key], 0);
  assert.deepEqual(Object.keys(owner.result[0]), [plot.outputId]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";
import { klineFixture } from "./ta-render-kline-fixture.mjs";

const load = sourceLoader();
const { bandStudies } = load("model/technical-indicators/catalog-expansion/bands.ts");
const { compilePresentation, presentationColor } = load(
  "model/technical-indicators/presentation.ts"
);
const { directionalFillRuns, drawStudyMarker, drawStudyRange } = load(
  "charts/technical-study-paint.ts"
);
const { LightweightTechnicalPrimitive } = load("charts/lightweight-technical-primitives.ts");
const klineLoad = sourceLoader({ "charts/klinecharts": { registerFigure() {} } });
const { drawKlineTechnical, klineRangeAnchorFigures } = klineLoad(
  "charts/kline-technical-geometry.ts"
);

const bars = (rows) =>
  rows.map(([open, high, low, close], index) => ({
    timestamp: Date.UTC(2025, 0, index + 1),
    open,
    high,
    low,
    close,
    volume: 100
  }));
const closes = (prices) =>
  bars(
    prices.map((price) =>
      price == null ? [null, null, null, null] : [price, price + 1, price - 1, price]
    )
  );
const study = (id) => bandStudies.find((value) => value.definition.id === id);
const defaults = (definition) =>
  Object.fromEntries(definition.parameters.map((p) => [p.key, p.defaultValue]));
const compile = (id, values, params, styles) => {
  const item = study(id);
  return compilePresentation(item.definition.presentation, {
    timestamps: values.map((bar) => bar.timestamp),
    series: item.calculate(values, params),
    visible: true,
    collapsed: false,
    styles
  });
};

test("all price-band studies declare aligned render outputs, finite warmup, and unique catalog IDs", () => {
  const input = closes(Array.from({ length: 80 }, (_, i) => 100 + (i % 9) ** 2));
  assert.equal(new Set(bandStudies.map((item) => item.catalogId)).size, 7);
  for (const { definition, history } of bandStudies) {
    const params = defaults(definition);
    const presentation = compile(definition.id, input, params);
    assert.deepEqual(
      presentation.plots.map((plot) => plot.id),
      definition.outputs.map((output) => output.id)
    );
    assert.ok(presentation.plots.every((plot) => plot.values.length === input.length));
    assert.ok(presentation.plots.some((plot) => plot.values.some(Number.isFinite)));
    assert.ok(Number.isInteger(history(params).warmupBars));
  }
});

test("Donchian display displacement keeps its extrema and area anchored to source observations", () => {
  const input = closes([10, 12, 9]),
    item = study("donchian-channels");
  assert.deepEqual(
    item.calculate(input, { length: 2, displayOffset: -3 }),
    item.calculate(input, { length: 2, displayOffset: 4 })
  );
  assert.deepEqual(item.barOffsets({ length: 2, displayOffset: 4 }), {
    basis: 4,
    upper: 4,
    lower: 4
  });
  const { fills } = compile("donchian-channels", input, { length: 2, displayOffset: -3 });
  assert.deepEqual(fills[0].from, [11, 13, 13]);
  assert.deepEqual(fills[0].to, [9, 9, 8]);
});

test("BBTrend paints both signs at two intensities and preserves an unavailable observation", () => {
  const input = closes([10, 12, 10, 9, 11, 12, null, 14, 15]);
  const params = { shortLength: 1, longLength: 2, multiplier: 2 };
  const {
    plots: [plot]
  } = compile("bbtrend", input, params);
  const colors = input.map((_, index) => presentationColor(plot, index));
  assert.deepEqual(colors, [
    null,
    "#16805F",
    "#CB4352",
    "#DB8D95",
    "#16805F",
    "#8ABBA9",
    null,
    null,
    "#16805F"
  ]);
  const {
    plots: [custom]
  } = compile("bbtrend", input, params, {
    value: { color: "#123456", visible: true, width: 1 }
  });
  assert.equal(presentationColor(custom, 3), "#123456");
  assert.equal(presentationColor(custom, 6), null);
});

test("Volatility Stop separates reversal segments and Median preflights its direct workload", () => {
  const input = closes([10, 14, 13, 10, 7, 8, 10]);
  const result = study("volatility-stop").calculate(input, {
    length: 1,
    multiplier: 1,
    source: "close"
  });
  assert.deepEqual(result, {
    up: [8, 9, 12, null, null, null, 7],
    down: [null, null, null, 14, 11, 9, null]
  });
  const median = study("median");
  assert.equal(median.unavailableReason(14999, { length: 10000 }), undefined);
  assert.equal(median.unavailableReason(15000, { length: 10000 }), "calculation-limit");
});

test("Median fill switches colors at the intersection, including reversed price axes", () => {
  const {
    fills: [fill]
  } = compile("median", closes([12, 10, 9, 15]), {
    length: 2,
    source: "close",
    atrLength: 2,
    multiplier: 2
  });
  assert.equal(fill.color, "#297B70");
  assert.equal(fill.belowColor, "#8662CB");
  for (const direction of [-1, 1]) {
    const left = { x: 0, from: 2 * direction, to: 0, fromBelow: false };
    const right = { x: 12, from: -4 * direction, to: 0, fromBelow: true };
    const split = directionalFillRuns([left, right]);
    assert.equal(split[0].fromBelow, false);
    assert.equal(split[1].fromBelow, true);
    assert.deepEqual(split[0].points.at(-1), { x: 4, from: 0, to: 0, fromBelow: true });
    assert.deepEqual(split[0].points.at(-1), split[1].points[0]);
  }
});

test("Bollinger Bars preserves both paired bounds, omits incomplete bars, and supports doji bodies", () => {
  const input = bars([
    [4, 10, 2, 7],
    [7, 11, 1, 4],
    [3, 8, 1, 3],
    [4, null, 2, 3]
  ]);
  const { plots } = compile("bollinger-bars", input, {});
  const find = (id) => plots.find((plot) => plot.id === id);
  assert.deepEqual(find("upperWick").values, [10, 11, 8, null]);
  assert.deepEqual(find("upperWick").pairedValues, [7, 7, 3, null]);
  assert.deepEqual(find("lowerWick").pairedValues, [2, 1, 1, null]);
  assert.deepEqual(find("upBody").values, [7, null, null, null]);
  assert.deepEqual(find("downBody").pairedValues, [null, 4, null, null]);
  assert.deepEqual(find("flatBody").pairedValues, [null, null, 3, null]);
  assert.equal(find("flatBody").geometry.showEqual, true);

  const rectangles = [],
    context = { fillRect: (...args) => rectangles.push(args) };
  drawStudyRange(context, { x: 10, y: 2 }, 7, 10, false, 2, 2);
  drawStudyRange(context, { x: 10, y: 7 }, 12, 10, false, 2, 2);
  drawStudyRange(context, { x: 10, y: 7 }, 7, 10, false, 2, 2);
  drawStudyRange(context, { x: 10, y: 7 }, 7, 10, true, 2, 2);
  assert.deepEqual(rectangles, [
    [13, 4, 14, 10],
    [13, 14, 14, 10],
    [13, 14, 14, 1]
  ]);
});

test("offset markers stay on the requested side of their bar at non-unit pixel ratios", () => {
  const points = [],
    context = {
      beginPath() {},
      moveTo: (...args) => points.push(args),
      lineTo: (...args) => points.push(args),
      closePath() {},
      fill() {}
    };
  drawStudyMarker(
    context,
    {
      kind: "marker",
      shape: "triangle-down",
      placement: "above",
      size: { unit: "pine-relative", value: 2 }
    },
    { x: 10, y: 40 },
    2,
    3
  );
  assert.deepEqual(points, [
    [20, 117],
    [28, 93],
    [12, 93]
  ]);
});

test("both adapter paint paths use paired Bollinger endpoints and scale only visible ranges", () => {
  const input = bars([
    [4, 10, 2, 7],
    [7, 11, 1, 4]
  ]);
  const { timestamps, plots } = compile("bollinger-bars", input, {});
  const outputs = plots.map((plot) => ({
    outputId: plot.id,
    timestamps,
    values: plot.values,
    kind: "line",
    presentation: plot,
    style: {
      visible: plot.id === "lowerWick" || plot.id === "upperWick",
      color: plot.color.color,
      opacity: 1,
      lineStyle: "solid",
      width: 1
    }
  }));
  const timestampMs = timestamps[0];
  const pixelX = (index) => 10 + index * 10;
  const pixelY = (value) => 100 - 10 * value;
  const recorder = () => {
    const rectangles = [];
    const ctx = {
      fillRect: (...args) => rectangles.push(args),
      save() {},
      beginPath() {},
      rect() {},
      clip() {},
      setLineDash() {},
      restore() {}
    };
    return { ctx, rectangles };
  };
  const mockScale = {
    getVisibleRange: () => ({ from: timestamps[0] / 1000, to: timestamps[1] / 1000 }),
    timeToCoordinate: (time) => pixelX(time * 1000 === timestampMs ? 0 : 1),
    options: () => ({ barSpacing: 10 })
  };
  const lightweight = recorder();
  for (const output of outputs) {
    const primitive = new LightweightTechnicalPrimitive(
      { timeScale: () => mockScale },
      { priceToCoordinate: pixelY },
      () => true
    );
    primitive.attached({ requestUpdate() {} });
    primitive.updatePlot(output);
    primitive
      .paneViews()[0]
      .renderer()
      .draw({
        useBitmapCoordinateSpace: (draw) =>
          draw({
            context: lightweight.ctx,
            horizontalPixelRatio: 1,
            verticalPixelRatio: 1,
            bitmapSize: { width: 100, height: 100 }
          })
      });
    if (output.outputId === "lowerWick") {
      assert.deepEqual(primitive.autoscaleInfo(), { priceRange: { minValue: 1, maxValue: 2 } });
      const originalRange = mockScale.getVisibleRange;
      mockScale.getVisibleRange = () => ({ from: timestamps[0] / 1000, to: timestamps[0] / 1000 });
      assert.deepEqual(primitive.autoscaleInfo(), { priceRange: { minValue: 2, maxValue: 2 } });
      mockScale.getVisibleRange = originalRange;
    } else if (!output.style.visible) assert.equal(primitive.autoscaleInfo(), null);
  }

  const kline = recorder();
  const anchors = klineRangeAnchorFigures(outputs);
  assert.equal(anchors.length, 2);
  assert.deepEqual(anchors[1].values, [2, 1]);
  assert.ok(anchors.every((anchor) => !outputs.some((output) => output.outputId === anchor.key)));
  assert.equal(
    drawKlineTechnical({
      indicator: { extendData: { context: { disposed: false, outputs, levels: [] } } },
      ctx: kline.ctx,
      bounding: { width: 100, height: 100 },
      visibleRange: { from: 0, to: 1 },
      xAxis: { convertToPixel: pixelX },
      yAxis: { convertToPixel: pixelY },
      barSpace: { bar: 10 }
    }),
    true
  );
  assert.deepEqual(kline.rectangles, lightweight.rectangles);
  assert.deepEqual(
    kline.rectangles.map(([, , width]) => width),
    [7, 7, 7, 7]
  );
});

test("native KLine Y axis includes the actual range anchor and ignores it after a visibility change", async (t) => {
  const fixture = klineFixture();
  t.after(() => fixture.dispose());
  const { createTechnicalIndicatorInstance: create, isTechnicalIndicatorInstance } = load(
    "model/technical-indicators/instances.ts"
  );
  const { TechnicalRenderData } = load("charts/technical-render-data.ts");
  const data = new TechnicalRenderData();
  data.setData(bars(Array.from({ length: 8 }, (_, i) => [2 + i, 20 + i, -100 - i, 5 + i])));
  const styles = Object.fromEntries(
    study("bollinger-bars").definition.outputs.map(({ id, color }) => [
      id,
      { color, width: 1, visible: id === "lowerWick" }
    ])
  );
  const instance = create("bollinger-bars", "bb-bars", {
    pane: { kind: "pane", id: "bb-bars" },
    styles
  });
  const restored = JSON.parse(JSON.stringify(instance));
  assert.equal(isTechnicalIndicatorInstance(restored), true);
  fixture.set(data.compile([restored]));
  await fixture.ready();
  const pane = "technical:bb-bars";
  const owner = fixture.entries(pane)[0];
  assert.ok(owner.figures.some((figure) => figure.key === "__mtpRangeAnchor_lowerWick"));
  assert.equal(owner.result.at(-1).__mtpRangeAnchor_lowerWick, -107);
  assert.ok(fixture.range(pane).from <= -107);
  assert.equal(JSON.stringify(fixture.tooltip(owner)).includes("__mtpRangeAnchor"), false);

  restored.styles.lowerWick.visible = false;
  fixture.set(data.compile([restored]));
  await fixture.ready();
  assert.ok(
    fixture
      .entries(pane)
      .every((entry) => entry.figures.every((figure) => !figure.key.startsWith("__mtpRangeAnchor")))
  );
  assert.ok(fixture.range(pane).from > -107);
});

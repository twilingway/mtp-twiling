import assert from "node:assert/strict";
import test from "node:test";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";
import { canvas } from "./ta-render-lightweight-fixture.mjs";
import { klineFixture, recordingContext } from "./ta-render-kline-fixture.mjs";

const load = createSourceLoader({ klinecharts: { registerFigure() {} } });
const { volumeDeltaStudies } = load("model/technical-indicators/catalog-expansion/volume-delta.js");
const { compilePresentation } = load("model/technical-indicators/presentation.js");
const { assembleIntrabarVolume } = load("model/technical-indicators/ta-batch-volume-intrabars.js");
const { createTechnicalIndicatorInstance, calculateTechnicalIndicator } = load(
  "model/technical-indicators/index.js"
);
const { technicalCatalogEntries } = load("model/technical-indicators/catalog.js");
const { TechnicalRenderData } = load("charts/technical-render-data.js");
const { LightweightTechnicalPrimitive } = load("charts/lightweight-technical-primitives.js");
const { drawKlineTechnical, klineRangeAnchorFigures } = load("charts/kline-technical-geometry.js");
const { loadPublicIntrabarVolume } = load("services/market-intrabar-volume.js");
const minute = 60000,
  day = 1440 * minute;
const uid = "bybit:spot:BTCUSDT",
  currency = "BTC";

const bar = (timestamp) => ({ timestamp, open: 8, close: 9, high: 10, low: 7, volume: 9999 });
const lower = (timestamp, open, close, volume) => ({ timestamp, open, close, volume });
const history = (bars, from = bars[0].timestamp, to = bars.at(-1).timestamp) => ({
  instrumentKey: uid,
  currency,
  interval: "1m",
  range: { from, to },
  bars
});
const context = { historicalVolatilityPeriodsPerYear: 365, chartInterval: "5m" };
const sourced = (intrabarVolume) => ({ ...context, volumeStudies: { intrabarVolume } });
const sample = [
  lower(4 * minute, 10, 8, 9),
  lower(5 * minute, 8, 8, 2),
  lower(6 * minute, 8, 9, 7),
  lower(7 * minute, 9, 8, 11),
  lower(8 * minute, 8, 8, 2),
  lower(9 * minute, 8, 9, 3),
  lower(10 * minute, 9, 10, 0)
];
const parents = [bar(5 * minute), bar(10 * minute)];
const run = (id, bars, input, params = {}) =>
  calculateTechnicalIndicator(
    createTechnicalIndicatorInstance(id, id, { params }),
    bars,
    sourced(input)
  );

test("three delta studies are registered and direction history produces true OHLC and signed volumes", () => {
  const entries = new Map(
    technicalCatalogEntries("en").map((entry) => [entry.id, entry.available])
  );
  for (const study of volumeDeltaStudies) assert.equal(entries.get(study.catalogId), true);
  const result = run("volume-delta", parents, history(sample));
  assert.deepEqual(result.series, {
    delta: [-5, 0],
    "$delta:open": [0, 0],
    "$delta:high": [5, 0],
    "$delta:low": [-8, 0],
    "$delta:color": [0, 1]
  });
  assert.deepEqual(run("up-down-volume", parents, history(sample)).series, {
    up: [14, 0],
    down: [-11, 0],
    delta: [3, 0],
    "$delta:color": [1, 1]
  });
});

test("an uncovered chart bucket is unknown and independent covered lower seed survives", () => {
  const lowerBars = [
    lower(4 * minute, 10, 8, 9),
    ...sample.slice(1, 4),
    ...sample.slice(5),
    lower(11 * minute, 10, 10, 2)
  ];
  const periods = assembleIntrabarVolume(parents, "5m", history(lowerBars));
  assert.equal(periods[0].intrabars, null);
  assert.deepEqual(periods[1].seed, { close: 9, direction: 1 });
  assert.deepEqual(run("volume-delta", parents, history(lowerBars)).series.delta, [null, 2]);
  const noInitialSeed = history(sample.slice(1));
  assert.deepEqual(run("volume-delta", parents, noInitialSeed).series.delta, [null, 0]);
  assert.equal(
    calculateTechnicalIndicator(
      createTechnicalIndicatorInstance("volume-delta", "no-lower"),
      parents,
      context
    ).unavailableReason,
    "volume-unavailable"
  );
});

test("CVD carries the prior close across complete chart bars and resets only at a confirmed anchor", () => {
  const stamps = [0, 5 * minute, 10 * minute, 15 * minute, day];
  const rows = stamps.flatMap((start) =>
    Array.from({ length: 5 }, (_, i) => lower(start + i * minute, 10, 11, 1))
  );
  const complete = run("cumulative-volume-delta", stamps.map(bar), history(rows));
  assert.deepEqual(complete.series.delta, [5, 10, 15, 20, 5]);
  assert.deepEqual(complete.series["$delta:open"], [0, 5, 10, 15, 0]);
  const missingChartCandle = run(
    "cumulative-volume-delta",
    stamps.filter((stamp) => stamp !== 5 * minute).map(bar),
    history(rows)
  );
  assert.deepEqual(missingChartCandle.series.delta, [5, null, null, 5]);
  const missingLowerCandle = run(
    "cumulative-volume-delta",
    stamps.map(bar),
    history(rows.filter(({ timestamp }) => timestamp !== 7 * minute))
  );
  assert.deepEqual(missingLowerCandle.series.delta, [5, null, null, null, 5]);
});

test("source wiring preserves base units for both public venues and rejects mismatched instruments", async () => {
  const seen = [];
  const fake = (venue) => async (ref, interval, range, signal) => {
    seen.push([venue, ref.provider, interval, range.maxPages, signal.aborted]);
    return [{ timestamp: 0, open: 9, close: 8, baseVolume: 5, quoteTurnover: 250 }];
  };
  for (const [provider, symbol] of [
    ["bybit", "BTCUSDT"],
    ["okx", "BTC-USDT"]
  ]) {
    const providerRef = { provider, category: "spot", symbol };
    const row = {
      uid: `${provider}:spot:${symbol}`,
      providerRef,
      assetClass: "crypto",
      baseCoin: "BTC"
    };
    const value = await loadPublicIntrabarVolume(
      row,
      "1m",
      { from: 0, to: minute },
      new AbortController().signal,
      fake("bybit"),
      fake("okx")
    );
    assert.deepEqual(value.bars, [lower(0, 9, 8, 5)]);
    assert.equal(value.currency, "BTC");
    assert.equal(
      await loadPublicIntrabarVolume(
        { ...row, uid: "bank" },
        "1m",
        { from: 0, to: minute },
        new AbortController().signal,
        fake("bybit"),
        fake("okx")
      ),
      null
    );
  }
  assert.deepEqual(seen, [
    ["bybit", "bybit", "1m", 3, false],
    ["okx", "okx", "1m", 3, false]
  ]);
});

test("both engines paint wick and body geometry and scale using both volume extrema", () => {
  const [delta] = volumeDeltaStudies;
  const technical = new TechnicalRenderData(context);
  technical.setData(parents);
  const payload = { volumeStudies: { intrabarVolume: history(sample) } };
  const instance = createTechnicalIndicatorInstance("volume-delta", "volume-delta");
  assert.equal(technical.setSupplementalInputs(payload, "other"), false);
  assert.deepEqual(technical.compile([instance]).outputs[0].values, [null, null]);
  assert.equal(technical.setSupplementalInputs(payload, uid), true);
  const [output] = technical.compile([instance]).outputs;
  assert.equal(output.presentation.geometry.kind, "candles");
  assert.deepEqual(
    klineRangeAnchorFigures([output]).map(({ values }) => values),
    [
      [-8, 0],
      [5, 0]
    ]
  );
  const pixelX = (index) => 10 + index * 10;
  const pixelY = (value) => 80 - 3 * value;
  const tv = new LightweightTechnicalPrimitive(
    {
      timeScale: () => ({
        getVisibleRange: () => ({ from: 300, to: 600 }),
        timeToCoordinate: (time) => pixelX(time === 300 ? 0 : 1),
        options: () => ({ barSpacing: 10 })
      })
    },
    { priceToCoordinate: pixelY },
    () => true
  );
  tv.attached({ requestUpdate() {} });
  tv.updatePlot(output);
  const tvCanvas = canvas();
  tv.paneViews()[0].renderer().draw(tvCanvas.target);
  assert.deepEqual(tv.autoscaleInfo(), { priceRange: { minValue: -8, maxValue: 5 } });
  const kl = recordingContext();
  const figureContext = { outputs: [output], levels: [], disposed: false, fills: [] };
  assert.equal(
    drawKlineTechnical({
      ctx: kl,
      bounding: { width: 200, height: 100 },
      barSpace: { bar: 10 },
      visibleRange: { from: 0, to: 2 },
      xAxis: { convertToPixel: pixelX },
      yAxis: { convertToPixel: pixelY },
      indicator: { extendData: { context: figureContext } }
    }),
    true
  );
  const fills = (calls) => calls.filter(([method]) => method === "fillRect");
  assert.deepEqual(fills(tvCanvas.commands), [
    ["fillRect", 9.5, 65, 1, 39],
    ["fillRect", 6.5, 80, 7, 15],
    ["fillRect", 16.5, 80, 7, 1]
  ]);
  assert.deepEqual(fills(kl.calls), fills(tvCanvas.commands));
  assert.throws(
    () =>
      compilePresentation(delta.definition.presentation, {
        timestamps: output.timestamps,
        series: { ...run("volume-delta", parents, history(sample)).series, "$delta:low": [2, 0] },
        visible: true,
        collapsed: false
      }),
    /candle range/
  );
});

test("native KLine scales both delta wick anchors until the candle output is hidden", async (t) => {
  const fixture = klineFixture();
  t.after(() => fixture.dispose());
  const technical = new TechnicalRenderData(context);
  technical.setData(parents);
  technical.setSupplementalInputs({ volumeStudies: { intrabarVolume: history(sample) } }, uid);
  const instance = createTechnicalIndicatorInstance("volume-delta", "native-delta", {
    pane: { kind: "pane", id: "native-delta" }
  });
  const pane = "technical:native-delta";
  fixture.set(technical.compile([instance]));
  await fixture.ready();
  const owner = fixture.entries(pane)[0];
  assert.equal(owner.result[0].__mtpRangeAnchor_delta_low, -8);
  assert.equal(owner.result[0].__mtpRangeAnchor_delta_high, 5);
  assert.ok(fixture.range(pane).from <= -8);
  assert.ok(fixture.range(pane).to >= 5);
  assert.equal(JSON.stringify(fixture.tooltip(owner)).includes("__mtpRangeAnchor"), false);

  instance.styles = { delta: { color: "#158977", width: 1, visible: false } };
  fixture.set(technical.compile([instance]));
  await fixture.ready();
  assert.ok(
    fixture
      .entries(pane)
      .every((entry) => entry.figures.every((figure) => !figure.key.startsWith("__mtpRangeAnchor")))
  );
});

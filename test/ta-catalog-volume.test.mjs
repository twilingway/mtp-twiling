import assert from "node:assert/strict";
import test from "node:test";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const load = createSourceLoader();
const { volumeStudies } = load("model/technical-indicators/catalog-expansion/volume.js");
const [klinger, relative] = volumeStudies;
const { calculateTechnicalIndicator, createTechnicalIndicatorInstance } = load(
  "model/technical-indicators/index.js"
);
const { technicalCatalogEntries } = load("model/technical-indicators/catalog.js");
const { technicalCalculationContext } = load("charts/technical-calculation-context.js");
const hour = 3_600_000;
const day = 24 * hour;
const candle = (timestamp, volume, close = 100) => ({
  timestamp,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume
});
const calculationContext = (chartInterval, properties = {}) => ({
  historicalVolatilityPeriodsPerYear: 365,
  chartInterval,
  ...properties
});
const relativeParams = { anchor: "1d", length: 2, mode: "regular" };

test("volume catalog registers Klinger, RVAT and quote turnover, leaving unsupported studies unavailable", () => {
  const entries = new Map(
    technicalCatalogEntries("en").map((entry) => [entry.id, entry.available])
  );
  for (const study of volumeStudies) assert.equal(entries.get(study.catalogId), true);
  for (const catalogId of [
    "STD;Net%1Volume",
    "STD;Cumulative%1Volume%1Index",
    "VolumeDelta@tv-basicstudies",
    "CumulativeVolumeDelta@tv-basicstudies",
    "STD;UP_DOWN_Volume"
  ])
    assert.equal(entries.get(catalogId), false);
});

test("Klinger uses actual volumes, preserves missing observations, and plots both output lines", () => {
  const bars = [
    [11, 9, 10, 7],
    [14, 8, 11, 10],
    [13, 9, 11, 6],
    [12, 10, 10, null],
    [10, 8, 9, 14]
  ].map(([high, low, close, volume], index) => ({
    ...candle(index * day, volume, close),
    high,
    low
  }));
  const instance = createTechnicalIndicatorInstance(klinger.definition.id, "klinger-1", {
    params: { fastLength: 1, slowLength: 3, signalLength: 3 }
  });
  const result = calculateTechnicalIndicator(instance, bars);
  assert.deepEqual(result.series.oscillator.slice(0, 4), [null, 0, -150, null]);
  assert.deepEqual(result.series.signal.slice(0, 4), [null, 0, -75, null]);
  assert.ok(Number.isFinite(result.series.oscillator[4]));
  assert.equal(result.warmupBars, 2);
  const { TechnicalRenderData } = load("charts/technical-render-data.js");
  const render = new TechnicalRenderData();
  render.setData(bars);
  assert.deepEqual(
    render.compile([instance]).outputs.map(({ outputId, kind }) => [outputId, kind]),
    [
      ["oscillator", "line"],
      ["signal", "line"]
    ]
  );
});

test("daily RVAT uses previous chart bars, excludes the current volume, and keeps true zero", () => {
  const bars = [10, 30, 20, 0, null, 50].map((volume, i) => candle(i * day, volume));
  const instance = createTechnicalIndicatorInstance(relative.definition.id, "rvat-1", {
    params: relativeParams
  });
  const result = calculateTechnicalIndicator(instance, bars, calculationContext("1d"));
  assert.deepEqual(result.series.value, [null, null, 1, 0, null, null]);
  assert.equal(result.warmupBars, 3);
  assert.equal(result.historyRequirement.requiredPeriods, 3);
});

test("intraday RVAT measures equal UTC offsets with consecutive crypto history", () => {
  const bars = [
    ...Array.from({ length: 6 }, (_, i) => candle(i * 4 * hour, 10)),
    ...Array.from({ length: 6 }, (_, i) => candle(day + i * 4 * hour, 30)),
    candle(2 * day, 30),
    candle(2 * day + 4 * hour, 10)
  ];
  for (const [provider, symbol] of [
    ["bybit", "BTCUSDT"],
    ["okx", "BTC-USDT"]
  ]) {
    const row = { assetClass: "crypto", providerRef: { provider, category: "spot", symbol } };
    const context = technicalCalculationContext("4h", row);
    assert.deepEqual(relative.calculate(bars, relativeParams, context).value.slice(-2), [1.5, 0.5]);
    assert.deepEqual(
      relative.calculate(bars, { ...relativeParams, mode: "cumulative" }, context).value.slice(-2),
      [1.5, 1]
    );
  }
  const bank = technicalCalculationContext("4h", { exchange: "MOEX" });
  const tokenized = technicalCalculationContext("4h", {
    assetClass: "tokenized-stock",
    providerRef: { provider: "bybit", category: "spot", symbol: "AAPLXUSDT" }
  });
  assert.equal(relative.unavailableReason(bars.length, relativeParams, bank), "volume-unavailable");
  assert.equal(
    relative.unavailableReason(bars.length, relativeParams, tokenized),
    "volume-unavailable"
  );
  assert.deepEqual(
    relative.calculate(bars, relativeParams, bank).value,
    bars.map(() => null)
  );
});

test("RVAT leaves interior data holes and missing anchor periods unknown", () => {
  const utcCrypto = calculationContext("4h", { exchangeTimeZone: "UTC", continuousSession: true });
  const complete = (date) =>
    Array.from({ length: 6 }, (_, i) => candle(date * day + i * 4 * hour, 10));
  const withHole = [
    ...complete(0),
    ...complete(1).filter((_, index) => index !== 3),
    candle(2 * day, 10)
  ];
  const missingPeriod = [...complete(0), ...complete(1), candle(3 * day, 10)];
  for (const bars of [withHole, missingPeriod])
    assert.equal(relative.calculate(bars, relativeParams, utcCrypto).value.at(-1), null);
});

test("RVAT uses supplied session coverage and leaves unmatched chart observations empty", () => {
  const first = candle(hour, 10);
  const second = candle(day + hour, 30);
  const third = candle(2 * day + hour, 40);
  const explicit = [first, second, third].map((bar) => ({
    anchorTimestamp: bar.timestamp,
    hasAnchorCoverage: true,
    bars: [bar]
  }));
  const context = calculationContext("1h", {
    volumeStudies: { relativeVolumePeriods: { "1d": explicit } }
  });
  const bars = [first, second, third, candle(third.timestamp + hour, 1000)];
  assert.deepEqual(relative.calculate(bars, relativeParams, context).value, [null, null, 2, null]);
  assert.equal(
    relative.unavailableReason(
      10_000,
      { ...relativeParams, length: 500 },
      calculationContext("1d")
    ),
    "calculation-limit"
  );
});

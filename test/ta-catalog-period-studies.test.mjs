import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { periodStudies, priceLevelRequests } = load(
  "model/technical-indicators/catalog-expansion/period-studies.js"
);
const { normalizePriceLevelPeriods, chartPriceLevelPeriods, heikinAshiPriceLevelPeriods } = load(
  "model/technical-indicators/catalog-expansion/level-periods.js"
);
const { loadPriceLevelPeriods } = load("services/technical-price-level-history.js");
const [pivots, multiTime] = periodStudies;
const day = 86_400_000;
const hour = 3_600_000;
const utc = (month, day) => Date.UTC(2026, month - 1, day);
const bar = (timestamp, open, high = open + 4, low = open - 3, close = open + 1) => ({
  timestamp,
  open,
  high,
  low,
  close,
  volume: 42
});
const defaults = (study) =>
  Object.fromEntries(
    study.definition.parameters.map(({ key, defaultValue }) => [key, defaultValue])
  );

test("UTC Bybit and OKX periods do not treat missing bars as closed venue days", () => {
  const friday = utc(11, 27);
  const monday = utc(11, 30);
  const candles = [bar(friday, 42), bar(monday, 50)];
  for (const venue of ["bybit", "okx"]) {
    const periods = normalizePriceLevelPeriods(candles, "1d", { venue, asOf: monday + hour });
    assert.deepEqual(
      periods.map(({ startsAt, endsAt }) => [startsAt, endsAt]),
      [
        [friday, friday + day],
        [monday, monday + day]
      ]
    );
    assert.equal(periods[1].followsPrevious, false);
  }
  assert.throws(() =>
    normalizePriceLevelPeriods([bar(monday - 8 * hour, 50)], "1d", { venue: "okx", asOf: monday })
  );
});

test("Bank history links sparse native periods only with coverage, and accepts actual session bounds", () => {
  const friday = utc(11, 27);
  const monday = utc(11, 30);
  const candles = [bar(friday, 42), bar(monday, 50)];
  const options = {
    venue: "tbank",
    asOf: monday + hour,
    sessionBounds: new Map([[monday, { start: monday - 2 * hour, end: monday + 20 * hour }]])
  };
  assert.equal(normalizePriceLevelPeriods(candles, "1d", options)[1].followsPrevious, false);
  const [, second] = normalizePriceLevelPeriods(candles, "1d", {
    ...options,
    coveredRanges: [{ from: friday + day, to: monday }]
  });
  assert.deepEqual(second, {
    startsAt: monday - 2 * hour,
    endsAt: monday + 20 * hour,
    open: 50,
    high: 54,
    low: 47,
    close: 51,
    followsPrevious: true
  });
});

test("Monthly input forms only complete historical quarters and a continuous developing quarter", () => {
  const months = [1, 2, 3, 5, 6, 7, 8].map((month) => bar(utc(month, 1), 100 + month));
  const result = normalizePriceLevelPeriods(months, "3M", { venue: "bybit", asOf: utc(8, 1) });
  assert.deepEqual(
    result.map(({ startsAt, endsAt, open, close, followsPrevious }) => ({
      startsAt,
      endsAt,
      open,
      close,
      followsPrevious
    })),
    [
      { startsAt: utc(1, 1), endsAt: utc(4, 1), open: 101, close: 104, followsPrevious: false },
      { startsAt: utc(7, 1), endsAt: utc(10, 1), open: 107, close: 109, followsPrevious: false }
    ]
  );
});

test("Read requests deduplicate UTC intervals, suppress hidden studies and expose the real defaults", () => {
  assert.deepEqual(defaults(pivots), {
    method: "traditional",
    timeframe: "auto",
    useDailyBased: true,
    periodsBack: 15,
    showLabels: true,
    showPrices: true,
    labelSide: "Left"
  });
  assert.deepEqual(defaults(multiTime), {
    autoTimeframe: true,
    timeframe: "1M",
    calculation: "high-low",
    heikinAshi: false,
    useDailyBased: false
  });
  const timeline = [utc(11, 1), utc(11, 20)];
  const instances = [
    { definitionId: "pivot-points-standard", params: defaults(pivots), visible: true },
    {
      definitionId: "multi-time-period-charts",
      params: {
        ...defaults(multiTime),
        autoTimeframe: false,
        heikinAshi: true,
        useDailyBased: true
      },
      visible: true
    },
    { definitionId: "multi-time-period-charts", params: defaults(multiTime), visible: false }
  ];
  assert.deepEqual(priceLevelRequests(instances, "1d", timeline), [
    { interval: "1M", from: timeline[0], to: timeline[1], precedingTradingPeriods: 20 }
  ]);
});

test("Overlay output uses native vs chart-based prices, preserving separate style/labels", () => {
  const date = utc(11, 23);
  const raw = [bar(date, 200), bar(date + day, 300), bar(date + 2 * day, 400)];
  const bars = [
    bar(date + hour, 100),
    bar(date + day + hour, 110),
    bar(date + 2 * day + hour, 130)
  ];
  const source = normalizePriceLevelPeriods(raw, "1d", {
    venue: "bybit",
    asOf: date + 2 * day + hour
  });
  const context = {
    historicalVolatilityPeriodsPerYear: 365,
    chartInterval: "1h",
    priceLevelPeriods: { "1d": source }
  };
  const nativePivots = pivots.priceRegions(bars, { ...defaults(pivots), timeframe: "1d" }, context);
  const chartPivots = pivots.priceRegions(
    bars,
    {
      ...defaults(pivots),
      timeframe: "1d",
      useDailyBased: false,
      labelSide: "Right"
    },
    context
  );
  assert.deepEqual(
    nativePivots.filter(({ styleId }) => styleId === "P").map(({ low }) => low),
    [(204 + 197 + 201) / 3, (304 + 297 + 301) / 3]
  );
  const [point] = chartPivots.filter(({ styleId }) => styleId === "P");
  assert.equal(point.low, (114 + 107 + 111) / 3);
  assert.equal(point.labelEdge, "right");
  assert.equal(chartPivots.filter(({ styleId }) => styleId === "P").length, 1);

  const boxes = multiTime.priceRegions(
    bars,
    { ...defaults(multiTime), calculation: "ohlc" },
    context
  );
  assert.deepEqual(
    boxes.map(({ styleId, low, high }) => [styleId, low, high]),
    [
      ["high-low-up", 107, 114],
      ["open-close-up", 110, 111],
      ["high-low-up", 127, 134],
      ["open-close-up", 130, 131]
    ]
  );
  assert.equal(
    pivots.unavailableReason(bars.length, defaults(pivots), context),
    "external-data-unavailable"
  );
});

test("Chart aggregation does not link through a missing slot or carry a Heikin Ashi seed over it", () => {
  const date = utc(11, 23);
  const bars = [
    bar(date, 100, 107, 95, 105),
    bar(date + day, 116, 120, 115, 117),
    bar(date + 3 * day, 150, 160, 140, 140)
  ];
  const bounds = normalizePriceLevelPeriods(
    Array.from({ length: 4 }, (_, index) => bar(date + index * day, 90)),
    "1d",
    { venue: "bybit", asOf: date + 3 * day + hour }
  );
  const computed = chartPriceLevelPeriods(bars, bounds);
  assert.deepEqual(
    computed.map(({ followsPrevious }) => followsPrevious),
    [false, true, false]
  );
  const ha = heikinAshiPriceLevelPeriods(computed);
  assert.equal(ha[0].open, 102.5);
  assert.equal(ha[1].open, (102.5 + 101.75) / 2);
  assert.equal(ha[2].open, 145);
});

test("Supplemental reader walks back to an actual bank candle and passes the identity and signal", async () => {
  const friday = utc(11, 27);
  const monday = utc(11, 30);
  const requests = [];
  const controller = new AbortController();
  const candles = [bar(friday, 20), bar(monday, 30)];
  const periods = await loadPriceLevelPeriods(
    {
      interval: "1d",
      from: monday + hour,
      to: monday + 2 * hour,
      precedingTradingPeriods: 1
    },
    {
      symbol: "SBER",
      uid: "bank-uid",
      asOf: monday + 2 * hour,
      venue: "tbank",
      signal: controller.signal,
      async loadCandles(symbol, timeframe, range, options) {
        assert.equal(symbol, "SBER");
        assert.equal(options.uid, "bank-uid");
        assert.equal(options.signal, controller.signal);
        requests.push([range.from, range.to]);
        return {
          symbol,
          timeframe,
          requestedRangeCovered: true,
          candles: candles.filter(
            ({ timestamp }) => timestamp >= range.from && timestamp <= range.to
          )
        };
      }
    }
  );
  assert.equal(requests.length, 3);
  assert.deepEqual(
    periods.map(({ startsAt }) => startsAt),
    [friday, monday]
  );
  assert.equal(periods[1].followsPrevious, true);
});

test("Supplemental history rejects stale-source results and respects an already aborted signal", async () => {
  const date = utc(11, 23);
  const request = { interval: "1w", from: date, to: date + hour, precedingTradingPeriods: 1 };
  const controller = new AbortController();
  const source = {
    symbol: "BTC",
    uid: "bybit:spot:BTC",
    asOf: date + day,
    venue: "bybit",
    signal: controller.signal,
    loadCandles: async () => ({ symbol: "ETH", timeframe: "1w", candles: [] })
  };
  await assert.rejects(loadPriceLevelPeriods(request, source), /another chart source/);
  controller.abort();
  await assert.rejects(loadPriceLevelPeriods(request, source), { name: "AbortError" });
});

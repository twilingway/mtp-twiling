import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { autoKeyLevelStudies, autoKeyLevelTradeRange, autoKeyLevelPriceRequests } = load(
  "model/technical-indicators/catalog-expansion/auto-key-levels.js"
);
const { priceVolumeProfile, mergePriceVolumeHistory } = load(
  "model/technical-indicators/catalog-expansion/price-volume-history.js"
);
const [study] = autoKeyLevelStudies;
const defaultParams = Object.fromEntries(
  study.definition.parameters.map(({ key, defaultValue }) => [key, defaultValue])
);
const HOUR = 3_600_000,
  DAY = 24 * HOUR,
  start = Date.UTC(2026, 0, 4);
const market = "okx:spot:BTC-USDT";
const candle = (timestamp, price) => ({
  timestamp,
  open: price,
  high: price + 1,
  low: price - 1,
  close: price,
  volume: 10000
});
const trade = (id, timestamp, price, quantity) => ({ id, timestamp, price, quantity });
const observed = {
  historicalVolatilityPeriodsPerYear: 365,
  chartInterval: "1h",
  continuousSession: true,
  priceStep: 1
};
const values = (regions) => Object.fromEntries(regions.map(({ label, low }) => [label.name, low]));
const makeHistory = (from, to, trades, instrumentKey = market) => ({
  instrumentKey,
  coverage: { from, to },
  trades
});

test("price bins conserve executed quantities and respect half-open windows", () => {
  const history = makeHistory(start, start + DAY + 1, [
    trade("1", start, 100, 8),
    trade("2", start + 1, 100, 1),
    trade("3", start + HOUR, 102, 3),
    trade("4", start + DAY, 100, 200)
  ]);
  assert.deepEqual(priceVolumeProfile(history, { from: start, to: start + DAY }, 1), [
    { low: 99.5, high: 100.5, volume: 9 },
    { low: 100.5, high: 101.5, volume: 0 },
    { low: 101.5, high: 102.5, volume: 3 }
  ]);
  assert.deepEqual(priceVolumeProfile(history, { from: start + DAY, to: start + DAY + 1 }, 1), [
    { low: 99.5, high: 100.5, volume: 200 }
  ]);
  assert.deepEqual(priceVolumeProfile(history, { from: start - 1, to: start + DAY }, 1), []);
  assert.deepEqual(priceVolumeProfile(history, { from: start, to: start + DAY }, undefined), []);
  const malformed = makeHistory(start, start + HOUR, [trade("1", start, 100.25, 1)]);
  assert.deepEqual(priceVolumeProfile(malformed, malformed.coverage, 1), []);
});

test("adjacent certified reads merge by execution ID while conflicting or separated reads do not", () => {
  const older = makeHistory(start, start + 5, [
    trade("a", start, 1, 1),
    trade("b", start + 4, 2, 3)
  ]);
  const fresh = makeHistory(start + 4, start + 8, [
    trade("b", start + 4, 2, 3),
    trade("c", start + 7, 3, 4)
  ]);
  const merged = mergePriceVolumeHistory(older, fresh);
  assert.deepEqual(merged.coverage, { from: start, to: start + 8 });
  assert.deepEqual(
    merged.trades.map(({ id }) => id),
    ["a", "b", "c"]
  );
  const foreign = makeHistory(start + 4, start + 8, fresh.trades, "other");
  assert.equal(mergePriceVolumeHistory(older, foreign), foreign);
  const disconnected = makeHistory(start + 6, start + 8, [fresh.trades.at(-1)]);
  assert.equal(mergePriceVolumeHistory(older, disconnected), disconnected);
  const conflicting = makeHistory(start + 4, start + 8, [
    { ...fresh.trades[0], quantity: 7 },
    fresh.trades.at(-1)
  ]);
  assert.equal(mergePriceVolumeHistory(older, conflicting), conflicting);
});

test("period prices roll forward independently of incomplete or unavailable profile history", () => {
  const bars = Array.from({ length: 26 }, (_, index) => candle(start + index * HOUR, 100 + index));
  const profile = makeHistory(start + DAY, start + 25 * HOUR + 5, [
    trade("a", start + DAY, 130, 1),
    trade("b", start + 25 * HOUR, 132, 9)
  ]);
  const coverage = { ...observed, autoKeyLevelTrades: profile };
  const r = study.priceRegions(bars, defaultParams, coverage);
  assert.deepEqual(values(r), {
    pdO: 100,
    pdH: 124,
    pdL: 99,
    pdC: 123,
    dO: 124,
    dH: 126,
    dL: 123,
    dC: 125,
    dPOC: 132,
    dVAL: 131.5,
    dVAH: 132.5
  });
  assert.equal(r.find(({ label }) => label.name === "pdO").startTimestamp, start);
  const partial = study.priceRegions(bars.slice(1, 24), defaultParams, observed);
  assert.deepEqual(partial, []);
  const late = study.priceRegions(bars, { ...defaultParams, levelsStart: "current-bar" }, observed);
  assert.ok(late.every(({ startTimestamp }) => startTimestamp === bars.at(-1).timestamp));
  assert.deepEqual(values(late), {
    pdO: 100,
    pdH: 124,
    pdL: 99,
    pdC: 123,
    dO: 124,
    dH: 126,
    dL: 123,
    dC: 125
  });
});

test("supplemental venue periods can bridge a proved nontrading weekend only", () => {
  const monday = Date.UTC(2026, 0, 5);
  const friday = monday - 3 * DAY;
  const history = [
    {
      startsAt: friday,
      endsAt: friday + DAY,
      open: 12,
      high: 16,
      low: 11,
      close: 15
    },
    {
      startsAt: monday,
      endsAt: monday + DAY,
      open: 17,
      high: 20,
      low: 16,
      close: 18,
      followsPrevious: true
    }
  ];
  const bars = [candle(friday + 3 * HOUR, 15), candle(monday + 2 * HOUR, 18)];
  const venue = { ...observed, continuousSession: false, priceLevelPeriods: { "1d": history } };
  assert.deepEqual(values(study.priceRegions(bars, defaultParams, venue)), {
    pdO: 12,
    pdH: 16,
    pdL: 11,
    pdC: 15,
    dO: 17,
    dH: 20,
    dL: 16,
    dC: 18
  });
  const incomplete = {
    ...venue,
    priceLevelPeriods: { "1d": [history[0], { ...history[1], followsPrevious: false }] }
  };
  assert.equal(values(study.priceRegions(bars, defaultParams, incomplete)).pdO, undefined);
});

test("request selectors skip disabled, hidden and too-short groups and bound the active candle", () => {
  const instance = { definitionId: "auto-key-levels", params: defaultParams, visible: true };
  const last = start + DAY + 4 * HOUR;
  assert.deepEqual(autoKeyLevelTradeRange([instance], "1h", last, last + HOUR * 4), {
    from: start,
    to: last + HOUR
  });
  assert.deepEqual(autoKeyLevelPriceRequests([instance], "1h", last), [
    { interval: "1d", from: start, to: last, precedingTradingPeriods: 1 }
  ]);
  assert.equal(autoKeyLevelTradeRange([instance], "1w", last, last + HOUR), null);
  assert.deepEqual(autoKeyLevelPriceRequests([{ ...instance, visible: false }], "1h", last), []);
  assert.equal(
    autoKeyLevelTradeRange(
      [
        {
          ...instance,
          params: { ...defaultParams, currentDay: "ohlc", previousDay: "off" }
        }
      ],
      "1h",
      last,
      last + HOUR
    ),
    null
  );
});

test("catalog restores level group selections and color visibility", () => {
  const { technicalDefinitionForCatalog } = load("model/technical-indicators/catalog.js");
  const { createTechnicalIndicatorInstance, isTechnicalIndicatorInstance } = load(
    "model/technical-indicators/instances.js"
  );
  const { TechnicalRenderData } = load("charts/technical-render-data.js");
  assert.equal(technicalDefinitionForCatalog("STD;Auto_Key_Levels"), "auto-key-levels");
  const selected = createTechnicalIndicatorInstance("auto-key-levels", "levels", {
    params: {
      currentDay: "ohlc",
      previousDay: "off",
      custom: "ohlc",
      anchor: "1d",
      customLength: 1
    },
    styles: { currentDay: { width: 2, color: "#ab1cce", visible: false } }
  });
  assert.ok(isTechnicalIndicatorInstance(JSON.parse(JSON.stringify(selected))));
  const render = new TechnicalRenderData({ ...observed, chartInterval: "1d" });
  render.setData([candle(start, 15), candle(start + DAY, 20)]);
  const { priceRegions } = render.compile([selected]);
  assert.deepEqual(values(priceRegions), {
    "Custom O": 15,
    "Custom H": 21,
    "Custom L": 14,
    "Custom C": 20
  });
  assert.ok(priceRegions.every(({ styleId }) => styleId === "custom"));
});

test("fresh scoped transactions recalculate volume levels without replacing displayed candles", () => {
  const { createTechnicalIndicatorInstance } = load("model/technical-indicators/instances.js");
  const { TechnicalRenderData } = load("charts/technical-render-data.js");
  const render = new TechnicalRenderData(observed);
  render.setData([candle(start, 100), candle(start + HOUR, 101)]);
  const selected = createTechnicalIndicatorInstance("auto-key-levels", "levels");
  const current = () => values(render.compile([selected]).priceRegions);
  const trades = [trade("one", start, 101, 10)];
  assert.equal(current().dO, 100);
  assert.equal(current().dPOC, undefined);
  const incorrect = makeHistory(start, start + HOUR + 1, trades, "other");
  assert.equal(
    render.setSupplementalInputs(
      {
        autoKeyLevelTrades: incorrect,
        instrumentUid: market
      },
      market
    ),
    false
  );
  assert.equal(current().dPOC, undefined);
  const matching = makeHistory(start, start + HOUR + 1, trades);
  assert.equal(
    render.setSupplementalInputs(
      {
        autoKeyLevelTrades: matching,
        instrumentUid: "other"
      },
      market
    ),
    false
  );
  assert.equal(
    render.setSupplementalInputs(
      {
        autoKeyLevelTrades: matching,
        instrumentUid: market
      },
      market
    ),
    true
  );
  assert.equal(current().dPOC, 101);
  assert.equal(current().dO, 100);
  assert.equal(render.setSupplementalInputs({}, market), true);
  assert.equal(current().dPOC, undefined);
});

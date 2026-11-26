import assert from "node:assert/strict";
import test from "node:test";
import * as react from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { backup } from "./keltner-fixture.mjs";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const load = createSourceLoader({ react, "react/jsx-runtime": jsxRuntime });
const {
  applyLatestPerformanceTrade,
  coveredDailyRange,
  coveredMonthlyRange,
  dailyPerformanceDataset,
  normalizeSeasonalityHistory,
  performancePeriodDays,
  performanceTargets,
  seasonalProjectionRegions
} = load("model/technical-indicators/catalog-expansion/calendar-analysis-data.js");
const { seasonalChanges } = load("model/technical-indicators/ta-batch-sessions-seasonality.js");
const core = load("model/technical-indicators/index.js");
const catalog = load("model/technical-indicators/catalog.js");
const { assertReadableDrivePayload } = load("services/drive/reader-guard.js");
const at = Date.parse;
const daily = (day, close, confirmed) => ({
  timestamp: at(day),
  close,
  ...(confirmed !== undefined && { confirmed })
});

const btcBybit = {
  uid: "bybit:spot:BTCUSDT",
  ticker: "BTCUSDT",
  symbol: "BTCUSDT",
  assetClass: "crypto",
  providerRef: { provider: "bybit" },
  price: null
};
const btcOkx = {
  uid: "okx:spot:BTC-USDT",
  ticker: "BTCUSDT",
  symbol: "BTC-USDT",
  assetClass: "crypto",
  providerRef: { provider: "okx" },
  price: null
};
const moex = { uid: "moex-id", ticker: "SBER", symbol: "SBER", exchange: "MOEX", price: null };

test("calendar studies register as overlays and reject invalid persisted inputs", () => {
  assert.equal(catalog.technicalDefinitionForCatalog("STD;Performance"), "performance");
  assert.equal(catalog.technicalDefinitionForCatalog("STD;Seasonality"), "seasonality");
  const performance = core.createTechnicalIndicatorInstance("performance", "compare", {
    params: { comparisonSymbols: "BYBIT:BTCUSDT, MOEX:SBER", comparisonPeriods: "1W, YTD" }
  });
  const season = core.createTechnicalIndicatorInstance("seasonality", "calendar", {
    params: { startYear: 2020, ignoredMonths: "2020-03, 2022-11" }
  });
  assert.deepEqual(
    assertReadableDrivePayload(backup([performance, season])).layout.technicalIndicators,
    [performance, season]
  );
  assert.throws(
    () =>
      core.createTechnicalIndicatorInstance("performance", "bad-period", {
        params: { comparisonPeriods: "20Y" }
      }),
    RangeError
  );
  assert.throws(
    () =>
      core.createTechnicalIndicatorInstance("seasonality", "bad-month", {
        params: { ignoredMonths: "2020-00" }
      }),
    RangeError
  );
  assert.throws(
    () =>
      core.createTechnicalIndicatorInstance("performance", "pane", {
        pane: { kind: "pane", id: "detached" }
      }),
    RangeError
  );
});

test("source-qualified symbols choose their own provider and ambiguous symbols remain unresolved", () => {
  const rows = [btcBybit, btcOkx, moex];
  const selected = performanceTargets(
    true,
    "MOEX:SBER, BTCUSDT, bybit:spot:BTCUSDT, OKX:BTC-USDT, UNKNOWN",
    btcBybit,
    rows
  );
  assert.deepEqual(
    selected.map(({ label, row, error }) => [label, row?.uid ?? error]),
    [
      ["BTCUSDT", btcBybit.uid],
      ["MOEX:SBER", moex.uid],
      ["BTCUSDT", "ambiguous"],
      ["OKX:BTC-USDT", btcOkx.uid],
      ["UNKNOWN", "unknown"]
    ]
  );
});

test("daily performance selects an actual anchor, supports same-day market updates and keeps gaps", () => {
  const data = [
    daily("2025-10-13T00:00Z", 121),
    daily("2025-10-10T00:00Z", 110, true),
    daily("2025-10-10T00:00Z", 999, false)
  ];
  const now = at("2025-10-13T12:00Z");
  const result = dailyPerformanceDataset("SBER", "Europe/Moscow", data, ["2D", "1M"], now);
  assert.deepEqual(
    result.cells.map(({ percent, anchorTimestamp }) => [percent, anchorTimestamp]),
    [
      [10, at("2025-10-10")],
      [null, null]
    ]
  );
  assert.equal(applyLatestPerformanceTrade(result, at("2025-10-13T13:00Z"), 132)[0].percent, 20);
  assert.equal(applyLatestPerformanceTrade(result, at("2025-10-13T21:00Z"), 190)[0].percent, 10);
  assert.equal(
    applyLatestPerformanceTrade(
      dailyPerformanceDataset(
        "SBER",
        "Europe/Moscow",
        [{ ...data[0], confirmed: true }, ...data.slice(1)],
        ["2D"],
        now
      ),
      at("2025-10-13T13:00Z"),
      132
    )[0].percent,
    10
  );
  assert.equal(applyLatestPerformanceTrade(result, NaN, 1000)[1].percent, null);
  assert.equal(performancePeriodDays("10Y"), 3660);
  assert.equal(performancePeriodDays("25Y"), undefined);
  assert.equal(coveredDailyRange(now, 7).from, now - 47 * 86400000);
  assert.equal(coveredMonthlyRange(now, 2024).from, at("2023-11-29"));
});

test("seasonal data confirms venue months and projects prices from only earlier samples", () => {
  const bars = [
    daily("2023-12-01T00:00Z", 100),
    daily("2024-01-01T00:00Z", 120),
    daily("2024-02-01T00:00Z", 132),
    daily("2024-03-01T00:00Z", 900, false),
    daily("2025-01-01T00:00Z", 200),
    daily("2025-02-01T00:00Z", 250, false)
  ];
  const history = normalizeSeasonalityHistory(bars, "Europe/Moscow", at("2025-02-26T12:00Z"));
  assert.equal(history.months.length, 5);
  assert.equal(history.months.at(-1).complete, false);
  assert.ok(history.months.slice(0, -1).every(({ complete }) => complete));
  const opts = { startYear: 2024 };
  const { cells, statistics } = seasonalChanges(history.months, opts);
  assert.equal(cells.at(-1).changePercent, 25);
  assert.equal(statistics[1].count, 1);
  assert.equal(statistics[1].average, 10);
  assert.equal(cells.at(-1).projection.expectedClose, 220.00000000000003);
  const candles = [daily("2025-01-30", 190), daily("2025-02-02", 210), daily("2025-02-24", 245)];
  const [region] = seasonalProjectionRegions(candles, history, opts);
  assert.deepEqual(region, {
    startTimestamp: candles[1].timestamp,
    endTimestamp: candles[2].timestamp,
    startEdge: "left",
    endEdge: "right",
    low: 200,
    high: 220.00000000000003,
    styleId: "positive",
    label: { name: "+10.00%" }
  });
  assert.deepEqual(
    seasonalProjectionRegions(candles, history, { ...opts, ignoredMonths: ["2024-02"] }),
    []
  );
  const nextMonth = normalizeSeasonalityHistory(
    [daily("2025-02-01", 250)],
    "Europe/Moscow",
    at("2025-02-28T21:00Z")
  );
  assert.equal(nextMonth.months[0].complete, true);
});

test("both tables expose headings, history statuses, anchor dates, and provisional months", () => {
  const { CalendarAnalysisTables } = load("screens/terminal/CalendarAnalysisTables.js");
  const performance = core.createTechnicalIndicatorInstance("performance", "performance");
  const season = core.createTechnicalIndicatorInstance("seasonality", "seasonality", {
    params: { startYear: 2024 }
  });
  const html = renderToStaticMarkup(
    react.createElement(CalendarAnalysisTables, {
      locale: "en",
      tables: [
        {
          kind: "performance",
          id: "performance",
          params: performance.params,
          periods: ["2D"],
          rows: [
            {
              label: "SBER",
              status: "ready",
              timeZone: "Europe/Moscow",
              cells: [
                {
                  timeframe: "2D",
                  percent: 10,
                  anchorTimestamp: at("2025-10-10"),
                  anchorClose: 110
                }
              ]
            },
            { label: "BTCUSDT", status: "ambiguous", cells: [] }
          ]
        },
        {
          kind: "seasonality",
          id: "seasonality",
          symbol: "BTCUSDT",
          params: season.params,
          status: "ready",
          history: {
            timeZone: "UTC",
            months: [
              { year: 2023, month: 12, complete: true, close: 100 },
              { year: 2024, month: 1, complete: false, close: 120 }
            ]
          }
        }
      ]
    })
  );
  assert.match(html, /aria-label="Performance"/);
  assert.match(html, /aria-label="Seasonality · BTCUSDT"/u);
  assert.match(html, /scope="col">2D/);
  assert.match(html, /Oct 10, 2025/);
  assert.match(html, /\+10\.00%/);
  assert.match(html, /Specify the source in the symbol/);
  assert.match(html, /Month still open/);
  assert.match(html, /scope="row">Average/);
  assert.match(html, /role="region"[^>]+tabindex="0"/);
});

test("calendar history deduplicates sources and ignores a completed request from an earlier owner", async (t) => {
  const slots = [];
  let nextState = 0;
  let effect;
  const mockedReact = {
    useMemo: (fn) => fn(),
    useState(init) {
      const i = nextState++;
      slots[i] ??= init;
      return [
        slots[i],
        (fn) => {
          slots[i] = fn(slots[i]);
        }
      ];
    },
    useCallback: (fn) => fn,
    useEffect: (fn) => {
      effect = fn;
    }
  };
  const hook = createSourceLoader({ react: mockedReact })(
    "screens/terminal/use-calendar-analysis.js"
  ).useCalendarAnalysis;
  const calls = [];
  const loader = (row, timeframe, range, signal) =>
    new Promise((resolve) => calls.push({ row, timeframe, range, signal, resolve }));
  const initial = core.createTechnicalIndicatorInstance("performance", "p", {
    params: { comparisonPeriods: "1D" }
  });
  const options = {
    ownerKey: {},
    row: btcBybit,
    rows: [btcBybit],
    instances: [initial, { ...initial, id: "also-p" }],
    loadCandles: loader
  };
  const render = (o) => {
    nextState = 0;
    return hook(o);
  };
  assert.equal(render(options).tables[0].rows[0].status, "loading");
  const abort = effect();
  t.after(abort);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].timeframe, "1d");
  abort();
  assert.equal(calls[0].signal.aborted, true);
  const anotherOwner = { ...options, ownerKey: {} };
  render(anotherOwner);
  const clean = effect();
  t.after(clean);
  const first = [daily("2025-10-10", 100), daily("2025-10-11", 120)];
  calls[0].resolve(first);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(render(anotherOwner).tables[0].rows[0].status, "loading");
  calls[1].resolve([daily("2025-10-10", 100), daily("2025-10-11", 110)]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(render(anotherOwner).tables[0].rows[0].cells[0].percent, 10);
});

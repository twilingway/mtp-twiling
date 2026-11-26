import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const date = Date.UTC(2025, 10, 28);
const minute = 60_000;
const day = 86_400_000;
const bankRows = [
  { symbol: "SBER", uid: "bank-a" },
  { symbol: "SBER", uid: "bank-b" }
];
const nativePeriod = (open) => ({
  startsAt: date,
  endsAt: date + day,
  open,
  high: open + 1,
  low: open - 1,
  close: open
});
const chosen = (state) => state.rows.find(({ uid }) => uid === state.preferences.instrumentUid);
const flush = () => new Promise((resolve) => setImmediate(resolve));

function activePivot(timeframe = "auto") {
  return {
    definitionId: "pivot-points-standard",
    visible: true,
    params: {
      method: "traditional",
      timeframe,
      useDailyBased: true,
      periodsBack: 15,
      showPrices: true,
      showLabels: true,
      labelSide: "Left"
    }
  };
}

function fixture() {
  const effects = [];
  const requests = [];
  const boundCalls = [];
  const coverage = [];
  let session = {
    loadCandles() {
      boundCalls.push(this);
    }
  };
  let state = {
    owner: "profile-a",
    chartRevision: 0,
    marketReady: true,
    rows: bankRows,
    preferences: {
      symbol: "SBER",
      instrumentUid: "bank-a",
      timeframe: "5m",
      chartSettings: {},
      technicalIndicators: [activePivot()]
    },
    candles: [{ timestamp: date + minute }, { timestamp: date + 2 * minute }]
  };
  let currentValue = null;
  let deps;
  let cleanup;
  let effectEvent;

  const readClient = {
    sessionKey: () => session,
    getSnapshot: () => state
  };
  const load = sourceLoader({
    "screens/terminal/react": {
      useState: () => [
        currentValue,
        (value) => {
          currentValue = value;
        }
      ],
      useEffectEvent: (callback) => {
        effectEvent = callback;
        return (...args) => effectEvent(...args);
      },
      useEffect(effect, dependencies) {
        if (
          deps &&
          deps.length === dependencies.length &&
          deps.every((x, i) => x === dependencies[i])
        )
          return;
        deps = dependencies;
        effects.push(() => {
          cleanup?.();
          cleanup = effect();
        });
      }
    },
    "services/storage-v2.ts": {
      async loadCoverage(...identity) {
        coverage.push(identity);
        return [];
      }
    },
    "services/technical-price-level-history.ts": {
      loadPriceLevelPeriods(request, source) {
        return new Promise((resolve, reject) =>
          requests.push({ request, source, resolve, reject })
        );
      }
    }
  });
  const { usePriceLevelHistory } = load("screens/terminal/use-price-level-history.js");
  return {
    requests,
    boundCalls,
    coverage,
    initialSession: session,
    patch: (change) => {
      state = { ...state, ...change };
    },
    preferences: (change) => {
      state = { ...state, preferences: { ...state.preferences, ...change } };
    },
    replaceSession: () => {
      session = { loadCandles() {} };
    },
    render() {
      const value = usePriceLevelHistory(readClient, state, chosen(state));
      for (const effect of effects.splice(0)) effect();
      return value;
    },
    destroy: () => cleanup?.()
  };
}

test("Period hook coalesces same day candle updates and uses the history-only scoped port", async () => {
  const fx = fixture();
  assert.deepEqual(fx.render(), { status: "loading" });
  const [initial] = fx.requests;
  assert.deepEqual(initial.request, {
    interval: "1d",
    from: date,
    to: date,
    precedingTradingPeriods: 1
  });
  assert.equal(initial.source.uid, "bank-a");
  initial.source.loadCandles("SBER", "1d", { from: date, to: date + day });
  assert.deepEqual(fx.boundCalls, [fx.initialSession]);
  await initial.source.coveredRanges("1d");
  assert.deepEqual(fx.coverage, [["profile-a", "bank-a", "1d"]]);
  initial.resolve([nativePeriod(100)]);
  await flush();
  assert.equal(fx.render().status, "ready");
  fx.patch({ candles: [{ timestamp: date + minute }, { timestamp: date + 3 * minute }] });
  assert.equal(fx.render().status, "ready");
  assert.equal(fx.requests.length, 1);
  fx.destroy();
});

test("Auto Key Levels and a standard pivot reuse one history request for the same interval", async () => {
  const fx = fixture();
  fx.preferences({
    technicalIndicators: [
      activePivot("1d"),
      {
        definitionId: "auto-key-levels",
        visible: true,
        params: {
          currentDay: "both",
          previousDay: "ohlc",
          currentWeek: "off",
          previousWeek: "off",
          currentMonth: "off",
          previousMonth: "off",
          custom: "off",
          showOpen: true,
          showPoc: true
        }
      }
    ]
  });
  assert.deepEqual(fx.render(), { status: "loading" });
  assert.equal(fx.requests.length, 1);
  assert.deepEqual(fx.requests[0].request, {
    interval: "1d",
    from: date - day,
    to: date,
    precedingTradingPeriods: 1
  });
  fx.requests[0].resolve([nativePeriod(101)]);
  await flush();
  assert.equal(fx.render().priceLevelPeriods["1d"][0].open, 101);
  fx.patch({ candles: [{ timestamp: date + 2 * minute }, { timestamp: date + 3 * minute }] });
  fx.render();
  assert.equal(fx.requests.length, 1);
  fx.destroy();
});

test("Period hook never publishes stale responses across owner, exact UID, timeframe or client", async () => {
  const fx = fixture();
  fx.render();
  fx.patch({ owner: "profile-b" });
  fx.preferences({ instrumentUid: "bank-b", timeframe: "15m" });
  assert.deepEqual(fx.render(), { status: "loading" });
  const [first, second] = fx.requests;
  assert.equal(first.source.signal.aborted, true);
  assert.equal(second.source.uid, "bank-b");
  first.resolve([nativePeriod(100)]);
  await flush();
  assert.deepEqual(fx.render(), { status: "loading" });
  second.resolve([nativePeriod(200)]);
  await flush();
  assert.equal(fx.render().priceLevelPeriods["1d"][0].open, 200);
  fx.replaceSession();
  assert.deepEqual(fx.render(), { status: "loading" });
  assert.equal(second.source.signal.aborted, true);
  assert.equal(fx.requests.length, 3);
  fx.destroy();
});

test("Hiding the period study aborts its read and causes no new market requests", async () => {
  const fx = fixture();
  fx.render();
  fx.preferences({ chartSettings: { drawingTools: { indicatorsHidden: true } } });
  assert.deepEqual(fx.render(), { status: "hidden" });
  fx.requests[0].resolve([nativePeriod(100)]);
  await flush();
  assert.equal(fx.requests[0].source.signal.aborted, true);
  assert.equal(fx.requests.length, 1);
  assert.deepEqual(fx.render(), { status: "hidden" });
  fx.destroy();
});

test("Temporary errors are retried and a successful closed interval remains cached", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fx = fixture();
  fx.render();
  fx.requests[0].reject(new Error("offline"));
  await flush();
  assert.deepEqual(fx.render(), { status: "error" });
  t.mock.timers.tick(14_999);
  assert.equal(fx.requests.length, 1);
  t.mock.timers.tick(1);
  assert.equal(fx.requests.length, 2);
  fx.requests[1].resolve([nativePeriod(100)]);
  await flush();
  assert.equal(fx.render().status, "ready");
  t.mock.timers.tick(180_000);
  assert.equal(fx.requests.length, 2);
  fx.destroy();
});

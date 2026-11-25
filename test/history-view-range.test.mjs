import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const module = { exports: {} },
  code = ts.transpileModule(
    readFileSync(new URL("../src/model/history-view-range.ts", import.meta.url), "utf8"),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }
  ).outputText;
new vm.Script(`(function(module,exports){${code}\n})`).runInNewContext({ Date })(
  module,
  module.exports
);
const {
  planHistoryViewRange,
  historyViewCoverage,
  historyViewNeedsWidth,
  historyFirstDate,
  historyRangeCovered,
  historyViewCachedWindow,
  HISTORY_FALLBACK_FIRST
} = module.exports;
const DAY = 86400000,
  until = Date.parse("2026-11-25T14:00:00Z"),
  options = {
    until,
    rangeDays: 365,
    intervalMs: DAY,
    period: 440,
    first: Date.parse("2000-01-04")
  };
const bar = (timestamp) => ({ timestamp, open: 10, high: 12, low: 9, close: 11, volume: 1 });

test("saved visible left extends default 2023 range to 2022 plus full MTP warmup", () => {
  const left = Date.parse("2022-05-31"),
    view = Object.freeze({
      from: left / 1000,
      to: Date.parse("2025-10-12") / 1000,
      anchor: { timestamp: Date.parse("2024-03-13"), xFraction: 0.5 },
      camera: { barSpace: 1.0550660792951543, rightOffsetBars: -375.9214199001224 }
    });
  assert.equal(planHistoryViewRange(options).from, Date.parse("2023-11-16"));
  const plan = planHistoryViewRange({ ...options, view });
  assert.equal(plan.from, left - 740 * DAY);
  assert.ok(plan.from < Date.parse("2022-05-31"));
  assert.equal(plan.target, left);
  assert.equal(plan.requiredBars, 440);
  assert.equal(plan.visibleTo, Date.parse("2025-10-12"));
  assert.equal(historyViewNeedsWidth(view), false);
});

test("first candle metadata clamps only valid dates, with UTC day normalization", () => {
  const first = historyFirstDate(
    { first1dayCandleDate: "invalid", firstTradeDate: "2021-01-04T07:00:00Z" },
    "1d"
  );
  assert.equal(first, Date.parse("2021-01-04"));
  const plan = planHistoryViewRange({
    ...options,
    first,
    view: { from: Date.parse("2022-05-31") / 1000 }
  });
  assert.equal(plan.from, first);
  assert.equal(historyFirstDate({}, "1d"), null);
  assert.equal(planHistoryViewRange({ ...options, first: null }).earliest, HISTORY_FALLBACK_FIRST);
});

test("cross-symbol shared camera has no stale calendar target; legacy anchor counts actual viewport bars", () => {
  const shared = planHistoryViewRange({
    ...options,
    view: { camera: { barSpace: 8, rightOffsetBars: 8 } },
    width: 800
  });
  assert.equal(shared.mode, "camera");
  assert.equal(shared.target, until);
  assert.equal(shared.from, Date.parse("2023-11-16"));
  const legacy = planHistoryViewRange({
    ...options,
    view: { barSpace: 2, anchor: { timestamp: Date.parse("2024-03-13"), xFraction: 0.5 } },
    width: 800
  });
  assert.equal(legacy.requiredBars, 640);
  assert.equal(legacy.mode, "anchor");
  const sparse = Array.from({ length: 500 }, (_, index) =>
    bar(legacy.target - (500 - index) * DAY)
  );
  assert.equal(historyViewCoverage(legacy, sparse, legacy.from).complete, false);
  assert.equal(historyViewCoverage(legacy, sparse, legacy.from).missingBars, 140);
});

test("explicit left still requires actual warmup bars; reaching known listing date may limit warmup", () => {
  const left = Date.parse("2022-05-31"),
    plan = planHistoryViewRange({ ...options, view: { from: left / 1000 } }),
    sparse = [bar(left - DAY), bar(left), bar(left + DAY)];
  assert.equal(historyViewCoverage(plan, sparse, plan.from).complete, false);
  assert.equal(historyViewCoverage(plan, sparse, plan.from).missingBars, 439);
  const listing = planHistoryViewRange({ ...options, first: left, view: { from: left / 1000 } });
  assert.equal(historyViewCoverage(listing, sparse.slice(1), listing.from).complete, true);
  const unknown = { ...listing, knownFirst: false };
  assert.equal(historyViewCoverage(unknown, sparse.slice(1), unknown.from).complete, false);
});

test("offline coverage must include every needed warmup/visible interval, not just endpoints", () => {
  const left = Date.parse("2022-05-31"),
    plan = planHistoryViewRange({
      ...options,
      period: 2,
      view: { from: left / 1000, to: (left + DAY) / 1000 }
    }),
    candles = [-4, -2, -1, 0, 1, 2].map((days) => bar(left + days * DAY)),
    cached = historyViewCachedWindow(plan, candles);
  assert.equal(cached.from, left - 2 * DAY);
  assert.equal(cached.to, left + DAY);
  assert.equal(
    historyRangeCovered(
      [
        { from: cached.from, to: left - DAY },
        { from: left, to: cached.to }
      ],
      cached.from,
      cached.to
    ),
    false
  );
  assert.equal(
    historyRangeCovered(
      [
        { from: cached.from, to: left },
        { from: left, to: cached.to }
      ],
      cached.from,
      cached.to
    ),
    true
  );
  assert.equal(
    historyRangeCovered(
      [
        { from: cached.from, to: left - 1 },
        { from: left, to: cached.to }
      ],
      cached.from,
      cached.to
    ),
    true
  );
});

test("offline proof keeps the saved right edge even when cached candles end earlier", () => {
  const left = Date.parse("2022-05-31"),
    right = Date.parse("2025-10-12"),
    plan = planHistoryViewRange({
      ...options,
      period: 0,
      view: { from: left / 1000, to: right / 1000 }
    }),
    candles = [bar(left), bar(left + 86400000)],
    needed = historyViewCachedWindow(plan, candles);
  assert.equal(needed.to, right);
  assert.equal(
    historyRangeCovered([{ from: left, to: left + 86400000 }], needed.from, needed.to),
    false
  );
  assert.equal(historyRangeCovered([{ from: left, to: right }], needed.from, needed.to), true);
  const legacy = planHistoryViewRange({
    ...options,
    period: 0,
    width: 800,
    view: { barSpace: 8, anchor: { timestamp: left, xFraction: 0.5 } }
  });
  assert.equal(historyViewCachedWindow(legacy, candles).to, until);
});

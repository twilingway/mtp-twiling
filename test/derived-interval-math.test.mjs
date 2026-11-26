import test from "node:test";
import assert from "node:assert/strict";
import { loadDerivedSource } from "./helpers/derived-interval-source.mjs";

const {
  aggregateDerivedMinutes: aggregate,
  DerivedMinuteError,
  DERIVED_MINUTE_LIMITS
} = loadDerivedSource();
const minute = 60_000;
const at = (value) => Date.parse(value);
const start = at("2024-02-29T09:30:00Z");
const span = (a, b) => ({ start: a, end: b });
const session = (a, b, windows = [span(a, b)], anchor = a) => ({
  ...span(a, b),
  anchor,
  openWindows: windows
});
const quote = (
  timestamp,
  [open, high, low, close, volume] = [10, 12, 8, 11, 1],
  finality = "final"
) => ({
  timestamp,
  open,
  high,
  low,
  close,
  volume,
  finality
});
const sequence = (a, count, tuple) =>
  Array.from({ length: count }, (_, i) => quote(a + i * minute, tuple));
const request = (bars, targetMinutes = 4, extra = {}) => ({
  baseInterval: "1m",
  targetMinutes,
  bars,
  sessions: [session(start, start + 180 * minute)],
  coverage: [{ ...span(start, start + 180 * minute), evidence: "exhaustive" }],
  asOf: start + 180 * minute,
  ...extra
});
const prices = ({ timestamp, endTimestamp, open, high, low, close, volume }) => ({
  timestamp,
  endTimestamp,
  open,
  high,
  low,
  close,
  volume
});
function rejects(input, code) {
  assert.throws(
    () => aggregate(input),
    (error) => error instanceof DerivedMinuteError && error.code === code
  );
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

test("independent 4-minute ledger preserves first O, extrema, last C and volume", () => {
  const ledger = [
    [10, 13, 9, 12, 2],
    [12, 14, 11, 13, 3],
    [13, 15, 7, 8, 5],
    [8, 11, 6, 10, 7]
  ];
  const [bar] = aggregate(request(ledger.map((tuple, i) => quote(start + i * minute, tuple))));
  assert.deepEqual(prices(bar), {
    timestamp: start,
    endTimestamp: start + 4 * minute,
    open: 10,
    high: 15,
    low: 6,
    close: 10,
    volume: 17
  });
  assert.deepEqual(bar.quality, {
    status: "complete",
    expectedMinutes: 4,
    sourceMinutes: 4,
    missingSourceMinutes: 0,
    exhaustiveMinutes: 4,
    partialCoverageMinutes: 0,
    unknownCoverageMinutes: 0,
    finalSourceMinutes: 4,
    formingSourceMinutes: 0,
    unknownFinalityMinutes: 0
  });
});

test("independent 7-minute ledger and explicit session-start anchor", () => {
  const ledger = [
    [10, 12, 9, 11, 1],
    [11, 14, 10, 13, 2],
    [13, 15, 12, 14, 3],
    [14, 18, 13, 17, 4],
    [17, 17, 5, 6, 5],
    [6, 12, 6, 11, 6],
    [11, 16, 10, 16, 7]
  ];
  const [bar] = aggregate(
    request(
      ledger.map((tuple, i) => quote(start + i * minute, tuple)),
      7
    )
  );
  assert.deepEqual(prices(bar), {
    timestamp: start,
    endTimestamp: start + 7 * minute,
    open: 10,
    high: 18,
    low: 5,
    close: 16,
    volume: 28
  });
  assert.equal(bar.quality.status, "complete");
});

test("45-minute ledger and caller-selected short last session bucket", () => {
  const bars = sequence(start, 70, [10, 12, 8, 11, 2]);
  bars[0] = quote(start, [20, 21, 18, 19, 3]);
  bars[20] = quote(start + 20 * minute, [10, 50, -3, 11, 5]);
  bars[44] = quote(start + 44 * minute, [10, 35, 8, 30, 7]);
  bars[45] = quote(start + 45 * minute, [40, 43, 38, 41, 4]);
  bars[69] = quote(start + 69 * minute, [10, 60, 8, 55, 6]);
  const result = aggregate(request(bars, 45, { sessions: [session(start, start + 70 * minute)] }));
  assert.deepEqual(result.map(prices), [
    {
      timestamp: start,
      endTimestamp: start + 45 * minute,
      open: 20,
      high: 50,
      low: -3,
      close: 30,
      volume: 99
    },
    {
      timestamp: start + 45 * minute,
      endTimestamp: start + 70 * minute,
      open: 40,
      high: 60,
      low: 8,
      close: 55,
      volume: 56
    }
  ]);
  assert.deepEqual(
    result.map((bar) => [bar.quality.expectedMinutes, bar.quality.status]),
    [
      [45, "complete"],
      [25, "complete"]
    ]
  );
});

test("independent 180-minute ledger checks interior extrema and summed source units", () => {
  const bars = sequence(start, 180);
  bars[0] = quote(start, [20, 22, 18, 21, 3]);
  bars[80] = quote(start + 80 * minute, [10, 12, -5, 11, 4]);
  bars[100] = quote(start + 100 * minute, [10, 90, 8, 11, 5]);
  bars[179] = quote(start + 179 * minute, [10, 40, 8, 33, 8]);
  const [bar] = aggregate(request(bars, 180));
  assert.deepEqual(prices(bar), {
    timestamp: start,
    endTimestamp: start + 180 * minute,
    open: 20,
    high: 90,
    low: -5,
    close: 33,
    volume: 196
  });
  assert.equal(bar.quality.status, "complete");
});

test("6/8/9-minute targets use supplied anchor and never include next-boundary minute", () => {
  for (const target of [6, 8, 9]) {
    const result = aggregate(request(sequence(start, target + 1), target));
    assert.deepEqual(
      result.map((bar) => [bar.timestamp, bar.volume]),
      [
        [start, target],
        [start + target * minute, 1]
      ]
    );
    assert.equal(result[0].quality.status, "complete");
  }
});

test("chosen UTC day policy clips 7m tail and resets exactly at next supplied day", () => {
  const day = at("2024-12-31T00:00:00Z");
  const nextDay = at("2025-01-01T00:00:00Z");
  const bars = [1434, 1435, 1439, 1440].map((i) => quote(day + i * minute));
  const result = aggregate(
    request(bars, 7, {
      sessions: [session(day, nextDay), session(nextDay, nextDay + 1440 * minute)],
      coverage: [],
      asOf: nextDay + minute
    })
  );
  assert.deepEqual(
    result.map((bar) => [bar.timestamp, bar.endTimestamp, bar.volume]),
    [
      [day + 1428 * minute, day + 1435 * minute, 1],
      [day + 1435 * minute, nextDay, 2],
      [nextDay, nextDay + 7 * minute, 1]
    ]
  );
  assert.equal(result[1].quality.expectedMinutes, 5);
});

test("break excludes closed minutes without resetting grid; short leading bucket is explicit", () => {
  const windows = [
    span(start, start + 30 * minute),
    span(start + 40 * minute, start + 70 * minute)
  ];
  const bars = [...sequence(start, 30), ...sequence(start + 40 * minute, 30)];
  const result = aggregate(
    request(bars, 45, { sessions: [session(start, start + 70 * minute, windows)] })
  );
  assert.deepEqual(
    result.map((bar) => [
      bar.timestamp,
      bar.volume,
      bar.quality.expectedMinutes,
      bar.quality.status
    ]),
    [
      [start, 35, 35, "complete"],
      [start + 45 * minute, 25, 25, "complete"]
    ]
  );
  const [leading] = aggregate(
    request(sequence(start, 3), 7, {
      sessions: [session(start, start + 3 * minute, undefined, start - 4 * minute)]
    })
  );
  assert.equal(leading.timestamp, start);
  assert.equal(leading.endTimestamp, start + 3 * minute);
  assert.equal(leading.quality.status, "complete");
});

test("coverage counts only open-window intersections; adjacent evidence is not double-counted", () => {
  const windows = [span(start, start + 2 * minute), span(start + 3 * minute, start + 4 * minute)];
  const [bar] = aggregate(
    request([quote(start), quote(start + minute), quote(start + 3 * minute)], 4, {
      sessions: [session(start, start + 4 * minute, windows)],
      coverage: [
        { ...span(start - minute, start + minute), evidence: "exhaustive" },
        { ...span(start + minute, start + 3 * minute), evidence: "partial" },
        { ...span(start + 3 * minute, start + 4 * minute), evidence: "unknown" }
      ]
    })
  );
  assert.equal(bar.quality.expectedMinutes, 3);
  assert.equal(bar.quality.exhaustiveMinutes, 1);
  assert.equal(bar.quality.partialCoverageMinutes, 1);
  assert.equal(bar.quality.unknownCoverageMinutes, 1);
  assert.equal(bar.quality.status, "incomplete");
});

test("forming snapshot is open, never final by elapsed time; future snapshots are rejected", () => {
  const bars = sequence(start, 3);
  bars.push(quote(start + 3 * minute, undefined, "forming"));
  const current = request(bars, 4, { asOf: start + 3.5 * minute });
  const [bar] = aggregate(current);
  assert.equal(bar.close, 11);
  assert.equal(bar.quality.status, "open");
  assert.equal(bar.quality.formingSourceMinutes, 1);
  assert.equal(aggregate({ ...current, asOf: start + 4 * minute })[0].quality.status, "incomplete");
  rejects({ ...current, bars: sequence(start, 4) }, "future-source");
  rejects(
    { ...current, bars: [...bars, quote(start + 4 * minute, undefined, "forming")] },
    "future-source"
  );
});

test("missing minute remains incomplete even with exhaustive coverage and actual zero-volume bar", () => {
  const bars = [quote(start, [10, 10, 10, 10, 0]), quote(start + 3 * minute)];
  const [bar] = aggregate(request(bars));
  assert.equal(bar.volume, 1);
  assert.equal(bar.quality.sourceMinutes, 2);
  assert.equal(bar.quality.missingSourceMinutes, 2);
  assert.equal(bar.quality.exhaustiveMinutes, 4);
  assert.equal(bar.quality.status, "incomplete");
  const zero = aggregate(request(sequence(start, 4, [0, 0, 0, 0, 0])))[0];
  assert.equal(zero.volume, 0);
  assert.equal(zero.quality.status, "complete");
});

test("missing coverage and unknown source finality cannot become complete", () => {
  const bars = sequence(start, 4);
  const [uncovered] = aggregate(request(bars, 4, { coverage: [] }));
  assert.equal(uncovered.quality.status, "unknown");
  assert.equal(uncovered.quality.unknownCoverageMinutes, 4);
  bars[2] = { ...bars[2], finality: "unknown" };
  const [unknown] = aggregate(request(bars));
  assert.equal(unknown.quality.status, "unknown");
  assert.equal(unknown.quality.unknownFinalityMinutes, 1);
});

test("open metadata retains future missing minutes and unknown current-minute finality", () => {
  const bars = [quote(start), quote(start + minute, undefined, "unknown")];
  const [bar] = aggregate(request(bars, 4, { asOf: start + 1.5 * minute, coverage: [] }));
  assert.equal(bar.quality.status, "open");
  assert.equal(bar.quality.expectedMinutes, 4);
  assert.equal(bar.quality.missingSourceMinutes, 2);
  assert.equal(bar.quality.unknownCoverageMinutes, 4);
  assert.equal(bar.quality.unknownFinalityMinutes, 1);
  assert.equal(bar.quality.finalSourceMinutes, 1);
});

test("empty buckets and empty sessions never invent OHLCV, including distant history", () => {
  assert.deepEqual(aggregate(request([])), []);
  const distant = at("2124-02-29T09:30:00Z");
  const result = aggregate(
    request([quote(start), quote(distant)], 4, {
      sessions: [session(start, start + 60 * minute), session(distant, distant + 60 * minute)],
      coverage: [],
      asOf: distant + 60 * minute
    })
  );
  assert.equal(result.length, 2);
  assert.equal(result[1].timestamp, distant);
  assert.deepEqual(aggregate(request([], 4, { sessions: [] })), []);
});

test("tail append, old correction, immutable inputs and causal closed prefixes", () => {
  const input = freeze(request(sequence(start, 8)));
  const before = structuredClone(input);
  const original = aggregate(input);
  assert.deepEqual(input, before);
  assert.ok(
    Object.isFrozen(original) &&
      Object.isFrozen(original[0]) &&
      Object.isFrozen(original[0].quality)
  );
  const earlier = aggregate({ ...input, bars: input.bars.slice(0, 4), asOf: start + 4 * minute });
  assert.deepEqual(earlier, original.slice(0, 1));
  const appended = aggregate({ ...input, bars: [...input.bars, quote(start + 8 * minute)] });
  assert.deepEqual(appended.slice(0, 2), original);
  const corrected = [...input.bars];
  corrected[1] = quote(start + minute, [20, 100, -20, 30, 9]);
  const revised = aggregate({ ...input, bars: corrected });
  assert.equal(revised[0].volume, 12);
  assert.equal(revised[0].high, 100);
  assert.equal(revised[0].low, -20);
  assert.deepEqual(revised[1], original[1]);
  assert.deepEqual(aggregate(input), original);
  rejects({ ...input, asOf: start + 4 * minute }, "future-source");
});

test("duplicate, conflicting and out-of-order snapshots are rejected without implicit normalization", () => {
  const first = quote(start);
  for (const bars of [
    [first, first],
    [first, { ...first, volume: 2 }],
    [quote(start + minute), first]
  ])
    rejects(request(bars), "invalid-order");
});

test("invalid OHLCV and non-explicit finality are rejected", () => {
  for (const patch of [
    { open: NaN },
    { high: Infinity },
    { low: -Infinity },
    { close: NaN },
    { volume: -1 },
    { volume: Infinity },
    { high: 9 },
    { low: 11 },
    { close: 13 },
    { finality: undefined },
    { finality: "closed" }
  ])
    rejects(request([{ ...quote(start), ...patch }]), "invalid-source");
  rejects(
    request([
      quote(start, [1, 1, 1, 1, Number.MAX_VALUE]),
      quote(start + minute, [1, 1, 1, 1, Number.MAX_VALUE])
    ]),
    "arithmetic-overflow"
  );
});

test("source/target/session support and open-window containment fail explicitly", () => {
  rejects({ ...request([]), baseInterval: "5m" }, "unsupported-source");
  for (const targetMinutes of [1, 5, 60, "3h", "3M", NaN])
    rejects({ ...request([]), targetMinutes }, "unsupported-target");
  for (const sessions of [undefined, null, { kind: "unknown" }])
    rejects({ ...request([]), sessions }, "unsupported-session");
  rejects(request([quote(start)], 4, { sessions: [] }), "unsupported-session");
  rejects(request([quote(start - minute)]), "unsupported-session");
  rejects(request([quote(start + 180 * minute, undefined, "forming")]), "unsupported-session");
  rejects(
    request([quote(start + minute)], 4, {
      sessions: [
        session(start, start + 4 * minute, [
          span(start, start + minute),
          span(start + 2 * minute, start + 4 * minute)
        ])
      ]
    }),
    "outside-open-window"
  );
});

test("timestamps, anchors, windows and evidence must be explicit aligned valid ranges", () => {
  for (const asOf of [undefined, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER])
    rejects({ ...request([]), asOf }, "invalid-time");
  rejects(request([quote(start + 1)]), "invalid-time");
  rejects(
    request([], 4, { sessions: [{ ...session(start, start + minute), anchor: start + 1 }] }),
    "invalid-time"
  );
  rejects(
    request([], 4, { sessions: [session(start, start + minute, undefined, start + minute)] }),
    "invalid-time"
  );
  for (const bad of [
    span(start, start),
    span(start + minute, start),
    span(start + 1, start + minute)
  ])
    rejects(request([], 4, { coverage: [{ ...bad, evidence: "exhaustive" }] }), "invalid-time");
  rejects(
    request([], 4, {
      sessions: [session(start, start + minute, [span(start - minute, start + minute)])]
    }),
    "invalid-time"
  );
  rejects(
    request([], 4, { coverage: [{ ...span(start, start + minute), evidence: undefined }] }),
    "invalid-input"
  );
  rejects(request([], 4, { coverage: undefined }), "invalid-input");
});

test("overlapping/unsorted sessions, open windows and coverage cannot double count", () => {
  const a = span(start, start + 2 * minute),
    b = span(start + minute, start + 3 * minute);
  for (const ranges of [
    [a, b],
    [b, a]
  ]) {
    rejects(
      request([], 4, { sessions: ranges.map(({ start, end }) => session(start, end)) }),
      "invalid-order"
    );
    rejects(
      request([], 4, { sessions: [session(start, start + 4 * minute, ranges)] }),
      "invalid-order"
    );
    rejects(
      request([], 4, { coverage: ranges.map((range) => ({ ...range, evidence: "exhaustive" })) }),
      "invalid-order"
    );
  }
});

test("negative Unix minutes work, unsafe arithmetic and local resource limits fail closed", () => {
  const ancient = -4 * minute;
  const [bar] = aggregate(
    request(sequence(ancient, 4), 4, {
      sessions: [session(ancient, 0)],
      coverage: [{ ...span(ancient, 0), evidence: "exhaustive" }],
      asOf: 0
    })
  );
  assert.equal(bar.timestamp, ancient);
  assert.equal(bar.quality.status, "complete");
  rejects(
    request([], 4, {
      sessions: [
        session(8_000_000_000_040_000, 8_000_000_000_100_000, undefined, -8_000_000_000_040_000)
      ]
    }),
    "arithmetic-overflow"
  );
  rejects(
    request([], 4, {
      sessions: [session(start, start + DERIVED_MINUTE_LIMITS.sessionMilliseconds + minute)]
    }),
    "resource-limit"
  );
  for (const [field, limit] of [
    ["bars", "sourceBars"],
    ["sessions", "sessions"],
    ["coverage", "coverageSpans"]
  ])
    rejects(
      { ...request([]), [field]: new Array(DERIVED_MINUTE_LIMITS[limit] + 1) },
      "resource-limit"
    );
});

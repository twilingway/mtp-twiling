import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/model/technical-indicators/", import.meta.url));
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  new vm.Script(`(function(require,module,exports){${output}\n})`, {
    filename: file
  }).runInThisContext()(
    (specifier) => load(path.resolve(path.dirname(file), specifier).replace(/\.js$/, ".ts")),
    module,
    module.exports
  );
  return module.exports;
}
const { klingerOscillator, netVolume, cumulativeVolumeIndex } = load(
  path.join(root, "ta-batch-volume-flow.ts")
);
const { volumeDelta, upDownVolume, cumulativeVolumeDelta } = load(
  path.join(root, "ta-batch-volume-flow-delta.ts")
);
const { volume24Hours, relativeVolumeAtTime } = load(
  path.join(root, "ta-batch-volume-flow-time.ts")
);

const priceBar = ([high, low, close, volume], timestamp) => ({
  timestamp,
  open: close,
  high,
  low,
  close,
  volume
});
const lowerBar = (timestamp, open, close, volume) => ({ timestamp, open, close, volume });
const period = (timestamp, intrabars, anchorTimestamp = timestamp) => ({
  timestamp,
  endTime: timestamp + 10,
  anchorTimestamp,
  intrabars
});

function series(actual, expected) {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, index) => {
    if (value === null) assert.equal(actual[index], null);
    else {
      assert.ok(
        Number.isFinite(actual[index]) && Math.abs(actual[index] - value) < 1e-9,
        `${actual[index]} != ${value} at index ${index}`
      );
    }
  });
}

test("Klinger uses the author's range factor, unchanged HLC trend and reversal range", () => {
  // HLC sum [30,33,33,32,27], range [2,6,4,2,2], cumulative range [na,8,12,6,8].
  // Volume force [na,500,200,-300,-700], with EMA3 seeded by 500.
  const bars = [
    [11, 9, 10, 7],
    [14, 8, 11, 10],
    [13, 9, 11, 6],
    [12, 10, 10, 9],
    [10, 8, 9, 14]
  ].map(priceBar);
  const out = klingerOscillator(bars, { fastLength: 1, slowLength: 3, signalLength: 3 });
  series(out.oscillator, [null, 0, -150, -325, -362.5]);
  series(out.signal, [null, 0, -75, -200, -281.25]);
  assert.deepEqual(
    klingerOscillator(bars),
    klingerOscillator(bars, {
      fastLength: 34,
      slowLength: 55,
      signalLength: 13
    })
  );
  assert.deepEqual(
    klingerOscillator(bars.map((bar) => ({ ...bar, volume: null }))).oscillator,
    bars.map(() => null)
  );
  assert.deepEqual(
    klingerOscillator(
      [
        [10, 10, 10, 4],
        [11, 11, 11, 5]
      ].map(priceBar)
    ).oscillator,
    [null, null]
  );
});

test("Net Volume uses tick aggregates and CVI preserves its market breadth baseline", () => {
  series(
    netVolume([
      { uptickVolume: 12, downtickVolume: 8 },
      { uptickVolume: 0, downtickVolume: 0 },
      { uptickVolume: null, downtickVolume: 8 },
      { uptickVolume: 5, downtickVolume: 7 }
    ]),
    [4, 0, null, -2]
  );
  const breadth = [
    { advancingVolume: 12, decliningVolume: 8 },
    { advancingVolume: 5, decliningVolume: 7 },
    { advancingVolume: 1, decliningVolume: null },
    { advancingVolume: 9, decliningVolume: 3 }
  ];
  series(cumulativeVolumeIndex(breadth), [4, 2, null, null]);
  series(cumulativeVolumeIndex(breadth, -10), [-6, -8, null, null]);
  assert.throws(() => netVolume([{ uptickVolume: 0, downtickVolume: -1 }]), RangeError);
});

test("Volume Delta uses extrema of the intrabar path and the previous doji direction", () => {
  const bars = [
    period(0, [lowerBar(0, 10, 11, 7), lowerBar(1, 11, 10, 11), lowerBar(2, 10, 11, 2)]),
    period(10, [lowerBar(10, 10, 10, 4), lowerBar(11, 10, 10, 6)]),
    period(20, [lowerBar(20, 10, 10, 1)])
  ];
  assert.deepEqual(volumeDelta(bars), [
    { open: 0, high: 7, low: -4, close: -2 },
    { open: 0, high: 0, low: -10, close: -10 },
    { open: 0, high: 0, low: -1, close: -1 }
  ]);
  assert.deepEqual(upDownVolume(bars), [
    { up: 9, down: -11, delta: -2 },
    { up: 6, down: -4, delta: 2 },
    { up: 1, down: 0, delta: 1 }
  ]);
  assert.deepEqual(volumeDelta(bars.slice(2)), [null]);
  assert.deepEqual(volumeDelta(bars.slice(2), { close: 10, direction: -1 }), [
    { open: 0, high: 0, low: -1, close: -1 }
  ]);
  assert.throws(() => volumeDelta([period(0, [lowerBar(10, 1, 2, 5)])]), RangeError);
});

test("CVD shifts intrabar extrema by the opening balance and resets only at a known anchor", () => {
  const bars = [
    period(0, [lowerBar(0, 10, 11, 7)]),
    period(10, [lowerBar(10, 11, 10, 11), lowerBar(11, 10, 11, 2)], 0),
    period(20, null, 0),
    period(30, [lowerBar(30, 10, 11, 3)], 0),
    period(40, []),
    period(50, [lowerBar(50, 10, 9, 2)], 40)
  ];
  const result = [
    { open: 0, high: 7, low: 0, close: 7 },
    { open: 7, high: 7, low: -4, close: -2 },
    null,
    null,
    { open: 0, high: 0, low: 0, close: 0 },
    { open: 0, high: 0, low: -2, close: -2 }
  ];
  assert.deepEqual(cumulativeVolumeDelta(bars), result);
  assert.deepEqual(cumulativeVolumeDelta(bars.slice(1)), [null, ...result.slice(2)]);
  assert.deepEqual(volumeDelta([period(0, [lowerBar(0, 1, 2, null)])]), [null]);
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

test("24-hour volume excludes its left boundary and retains quote units unless converted", () => {
  const bars = [
    { timestamp: 0, volume: 2, price: 10, currencyRate: 1 },
    { timestamp: HOUR, volume: 3, price: 10, currencyRate: 2 },
    { timestamp: DAY, volume: 4, price: 10, currencyRate: 3 },
    { timestamp: DAY + HOUR, volume: 5, price: 10, currencyRate: 4 },
    { timestamp: 3 * DAY, volume: 0, price: null, currencyRate: null }
  ];
  const options = { volumeUnit: "base", coverageStart: 0 };
  series(volume24Hours(bars, options), [null, null, 70, 90, 0]);
  series(volume24Hours(bars, { ...options, volumeUnit: "quote" }), [null, null, 7, 9, 0]);
  series(volume24Hours(bars, { ...options, convertCurrency: true }), [null, null, 180, 320, 0]);
});

test("24-hour volume recovers when unknown and very large turnover leaves the window", () => {
  const options = { volumeUnit: "quote", coverageStart: 0 };
  const timed = (timestamp, volume) => ({ timestamp, volume });
  series(volume24Hours([timed(HOUR, null), timed(DAY, 9), timed(DAY + HOUR, 1)], options), [
    null,
    null,
    10
  ]);
  series(volume24Hours([timed(0, 1e20), timed(HOUR, 9), timed(DAY, 1)], options), [null, null, 10]);
  series(
    volume24Hours(
      [
        timed(0, Number.MAX_VALUE),
        timed(HOUR, Number.MAX_VALUE),
        timed(DAY, 1),
        timed(DAY + HOUR, 9)
      ],
      options
    ).slice(-1),
    [10]
  );
});

const session = (anchorTimestamp, volumes, hasAnchorCoverage = true) => ({
  anchorTimestamp,
  hasAnchorCoverage,
  bars: volumes.map(([offset, volume]) => ({ timestamp: anchorTimestamp + offset, volume }))
});

test("relative volume finds exact or earlier offsets within the same historical period", () => {
  const periods = [
    session(0, [
      [0, 10],
      [2, 20],
      [9, 99]
    ]),
    session(20, [
      [0, 30],
      [5, 40]
    ]),
    session(40, [
      [0, 40],
      [5, 60]
    ])
  ];
  series(relativeVolumeAtTime(periods, { length: 2, mode: "regular" }), [
    null,
    null,
    null,
    null,
    null,
    2,
    2
  ]);
  series(relativeVolumeAtTime(periods, { length: 2 }), [null, null, null, null, null, 2, 2]);
  series(
    relativeVolumeAtTime(
      [
        session(0, [
          [0, 3],
          [8, 1]
        ]),
        session(20, [[2, 2]])
      ],
      {
        length: 1
      }
    ),
    [null, null, 2 / 3]
  );
});

test("relative volume suppresses unconfirmed history, zero baselines and unknown cumulative inputs", () => {
  const periods = [
    session(0, [[0, 2]], false),
    session(20, [
      [0, 0],
      [3, null],
      [4, 8]
    ]),
    session(40, [
      [0, 1],
      [4, 12]
    ]),
    session(60, [
      [0, 1],
      [4, 12]
    ])
  ];
  series(relativeVolumeAtTime(periods, { length: 1 }), [null, null, null, null, null, null, 1, 1]);
  series(relativeVolumeAtTime(periods, { length: 1, mode: "regular" }), [
    null,
    null,
    null,
    null,
    null,
    1.5,
    1,
    1
  ]);
  assert.throws(
    () =>
      relativeVolumeAtTime([
        session(0, [
          [0, 2],
          [0, 3]
        ])
      ]),
    RangeError
  );
});

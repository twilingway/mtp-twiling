import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const loaderUrl = process.env.RELATIVE_INVARIANCE_LOADER_PATH
  ? pathToFileURL(process.env.RELATIVE_INVARIANCE_LOADER_PATH)
  : new URL("./helpers/relative-oscillator-source.mjs", import.meta.url);
const { loadRelativeSource } = await import(loaderUrl.href);
const { stochasticRsi } = loadRelativeSource();
const fixtures = new URL("./fixtures/relative-invariance/", import.meta.url);
const read = (file) => JSON.parse(readFileSync(new URL(file, fixtures), "utf8"));
const originalProbe = readFileSync(new URL("original-review-probes.mjs.txt", fixtures), "utf8");
// Execute the frozen reviewer's exact rational definitions, without its API imports or I/O.
const definitions = originalProbe.slice(
  originalProbe.indexOf("const gcd="),
  originalProbe.indexOf("function vigor(")
);
const { stoch: rationalStoch } = await import(
  `data:text/javascript;base64,${Buffer.from(definitions + "\nexport {stoch};").toString("base64")}`
);
const rows = (values) =>
  values.map((close, i) => ({
    timestamp: i * 1973 - 500,
    close,
    open: close,
    high: close === null ? null : close + 1,
    low: close === null ? null : close - 1,
    volume: 1
  }));
function equal(actual, expected) {
  assert.deepEqual(Object.keys(actual), ["k", "d"]);
  for (const key of ["k", "d"]) {
    assert.equal(actual[key].length, expected[key].length);
    expected[key].forEach((value, i) => {
      if (value === null) assert.equal(actual[key][i], null, `${key}/${i}`);
      else
        assert.ok(
          Number.isFinite(actual[key][i]) &&
            Math.abs(actual[key][i] - value) <= 3e-11 * Math.max(1, Math.abs(value)),
          `${key}/${i}: ${actual[key][i]} != ${value}`
        );
    });
  }
}

test("frozen full vectors/probes retain exact hashes and original failures are not rewritten", () => {
  const manifest = read("manifest.json");
  for (const witness of [...manifest.copies, ...manifest.replayed])
    assert.equal(
      createHash("sha256")
        .update(readFileSync(new URL(witness.file, fixtures)))
        .digest("hex"),
      witness.sha256,
      witness.file
    );
  assert.equal(read("original-trial47.json").actual.k[29], 0);
  assert.equal(read("replayed-frozen-trial113.json").actual.k[12], 66.66666666666666);
  assert.equal(read("original-review-evidence.json").failures.length, 2);
});
test("six-bar rational manual ledger: zero then missing change leaves every K/D undefined", () => {
  const p = { rsiLength: 3, stochasticLength: 2, smoothK: 1, smoothD: 1 };
  for (const values of [[0, -4, -4, -3, -3, null], read("original-six-bar-vector.json").values]) {
    const input = rows(values),
      expected = { k: Array(6).fill(null), d: Array(6).fill(null) };
    assert.deepEqual(rationalStoch(input, p), expected);
    assert.deepEqual(stochasticRsi(input, p), expected);
  }
});
test("full original trial47 and minimized vector match exact rational expectation", () => {
  const vector = read("original-trial47.json");
  equal(stochasticRsi(vector.bars, vector.options), vector.expected);
  equal(rationalStoch(vector.bars, vector.options), vector.expected);
  assert.equal(vector.expected.k[29], 22.462116593784884);
  const minimal = read("original-minimal-vector.json");
  const input = rows(minimal.values);
  equal(stochasticRsi(input, minimal.options), rationalStoch(input, minimal.options));
});
test("full frozen replay trial113 matches rational expectation including inactive startup", () => {
  const vector = read("replayed-frozen-trial113.json");
  equal(stochasticRsi(vector.bars, vector.options), vector.expected);
  equal(rationalStoch(vector.bars, vector.options), vector.expected);
  assert.equal(vector.expected.k[12], null);
});
test("zero/NA carry after seeds, recovery and length1 zero reset follow analytic policy", () => {
  const values = [
    [0, -4, -4, -3, -3, null, null, -3, -3, -3, -2, -2, null, -2, -1],
    [0, 1, 0, null, 0, 0, 1, 1, null, 0, -1],
    [0, 0, 0, null, 0, 0, -4, -4, null, -3, -3, null],
    [null, 0, null, 1, null, 1, 1, -1, -1, null, null]
  ];
  for (const sequence of values)
    for (const rsiLength of [1, 2, 3, 6]) {
      const p = { rsiLength, stochasticLength: 2, smoothK: 1, smoothD: 1 };
      equal(stochasticRsi(rows(sequence), p), rationalStoch(rows(sequence), p));
    }
  const recovered = stochasticRsi(rows(values[0]), {
    rsiLength: 3,
    stochasticLength: 2,
    smoothK: 1,
    smoothD: 1
  });
  assert.equal(recovered.k[10], 100, "a legitimate nonzero change must still update the ratio");
  const flat = stochasticRsi(rows(Array(30).fill(3)), { rsiLength: 1, smoothK: 1, smoothD: 1 });
  assert.ok([...flat.k, ...flat.d].every((v) => v === null));
});
test("zero/missing invariance survives MAX and subnormal scales without denominator epsilon", () => {
  const source = [0, -4, -4, -3, -3, null, null, -3, -3];
  for (const scale of [2 ** -900, 2 ** 900, Number.MIN_VALUE, Number.MAX_VALUE / 4]) {
    const values = source.map((v) => (v === null ? null : v * scale));
    const input = values.map((close, timestamp) => ({
      timestamp,
      close,
      open: null,
      high: null,
      low: null,
      volume: null
    }));
    assert.deepEqual(
      stochasticRsi(input, { rsiLength: 3, stochasticLength: 2, smoothK: 1, smoothD: 1 }),
      { k: Array(values.length).fill(null), d: Array(values.length).fill(null) }
    );
  }
});
test("every source choice keeps canonical carry, frozen input, prefix and correction causality", () => {
  for (const source of ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4", "volume"]) {
    const values = [0, -4, -4, -3, -3, null, null, -3, -2, -2, null];
    const input = values.map((v, timestamp) => {
      const value = v === null ? null : v + 10;
      return Object.freeze({
        timestamp,
        open: value,
        high: value,
        low: value,
        close: value,
        volume: value
      });
    });
    Object.freeze(input);
    const snapshot = JSON.stringify(input),
      p = { source, rsiLength: 3, stochasticLength: 2, smoothK: 1, smoothD: 1 };
    const result = stochasticRsi(input, p);
    equal(result, rationalStoch(input, p));
    for (let cut = 0; cut <= input.length; cut++) {
      const prefix = stochasticRsi(input.slice(0, cut), p);
      assert.deepEqual(prefix.k, result.k.slice(0, cut));
      assert.deepEqual(prefix.d, result.d.slice(0, cut));
    }
    const corrected = [
      ...input.slice(0, -1),
      { ...input.at(-1), open: 11, high: 11, low: 11, close: 11, volume: 11 }
    ];
    equal(stochasticRsi(corrected, p), rationalStoch(corrected, p));
    assert.equal(JSON.stringify(input), snapshot);
  }
});
test("independent rational zero/gap stress spans asymmetric smoothing and long carry runs", () => {
  let seed = 60121;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let round = 0; round < 60; round++) {
    let close = 0;
    const values = Array.from({ length: 49 }, () => {
      const r = random();
      if (r < 0.23) return null;
      if (r > 0.55) close += Math.floor(random() * 9) - 4;
      return close;
    });
    const input = rows(values),
      p = {
        rsiLength: 1 + (round % 6),
        stochasticLength: 1 + (round % 7),
        smoothK: 1 + (round % 3),
        smoothD: 1 + (round % 4)
      };
    equal(stochasticRsi(input, p), rationalStoch(input, p));
  }
});

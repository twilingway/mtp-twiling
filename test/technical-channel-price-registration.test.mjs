import test from "node:test";
import {
  EXPECTED_COMPUTED_COUNT,
  EXPECTED_TECHNICAL_COUNT
} from "./technical-registry-expectation.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const load = createSourceLoader(),
  core = load("model/technical-indicators/index.js");
const math = load("model/technical-indicators/channel-average/index.js");
const selectedPrices = load("model/technical-indicators/channel-average/inputs.js").prices;
const ids = ["alma", "lsma", "chandelier-exit"];
const defaults = {
  alma: { length: 9, offset: 0.85, sigma: 6 },
  lsma: { length: 25, offset: 0, source: "close" },
  "chandelier-exit": { length: 22, atrLength: 22, multiplier: 3 }
};
const bars = (n) =>
  Array.from({ length: n }, (_, i) => ({
    timestamp: 1700000000000 + i * 60000,
    open: 100 + (i % 7),
    close: 100 + (i % 7),
    high: 102 + (i % 7),
    low: 98 + (i % 7),
    volume: 1 + (i % 5)
  }));
const make = (id, params = {}) => core.createTechnicalIndicatorInstance(id, id, { params });
const calc = (id, b, params = {}) => core.calculateTechnicalIndicator(make(id, params), b);

test("only three definitions append after old47 with exact defaults/native price/primary colors and no KC/DC registration", () => {
  assert.equal(core.technicalIndicatorDefinitions.length, EXPECTED_COMPUTED_COUNT);
  assert.deepEqual(
    core.technicalIndicatorDefinitions.slice(45, 50).map((d) => d.id),
    ["parabolic-sar", "supertrend", ...ids]
  );
  for (const id of ids) {
    const d = core.getTechnicalIndicatorDefinition(id);
    assert.deepEqual(make(id).params, defaults[id]);
    assert.equal(d.defaultPane, "overlay");
    assert.equal(d.presentation.precisionPolicy, "native-price");
    assert.equal(d.presentation.fills.length, 0);
    assert.ok(
      d.presentation.plots.every(
        (p) => p.geometry.kind === "line" && p.geometry.gaps === "break" && p.color.kind === "solid"
      )
    );
  }
  assert.deepEqual(
    core.getTechnicalIndicatorDefinition("alma").parameters.map((p) => p.key),
    ["length", "offset", "sigma"]
  );
  assert.deepEqual(
    core.getTechnicalIndicatorDefinition("chandelier-exit").outputs.map((o) => [o.id, o.color]),
    [
      ["longExit", "#2962FF"],
      ["shortExit", "#FF6D00"]
    ]
  );
  const catalog = load("model/technical-indicators/catalog.js");
  assert.equal(
    catalog.technicalCatalogEntries("ru").filter((e) => e.available).length,
    EXPECTED_TECHNICAL_COUNT
  );
  for (const id of ["STD;Keltner_Channels", "STD;Donchian_Channels"])
    assert.equal(catalog.technicalDefinitionForCatalog(id), undefined);
});

test("reviewed math package is byte-identical780e9c5; old47 definitions/params/styles/results/history are exact7cc9df9 witnesses", () => {
  const git = (sha, p) =>
    execFileSync("git", ["show", `${sha}:src/${p}`], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    });
  for (const name of ["averages", "channels", "filters", "index", "inputs", "metadata"]) {
    const p = `model/technical-indicators/channel-average/${name}.ts`;
    assert.equal(
      readFileSync(new URL("../src/" + p, import.meta.url), "utf8"),
      git("780e9c5287153021b516b472fb1282b22f3b59a4", p)
    );
  }
  const old = createSourceLoader({}, (r) => git("7cc9df914d78dc3da545fc17e11d5baa268fe490", r))(
    "model/technical-indicators/index.js"
  );
  assert.deepEqual(
    core.technicalIndicatorDefinitions.slice(0, 47),
    old.technicalIndicatorDefinitions
  );
  const input = bars(85),
    context = { historicalVolatilityPeriodsPerYear: 365 };
  for (const d of old.technicalIndicatorDefinitions) {
    const opts = {
      styles: Object.fromEntries(
        d.outputs.map((o, i) => [
          o.id,
          { color: "#123456", width: 2, visible: i % 2 === 0, opacity: 0.35, lineStyle: "dotted" }
        ])
      ),
      pane: { kind: "pane", id: "shared" },
      order: 4
    };
    const a = core.createTechnicalIndicatorInstance(d.id, d.id, opts),
      b = old.createTechnicalIndicatorInstance(d.id, d.id, opts);
    assert.deepEqual(a, b, d.id + " instance");
    assert.deepEqual(
      core.calculateTechnicalIndicator(a, input, context),
      old.calculateTechnicalIndicator(b, input, context),
      d.id + " result"
    );
    assert.deepEqual(
      core.technicalIndicatorHistoryRequirement(a),
      old.technicalIndicatorHistoryRequirement(b)
    );
  }
});

test("ALMA/LSMA causal ledgers and fixed-close/source selection agree with pure math; CE outputs are simultaneous unratcheted exits", () => {
  const b = [1, 4, 2, 7, 3].map((close, i) => ({
    timestamp: i + 1,
    open: close,
    close,
    high: close + 2,
    low: close - 1,
    volume: i + 1
  }));
  assert.deepEqual(
    calc("alma", b, { length: 3 }).series.value,
    math.alma(
      b.map((b) => b.close),
      { length: 3, offset: 0.85, sigma: 6 }
    )
  );
  const linear = calc("lsma", b.slice(0, 3), { length: 3 });
  assert.ok(Math.abs(linear.series.value[2] - 17 / 6) < 1e-12);
  for (const source of core.PRICE_SOURCES)
    for (const offset of [-2, 0, 2]) {
      const r = calc("lsma", b, { length: 3, source, offset });
      assert.deepEqual(r.series.value, math.lsma(selectedPrices(b, source), { length: 3, offset }));
      assert.deepEqual(
        r.timestamps,
        b.map((b) => b.timestamp)
      );
    }
  const ledger = [
    [10, 8, 9],
    [15, 11, 14],
    [14, 10, 11],
    [20, 16, 18],
    [12, 8, 10],
    [13, 9, 12],
    [8, 4, 5]
  ].map(([high, low, close], i) => ({
    timestamp: i + 1,
    open: close,
    high,
    low,
    close,
    volume: null
  }));
  const ce = calc("chandelier-exit", ledger, { length: 3, atrLength: 2, multiplier: 2 });
  assert.deepEqual(ce.series, {
    longExit: [null, 7, 7, 7, 3.5, 7.75, -1.125],
    shortExit: [null, 16, 16, 23, 24.5, 20.25, 18.125]
  });
  assert.equal(core.technicalIndicatorWarmup(make("alma")), 9);
  assert.equal(core.technicalIndicatorWarmup(make("lsma")), 25);
  assert.equal(
    core.technicalIndicatorWarmup(make("chandelier-exit", { length: 50, atrLength: 2 })),
    2
  );
  assert.equal(
    core.technicalIndicatorHistoryRequirement(make("chandelier-exit")).convergence,
    "full-input-dependent"
  );
  assert.equal(
    core.isTechnicalIndicatorInstance({ ...make("lsma"), params: { ...defaults.lsma, length: 1 } }),
    false
  );
  assert.equal(
    core.isTechnicalIndicatorInstance({
      ...make("alma"),
      params: { ...defaults.alma, floor: false }
    }),
    false
  );
});

test("cost preflight has exact50M boundary and prevents kernel calls before any calculation/metadata; errors below cap propagate", () => {
  let calls = 0;
  const fake = {
    ...math,
    alma(s) {
      calls++;
      return s.map(() => null);
    },
    lsma(s) {
      calls++;
      return s.map(() => null);
    }
  };
  const guarded = createSourceLoader({
    "model/technical-indicators/channel-average/index.js": fake
  })("model/technical-indicators/index.js");
  for (const id of ["alma", "lsma"]) {
    const i = guarded.createTechnicalIndicatorInstance(id, id, { params: { length: 1000 } });
    const exact = bars(50999),
      over = [...exact, { ...exact.at(-1), timestamp: exact.at(-1).timestamp + 60000 }];
    assert.equal(guarded.technicalCalculationUnavailableReason(i, 50999), undefined);
    assert.equal(guarded.technicalCalculationUnavailableReason(i, 51000), "calculation-limit");
    let previous = calls;
    const limited = guarded.calculateTechnicalIndicator(i, over);
    assert.equal(calls, previous);
    assert.equal(limited.unavailableReason, "calculation-limit");
    assert.deepEqual(
      limited.timestamps,
      over.map((b) => b.timestamp)
    );
    assert.equal(limited.series.value.length, 51000);
    assert.ok(limited.series.value.every((v) => v === null));
    assert.equal(guarded.calculateTechnicalIndicator(i, exact).unavailableReason, undefined);
    assert.equal(calls, previous + 1);
  }
  assert.equal(
    core.technicalCalculationUnavailableReason(make("chandelier-exit"), 1000001),
    "calculation-limit"
  );
  const defect = Error("kernel defect");
  const broken = createSourceLoader({
    "model/technical-indicators/channel-average/index.js": {
      ...math,
      alma() {
        throw defect;
      }
    }
  })("model/technical-indicators/index.js");
  assert.throws(
    () => broken.calculateTechnicalIndicator(make("alma"), bars(10)),
    (e) => e === defect
  );
});

for (const id of ["alma", "lsma"])
  test(`${id}: limit recovery after history/params change invalidates cache; reload recomputes reason; another indicator keeps real values`, () => {
    const data = new (load("charts/technical-render-data.js").TechnicalRenderData)();
    const input = bars(16000),
      i = make(id, { length: 10000 }),
      other = make("ema");
    const before = JSON.stringify(i);
    data.setData(input);
    let r = data.compile([i, other]);
    assert.ok(r.outputs.find((o) => o.instanceId === id).values.every((v) => v === null));
    assert.ok(r.outputs.find((o) => o.instanceId === "ema").values.some(Number.isFinite));
    data.setData(input.slice(0, 10000));
    r = data.compile([i]);
    assert.equal(r.outputs[0].values.filter(Number.isFinite).length, 1);
    assert.equal(calc(id, input.slice(0, 10000), { length: 10000 }).unavailableReason, undefined);
    data.setData(input);
    assert.ok(data.compile([i]).outputs[0].values.every((v) => v === null));
    const cheaper = { ...i, params: { ...i.params, length: 9 } };
    assert.ok(data.compile([cheaper]).outputs[0].values.some(Number.isFinite));
    const reload = new (load("charts/technical-render-data.js").TechnicalRenderData)();
    reload.setData(input.slice(0, 10000));
    assert.deepEqual(
      reload.compile([JSON.parse(before)]).outputs[0].values,
      calc(id, input.slice(0, 10000), { length: 10000 }).series.value
    );
    assert.equal(JSON.stringify(i), before);
    assert.equal(input.length, 16000);
  });

test("LSMA derived sources retain signed constant subnormal/MAX values without source overflow or invented zero", () => {
  for (const value of [Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE]) {
    const input = Array.from({ length: 3 }, (_, i) => ({
      timestamp: i + 1,
      open: value,
      high: value,
      low: value,
      close: value,
      volume: 1
    }));
    for (const source of ["hl2", "hlc3", "ohlc4"])
      assert.equal(calc("lsma", input, { length: 3, source }).series.value[2], value);
  }
});

test("captured verified primary versions/hash and explicit CE color remain the accepted references", () => {
  const rows = JSON.parse(
    readFileSync(new URL("../docs/CHANNEL_AVERAGE_PRIMARY_CAPTURE.json", import.meta.url), "utf8")
  );
  for (const id of ids) {
    const p = math.channelAveragePresets.find((p) => p.id === id),
      r = rows.find((r) => r.id === p.publicId);
    assert.equal(r.sha256, p.sourceSha256);
    assert.equal(r.version, p.verifiedVersion);
    assert.equal(r.status, 200);
    assert.equal(r.fullSourceSaved, false);
  }
  assert.deepEqual(rows[2].plotColorTokens, [[], ["#ff6d00"]]);
});

test("new params/styles round-trip v1 JSON/Drive exactkeys; runtime status and floor/CE community params are rejected", () => {
  for (const id of ids) {
    const i = make(id);
    i.styles = Object.fromEntries(
      core
        .getTechnicalIndicatorDefinition(id)
        .outputs.map((o) => [
          o.id,
          { color: "#123456", width: 3, visible: false, opacity: 0.4, lineStyle: "dotted" }
        ])
    );
    i.pane = { kind: "pane", id: "new" };
    const b = {
      application: "personal-terminal",
      schemaVersion: 1,
      layout: { technicalIndicators: [i] },
      drawings: [],
      images: []
    };
    assert.deepEqual(
      load("model/backup-format.js").validateBackup(JSON.parse(JSON.stringify(b))).layout
        .technicalIndicators,
      [i]
    );
    assert.deepEqual(
      load("services/drive/backup.js").sanitizeDriveBackup(b).layout.technicalIndicators,
      [i]
    );
    for (const key of [
      "unavailableReason",
      "series",
      "timestamps",
      "status",
      "warmupBars",
      "historyRequirement",
      "presentation"
    ]) {
      const bad = { ...i, [key]: "calculation-limit" };
      assert.equal(core.isTechnicalIndicatorInstance(bad), false);
      assert.throws(() =>
        load("services/drive/backup.js").sanitizeDriveBackup({
          ...b,
          layout: { technicalIndicators: [bad] }
        })
      );
    }
  }
  for (const params of [
    { ...defaults.alma, source: "close" },
    { ...defaults.alma, floor: false }
  ])
    assert.equal(core.isTechnicalIndicatorInstance({ ...make("alma"), params }), false);
  for (const key of ["sourceClose", "ratchet", "direction", "signals"])
    assert.equal(
      core.isTechnicalIndicatorInstance({
        ...make("chandelier-exit"),
        params: { ...defaults["chandelier-exit"], [key]: true }
      }),
      false
    );
});

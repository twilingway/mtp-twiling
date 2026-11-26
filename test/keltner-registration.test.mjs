import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXPECTED_COMPUTED_IDS,
  EXPECTED_TECHNICAL_COUNT
} from "./technical-registry-expectation.mjs";
import {
  core,
  load,
  make,
  defaults,
  bars,
  ledger,
  calculate,
  closeSeries,
  invalidInstances,
  createSourceLoader
} from "./keltner-fixture.mjs";
const math = load("model/technical-indicators/channel-average/index.js"),
  { keltnerMetadata } = load("model/technical-indicators/keltner-runtime.js");

test("KC follows pinned old50; primary defaults/colors/fill and local catalog are exact", () => {
  assert.deepEqual(
    core.technicalIndicatorDefinitions.slice(0, 50).map((d) => d.id),
    EXPECTED_COMPUTED_IDS.slice(0, 50)
  );
  assert.equal(core.technicalIndicatorDefinitions[50].id, "keltner-channels");
  assert.deepEqual(make().params, defaults);
  assert.deepEqual(make().pane, { kind: "overlay" });
  const d = core.getTechnicalIndicatorDefinition("keltner-channels"),
    capture = JSON.parse(
      readFileSync(new URL("../docs/KELTNER_PRIMARY_CAPTURE.json", import.meta.url), "utf8")
    ),
    preset = math.channelAveragePresets.find((p) => p.id === d.id);
  assert.equal(capture.status, 200);
  assert.equal(capture.fullSourceSaved, false);
  assert.equal(capture.sha256, preset.sourceSha256);
  assert.equal(capture.version, preset.verifiedVersion);
  assert.match(capture.tls, /CERT_REQUIRED\/check_hostname/);
  assert.deepEqual(
    d.outputs.map((o) => o.title),
    capture.plots.map((p) => p.title)
  );
  assert.deepEqual(
    d.outputs.map((o) => o.color),
    capture.plots.map((p) => p.colorTokens[0])
  );
  assert.deepEqual(capture.fills[0].rgbaPine, [33, 150, 243, 95]);
  assert.deepEqual(
    capture.inputs.map((entry) => entry.default),
    [20, 2, "close", true, "Average True Range", 10]
  );
  assert.deepEqual(
    capture.inputs.find((entry) => entry.variable === "BandsStyle").strings.slice(1, 4),
    core.KELTNER_BANDS_STYLES
  );
  assert.deepEqual(d.presentation.fills, [
    {
      id: "background",
      fromSeries: "upper",
      toSeries: "lower",
      color: "#2196F3",
      opacity: 0.05,
      gaps: "break"
    }
  ]);
  assert.equal(d.presentation.precisionPolicy, "native-price");
  assert.deepEqual(d.presentation.hiddenSeries, []);
  assert.ok(
    d.presentation.plots.every(
      (p) => p.geometry.kind === "line" && p.geometry.gaps === "break" && p.width === 1
    )
  );
  assert.ok(Object.isFrozen(d) && Object.isFrozen(d.parameters) && Object.isFrozen(d.presentation));
  const catalog = load("model/technical-indicators/catalog.js");
  assert.equal(catalog.technicalDefinitionForCatalog("STD;Keltner_Channels"), "keltner-channels");
  assert.equal(catalog.technicalDefinitionForCatalog("STD;Donchian_Channels"), undefined);
  for (const locale of ["ru", "en"]) {
    assert.equal(
      catalog.technicalCatalogEntries(locale).filter((e) => e.available).length,
      EXPECTED_TECHNICAL_COUNT
    );
    assert.equal(
      catalog.technicalCatalogEntries(locale, "blocked").filter((e) => e.available).length,
      0
    );
  }
});

test("all six EMA/SMA band modes match independent rational ledger and exact dynamic history/readiness", () => {
  const source = ledger(),
    ema = [9, 23 / 2, 45 / 4, 117 / 8, 197 / 16, 389 / 32, 549 / 64],
    sma = [null, null, 34 / 3, 43 / 3, 13, 40 / 3, 9],
    ranges = {
      "Average True Range": [null, 4, 4, 13 / 2, 33 / 4, 49 / 8, 113 / 16],
      "True Range": [2, 6, 4, 9, 10, 4, 8],
      Range: [null, null, 10 / 3, 32 / 9, 100 / 27, 308 / 81, 940 / 243]
    };
  for (const useExponentialMa of [true, false])
    for (const [bandsStyle, range] of Object.entries(ranges)) {
      const params = { length: 3, multiplier: 2, atrLength: 2, useExponentialMa, bandsStyle },
        r = calculate(source, params),
        basis = useExponentialMa ? ema : sma;
      closeSeries(r.series.basis, basis);
      for (const [key, sign] of [
        ["upper", 1],
        ["lower", -1]
      ])
        closeSeries(
          r.series[key],
          basis.map((v, i) => (v === null || range[i] === null ? null : v + sign * 2 * range[i]))
        );
      const reviewed = math.channelAverageMetadata("keltner-channels", params),
        m = keltnerMetadata(make(params));
      assert.deepEqual(m.historyRequirement, reviewed.historyRequirement);
      assert.deepEqual(m.firstReadyBars, reviewed.firstReadyBars);
      assert.equal(r.warmupBars, reviewed.warmupBars);
      assert.deepEqual(r.historyRequirement, m.historyRequirement);
      assert.equal(core.technicalIndicatorWarmup(make(params)), r.warmupBars);
      assert.deepEqual(
        core.technicalIndicatorHistoryRequirement(make(params)),
        r.historyRequirement
      );
    }
  const r = calculate(bars(12));
  assert.equal(r.warmupBars, 10);
  assert.equal(
    r.series.basis.findIndex((v) => v !== null),
    0
  );
  assert.equal(
    r.series.upper.findIndex((v) => v !== null),
    9
  );
  assert.equal(
    r.series.lower.findIndex((v) => v !== null),
    9
  );
  const one = calculate(ledger(), { length: 1, useExponentialMa: false, bandsStyle: "True Range" });
  assert.equal(one.warmupBars, 1);
  assert.equal(one.historyRequirement.lookbackBars, 2);
  assert.equal(one.historyRequirement.kind, "finite");
  assert.equal(one.series.basis[0], 9);
  assert.equal(one.series.upper[0], 13);
});

test("source selection, independent sparse streams, prefixes, timestamps and finite extremes preserve reviewed raw outputs", () => {
  const input = Object.freeze(
      bars(17).map((b, i) =>
        Object.freeze(
          i === 4
            ? { ...b, open: null }
            : i === 7
              ? { ...b, close: null }
              : i === 10
                ? { ...b, high: null }
                : i === 12
                  ? { ...b, volume: null }
                  : b
        )
      )
    ),
    before = JSON.stringify(input);
  for (const source of core.PRICE_SOURCES)
    for (const bandsStyle of core.KELTNER_BANDS_STYLES) {
      const params = { source, bandsStyle, length: 3, atrLength: 2 },
        result = calculate(input, params);
      assert.deepEqual(result.series, math.keltnerChannels(input, params));
      assert.deepEqual(
        result.timestamps,
        input.map((b) => b.timestamp)
      );
      for (let n = 0; n <= input.length; n++)
        for (const [key, series] of Object.entries(calculate(input.slice(0, n), params).series))
          assert.deepEqual(series, result.series[key].slice(0, n));
    }
  assert.equal(JSON.stringify(input), before);
  assert.ok(
    calculate(
      bars(5).map((b) => ({ ...b, volume: null })),
      { length: 1, bandsStyle: "True Range" }
    ).series.basis.every(Number.isFinite)
  );
  assert.ok(
    calculate(
      bars(5).map((b) => ({ ...b, volume: null })),
      { source: "volume" }
    ).series.basis.every((v) => v === null)
  );
  const missing = bars(4).map((b) => ({ ...b, close: null, high: null, low: null, open: null }));
  assert.ok(
    Object.values(calculate(missing).series).every((line) => line.every((v) => v === null))
  );
  const zero = bars(4).map((b) => ({ ...b, open: 0, close: 0, high: 0, low: 0 }));
  assert.deepEqual(calculate(zero, { length: 1, atrLength: 1 }).series.basis, [0, 0, 0, 0]);
  for (const value of [Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE]) {
    const constant = bars(4).map((b) => ({
      ...b,
      open: value,
      high: value,
      low: value,
      close: value
    }));
    for (const source of ["hl2", "hlc3", "ohlc4"])
      assert.equal(
        calculate(constant, { source, length: 2, atrLength: 1 }).series.basis.at(-1),
        value
      );
  }
});

test("boolean and exact3 choices reject coercion/missing/unknown/style/runtime fields before runtime", () => {
  for (const item of invalidInstances()) {
    assert.equal(core.isTechnicalIndicatorInstance(item), false);
    assert.throws(() => core.calculateTechnicalIndicator(item, []), RangeError);
  }
  for (const p of core.getTechnicalIndicatorDefinition("keltner-channels").parameters)
    if (p.type === "number" || p.type === "integer")
      for (const value of [p.min, p.max])
        assert.equal(core.isTechnicalIndicatorInstance(make({ [p.key]: value })), true);
  for (const useExponentialMa of [true, false])
    for (const bandsStyle of core.KELTNER_BANDS_STYLES)
      assert.equal(core.isTechnicalIndicatorInstance(make({ useExponentialMa, bandsStyle })), true);
  for (const change of [{ high: NaN }, { volume: -1 }, { close: 999 }])
    assert.throws(() => calculate([{ ...bars(1)[0], ...change }]), RangeError);
});

test("real bridge exposes3 actual price plots and one normal paired fill in price/own pane, without hidden0 carrier", () => {
  for (const pane of [{ kind: "overlay" }, { kind: "pane", id: "own" }]) {
    const instance = make({}, { pane }),
      data = new (load("charts/technical-render-data.js").TechnicalRenderData)();
    data.setData(bars(14));
    const rendered = data.compile([instance]);
    assert.equal(rendered.outputs.length, 3);
    assert.equal(rendered.fills.length, 1);
    assert.deepEqual(
      rendered.outputs.map((o) => o.outputId),
      ["upper", "basis", "lower"]
    );
    assert.ok(rendered.outputs.every((o) => o.presentation.precisionPolicy === "native-price"));
    assert.equal(rendered.fills[0].scalePlotKey, "kc/lower");
    assert.equal(rendered.fills[0].scale, "none");
    assert.equal(rendered.outputs[1].values[0], 100);
    assert.equal(rendered.outputs[0].values[0], null);
    instance.styles = {
      upper: { color: "#123456", width: 3, visible: false, opacity: 0.25, lineStyle: "dotted" }
    };
    const custom = data.compile([instance]);
    assert.equal(custom.outputs[0].style.visible, false);
    assert.equal(custom.fills[0].visible, true);
    instance.visible = false;
    assert.ok(data.compile([instance]).outputs.every((o) => !o.style.visible));
    assert.equal(data.compile([instance]).fills[0].visible, false);
    if (pane.kind === "pane") {
      instance.visible = true;
      assert.equal(
        data.compile([instance], [{ paneId: "own", heightRatio: 0.2, collapsed: true }]).fills[0]
          .visible,
        false
      );
    }
    data.dispose();
  }
});

test("1M bars preflight is transient, skips kernel only above cap, recovers and does not inherit quadratic MA budget", () => {
  let calls = 0;
  const guarded = createSourceLoader({
    "model/technical-indicators/channel-average/index.js": {
      ...math,
      keltnerChannels(input, params) {
        calls++;
        return input.length === 1000000
          ? {
              basis: input.map(() => null),
              upper: input.map(() => null),
              lower: input.map(() => null)
            }
          : math.keltnerChannels(input, params);
      }
    }
  })("model/technical-indicators/index.js");
  const instance = guarded.createTechnicalIndicatorInstance("keltner-channels", "limit", {
    params: { length: 10000 }
  });
  assert.equal(guarded.technicalCalculationUnavailableReason(instance, 1000000), undefined);
  assert.equal(
    guarded.technicalCalculationUnavailableReason(instance, 1000001),
    "calculation-limit"
  );
  const huge = Array.from({ length: 1000001 }, (_, i) => ({
      timestamp: i + 1,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 0
    })),
    before = JSON.stringify(instance);
  let result = guarded.calculateTechnicalIndicator(instance, huge);
  assert.equal(calls, 0);
  assert.equal(result.unavailableReason, "calculation-limit");
  assert.ok(
    Object.values(result.series).every(
      (line) => line.length === huge.length && line.every((v) => v === null)
    )
  );
  result = guarded.calculateTechnicalIndicator(instance, huge.slice(0, 1000000));
  assert.equal(calls, 1);
  assert.equal(Object.hasOwn(result, "unavailableReason"), false);
  const cheap = { ...instance, params: { ...instance.params, length: 2, atrLength: 1 } };
  result = guarded.calculateTechnicalIndicator(cheap, huge.slice(0, 4));
  assert.equal(result.series.basis[0], 1);
  assert.equal(result.series.upper[0], 1);
  assert.equal(calls, 2);
  assert.equal(JSON.stringify(instance), before);
  assert.equal(Object.hasOwn(instance, "unavailableReason"), false);
  const defect = Error("kernel defect"),
    broken = createSourceLoader({
      "model/technical-indicators/channel-average/index.js": {
        ...math,
        keltnerChannels() {
          throw defect;
        }
      }
    })("model/technical-indicators/index.js");
  assert.throws(
    () => broken.calculateTechnicalIndicator(make(), bars(4)),
    (e) => e === defect
  );
});

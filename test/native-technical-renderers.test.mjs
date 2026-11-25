import test from "node:test";
import assert from "node:assert/strict";
import { nativeFixture } from "./native-technical-fixture.mjs";

const bars = Array.from({ length: 150 }, (_, i) => {
  const close = 100 + i * 0.2 + Math.sin(i / 3) * 8;
  return {
    timestamp: Date.UTC(2025, 0, 1 + i),
    open: close - 1,
    high: close + 2,
    low: close - 3,
    close,
    volume: 10 + (i % 9)
  };
});
function api(f) {
  return {
    ...f.load("model/technical-indicators/instances.ts"),
    ...f.load("model/technical-indicators/definitions.ts"),
    ...f.load("model/technical-indicators/runtime.ts")
  };
}
function outputs(f, instances, data = bars, layout = []) {
  const { technicalIndicatorGroups } = f.load("model/technical-indicator-layout.ts");
  const { getTechnicalIndicatorDefinition, calculateTechnicalIndicator } = api(f);
  return technicalIndicatorGroups(instances, layout).flatMap((group) =>
    group.instances
      .filter((item) => item.visible)
      .flatMap((instance) => {
        const result = calculateTechnicalIndicator(instance, data);
        return getTechnicalIndicatorDefinition(instance.definitionId).outputs.map((output) => ({
          key: `${instance.id}/${output.id}`,
          instanceId: instance.id,
          outputId: output.id,
          timestamps: result.timestamps,
          values: result.series[output.id]
        }));
      })
  );
}
function assertValues(f, instances, data = bars, layout = []) {
  const expected = outputs(f, instances, data, layout);
  if (f.options.container && f.allSeries.length) {
    const actual = f.activeSeries().slice(4);
    assert.equal(actual.length, expected.length);
    // Output identity survives reorder; locate by its actual data rather than creation position.
    for (const output of expected) {
      const values = output.timestamps.map((timestamp, i) =>
        output.values[i] == null
          ? { time: timestamp / 1000 }
          : { time: timestamp / 1000, value: output.values[i] }
      );
      assert.ok(
        actual.some((series) => JSON.stringify(series.data) === JSON.stringify(values)),
        output.key
      );
    }
  } else {
    const actual = f.activeIndicators().filter((item) => item.name.startsWith("PERSONAL_TA_"));
    assert.equal(actual.length, new Set(expected.map((item) => item.instanceId)).size);
    for (const instance of instances.filter((item) => item.visible)) {
      const values = expected.filter((item) => item.instanceId === instance.id);
      const rows = (values[0]?.timestamps ?? []).map((_time, i) =>
        Object.fromEntries(values.map((output) => [output.outputId, output.values[i] ?? undefined]))
      );
      assert.ok(
        actual.some((entry) => JSON.stringify(entry.result) === JSON.stringify(rows)),
        instance.id
      );
    }
  }
}
test("LW pane metrics tolerate the model existing before its widget is created", () => {
  const f = nativeFixture("lightweight");
  const { createTechnicalIndicatorInstance: create } = api(f);
  const originalSize = f.native.paneSize;
  let widgetReady = false;
  f.native.paneSize = (index) => {
    if (index > 0 && !widgetReady) throw new Error("Value is undefined");
    return originalSize(index);
  };
  f.adapter.setData(bars);
  const instance = create("rsi", "new-pane");
  assert.doesNotThrow(() => f.adapter.updateTechnicalIndicators([instance], []));
  assert.equal(f.adapter.technicalPaneMetrics().at(-1).key, "pane:new-pane");
  widgetReady = true;
  f.ready();
  assertValues(f, [instance]);
  f.adapter.destroy();
});

for (const engine of ["lightweight", "kline"]) {
  test(`${engine}: actual adapter renders all 21 common formulas, warmup and real timestamps`, () => {
    const f = nativeFixture(engine),
      { createTechnicalIndicatorInstance: create, technicalIndicatorDefinitions: definitions } =
        api(f);
    const instances = definitions.map((definition, i) =>
      create(definition.id, `instance-${i}`, { order: i })
    );
    assert.equal(instances.length, 21);
    f.adapter.setData(bars);
    const writes = f.primaryWrites(),
      camera = f.camera();
    f.adapter.updateTechnicalIndicators(instances, []);
    f.ready();
    assertValues(f, instances);
    assert.equal(f.creations(), 1);
    assert.equal(f.primaryWrites(), writes);
    assert.deepEqual(f.camera(), camera);
    assert.equal(f.changes.length, 0);
    const lowerIds = new Set([
      "momentum",
      "roc",
      "cci",
      "williams-r",
      "mfi",
      "obv",
      "adl",
      "pvt",
      "rsi",
      "macd",
      "atr",
      "stochastic"
    ]);
    assert.deepEqual(
      f.adapter.technicalPaneMetrics().map((item) => item.key),
      [
        "price",
        ...instances
          .filter((item) => lowerIds.has(item.definitionId))
          .map((item) => `pane:${item.id}`)
      ]
    );
    if (engine === "lightweight") {
      assert.ok(
        f
          .activeSeries()
          .slice(4)
          .some((item) => item.data.some((point) => !Object.hasOwn(point, "value")))
      );
      assert.ok(
        f
          .activeSeries()
          .slice(4)
          .every((item) => item.data.length === bars.length)
      );
    } else
      assert.ok(
        f
          .activeIndicators()
          .some(
            (item) =>
              item.name.startsWith("PERSONAL_TA_") &&
              Object.values(item.result[0]).some((value) => value === undefined)
          )
      );
    f.adapter.destroy();
  });

  test(`${engine}: independent same-pane RSI, live styles, collapse, visibility and legacy identity`, () => {
    const f = nativeFixture(engine, [], {
      indicators: { ma: true, ema: true, volume: true, mtp160: true }
    });
    const { createTechnicalIndicatorInstance: create } = api(f);
    let instances = [
      create("rsi", "rsi-one", { params: { length: 3 }, pane: { kind: "pane", id: "shared" } }),
      create("rsi", "rsi-two", {
        params: { length: 20 },
        pane: { kind: "pane", id: "shared" },
        order: 1
      })
    ];
    f.adapter.setData(bars);
    f.adapter.updateTechnicalIndicators(instances, []);
    f.ready();
    assertValues(f, instances);
    const legacy =
      engine === "lightweight"
        ? f.activeSeries().slice(0, 4)
        : f.activeIndicators().filter((item) => !item.name.startsWith("PERSONAL_TA_"));
    const owned =
      engine === "lightweight"
        ? f.activeSeries().slice(4)
        : f.activeIndicators().filter((item) => item.name.startsWith("PERSONAL_TA_"));
    assert.equal(owned.length, 2);
    if (engine === "kline") assert.notEqual(owned[0].name, owned[1].name);
    instances = [
      {
        ...instances[0],
        params: { ...instances[0].params, length: 5 },
        styles: {
          value: { color: "#112233", width: 3, visible: true, opacity: 0.4, lineStyle: "dotted" }
        }
      },
      { ...instances[1], order: 0 }
    ];
    f.adapter.updateTechnicalIndicators(instances, []);
    f.ready();
    assertValues(f, instances);
    const after =
      engine === "lightweight"
        ? f.activeSeries().slice(4)
        : f.activeIndicators().filter((item) => item.name.startsWith("PERSONAL_TA_"));
    assert.deepEqual(after, owned, "same native objects on parameter/style changes");
    if (engine === "lightweight") {
      assert.equal(owned[0].options.color, "rgba(17,34,51,0.4)");
      assert.equal(owned[0].options.lineStyle, 1);
      assert.equal(owned[0].options.lineWidth, 3);
    } else {
      assert.equal(owned[0].styles.lines[0].color, "rgba(17,34,51,0.4)");
      assert.deepEqual(owned[0].styles.lines[0].dashedValue, [2, 3]);
    }
    const layout = [{ paneId: "shared", heightRatio: 0.4, collapsed: true }];
    f.adapter.updateTechnicalIndicators(instances, layout);
    f.ready();
    assert.ok(
      f.adapter.technicalPaneMetrics().find((item) => item.key === "pane:shared").height <= 31
    );
    assert.ok(
      (engine === "lightweight"
        ? owned.map((item) => item.options.visible)
        : owned.map((item) => item.visible)
      ).every((value) => value === false)
    );
    f.adapter.updateTechnicalIndicators(
      instances.map((item) => ({ ...item, visible: false })),
      []
    );
    f.ready();
    assert.equal(
      f.adapter.technicalPaneMetrics().filter((item) => item.key.startsWith("pane:")).length,
      1
    );
    assert.ok(
      (engine === "lightweight"
        ? owned.map((item) => item.options.visible)
        : owned.map((item) => item.visible)
      ).every((value) => value === false)
    );
    for (const item of legacy) assert.equal(item.removed, undefined);
    f.adapter.destroy();
  });

  test(`${engine}: historical corrections and prepends recalculate from complete history`, () => {
    const f = nativeFixture(engine),
      { createTechnicalIndicatorInstance: create } = api(f);
    const instances = [create("ema", "ema"), create("rsi", "rsi"), create("macd", "macd")];
    f.adapter.setData(bars.slice(20));
    f.adapter.updateTechnicalIndicators(instances, []);
    f.ready();
    f.adapter.setData(bars);
    f.ready();
    assertValues(f, instances);
    const next = bars.map((item) => ({ ...item }));
    next[50].close += 20;
    next[50].high += 20;
    const camera = f.camera();
    f.adapter.updateBar(next[50]);
    f.ready();
    assertValues(f, instances, next);
    assert.deepEqual(f.camera(), camera);
    next[next.length - 1].close += 1;
    f.adapter.updateBar(next.at(-1));
    f.ready();
    assertValues(f, instances, next);
    assert.equal(f.creations(), 1);
    f.adapter.destroy();
  });

  test(`${engine}: pane reorder and restore preserve price camera, range and projection bounds`, () => {
    const f = nativeFixture(engine),
      { createTechnicalIndicatorInstance: create } = api(f);
    f.adapter.setData(bars);
    const instances = [
      create("sma", "overlay"),
      create("rsi", "one", { order: 1 }),
      create("atr", "two", { order: 2 })
    ];
    f.adapter.setView({
      camera: { barSpace: 9, rightOffsetBars: -18 },
      anchor: { timestamp: bars[70].timestamp, xFraction: 0.4 }
    });
    f.ready();
    if (engine === "lightweight") {
      const scale = f.allSeries[0].priceScale();
      scale.applyOptions({ autoScale: false });
      scale.setVisibleRange({ from: 70, to: 130 });
    }
    const camera = f.camera(),
      writes = f.primaryWrites();
    f.adapter.updateTechnicalIndicators(instances, [
      { paneId: "one", heightRatio: 0.2, collapsed: false }
    ]);
    f.ready();
    const before =
      engine === "lightweight"
        ? f.activeSeries().slice(4)
        : f.activeIndicators().filter((item) => item.name.startsWith("PERSONAL_TA_"));
    f.adapter.updateTechnicalIndicators(
      [instances[0], { ...instances[1], order: 3 }, instances[2]],
      []
    );
    f.ready();
    assert.deepEqual(
      f.adapter.technicalPaneMetrics().map((item) => item.key),
      ["price", "pane:two", "pane:one"]
    );
    assert.equal(f.primaryWrites(), writes);
    assert.deepEqual(f.camera(), camera);
    if (engine === "lightweight") {
      assert.deepEqual(f.allSeries[0].priceScale().getVisibleRange(), { from: 70, to: 130 });
      for (const entry of before) assert.equal(entry.removed, undefined);
    } else {
      assert.equal(before[0].removed, undefined);
      assert.equal(before[1].removed, true);
      assert.equal(before[2].removed, true);
    }
    const price = f.adapter.technicalPaneMetrics()[0];
    assert.equal(f.adapter.plotSize().height, price.height);
    assert.ok(f.adapter.timeAxisTop() > price.height);
    assert.equal(f.adapter.pixelToPoint(100, price.height + 10), null);
    assert.ok(f.adapter.pixelToPoint(100, price.height / 2));
    assert.equal(f.creations(), 1);
    f.adapter.destroy();
  });

  test(`${engine}: 100 instances/32 lower groups normalize only rendering and capture only user resize`, () => {
    const f = nativeFixture(engine),
      { createTechnicalIndicatorInstance: create } = api(f);
    const { technicalMinimumCanvasHeight } = f.load("charts/technical-pane-geometry.ts");
    f.container.clientHeight = technicalMinimumCanvasHeight(32);
    f.resize();
    const instances = Array.from({ length: 100 }, (_, i) =>
      create("rsi", `rsi-${i}`, { pane: { kind: "pane", id: `lower-${i % 32}` }, order: i })
    );
    const layout = Array.from({ length: 32 }, (_, i) => ({
        paneId: `lower-${i}`,
        heightRatio: 0.8,
        collapsed: false
      })),
      original = JSON.stringify(layout);
    f.adapter.setData(bars);
    f.adapter.updateTechnicalIndicators(instances, layout);
    f.ready();
    let metrics = f.adapter.technicalPaneMetrics();
    assert.equal(metrics.length, 33);
    assert.ok(metrics[0].height >= 159.999);
    assert.ok(metrics.slice(1).every((item) => item.height >= 29.999));
    assert.equal(JSON.stringify(layout), original);
    assert.equal(f.changes.length, 0);
    f.container.clientHeight += 500;
    f.resize();
    assert.equal(f.changes.length, 0);
    assert.equal(JSON.stringify(layout), original);
    metrics = f.adapter.technicalPaneMetrics();
    const boundary = metrics[1].top + 10;
    f.container.dispatch("pointerdown", { clientY: boundary });
    if (engine === "lightweight") {
      f.panes[0].height -= 15;
      f.panes[1].height += 15;
    } else f.native.setPaneOptions({ id: "technical:lower-0", height: metrics[1].height + 15 });
    f.window.dispatch("pointerup", { clientY: boundary - 15 });
    f.ready();
    assert.equal(f.changes.length, 1);
    assert.equal(f.changes[0].length, 32);
    assert.notDeepEqual(f.changes[0][0], layout[0]);
    f.container.dispatch("pointerdown", { clientY: f.adapter.technicalPaneMetrics()[1].top + 10 });
    f.window.dispatch("blur");
    f.window.dispatch("pointerup", { clientY: 30 });
    f.ready();
    assert.equal(f.changes.length, 1);
    assert.ok(f.metricEvents.length > 0);
    f.adapter.destroy();
  });

  test(`${engine}: unfinished separator edits cannot publish preferences after cancel or restore`, () => {
    const f = nativeFixture(engine),
      { createTechnicalIndicatorInstance: create } = api(f);
    const instances = [create("rsi", "one"), create("atr", "two")];
    const layout = [
      { paneId: "one", heightRatio: 0.25, collapsed: false },
      { paneId: "two", heightRatio: 0.15, collapsed: false }
    ];
    f.adapter.setData(bars);
    f.adapter.updateTechnicalIndicators(instances, layout);
    f.ready();
    const begin = () => {
      const metrics = f.adapter.technicalPaneMetrics(),
        boundary = metrics[1].top + 10;
      f.container.dispatch("pointerdown", { clientY: boundary });
      if (engine === "lightweight") {
        f.panes[0].height -= 20;
        f.panes[1].height += 20;
      } else f.native.setPaneOptions({ id: "technical:one", height: metrics[1].height + 20 });
      return boundary;
    };
    let boundary = begin();
    f.window.dispatch("pointercancel");
    f.window.dispatch("pointerup", { clientY: boundary - 20 });
    f.ready();
    boundary = begin();
    f.window.dispatch("pointerup", { clientY: boundary - 20 });
    f.adapter.updateTechnicalIndicators(instances, layout);
    f.ready();
    boundary = begin();
    f.container.clientHeight += 100;
    f.resize();
    f.window.dispatch("pointerup", { clientY: boundary - 20 });
    f.ready();
    assert.equal(f.changes.length, 0);
    assert.equal(f.container.listeners.get("pointerdown").size, 1);
    f.adapter.destroy();
    assert.equal(f.container.listeners.get("pointerdown").size, 0);
    assert.equal(f.window.listeners.get("pointerup").size, 0);
  });

  test(`${engine}: dispose stops queued callbacks, data updates and stale owner contexts`, () => {
    const f = nativeFixture(engine),
      { createTechnicalIndicatorInstance: create } = api(f);
    f.adapter.setData(bars);
    f.adapter.updateTechnicalIndicators([create("rsi", "one")], []);
    const old =
      engine === "kline"
        ? f.activeIndicators().find((item) => item.name.startsWith("PERSONAL_TA_"))
        : null;
    const oldAxis = f.axisRegistry[0];
    f.adapter.destroy();
    const count = f.metricEvents.length,
      writes = f.primaryWrites();
    f.adapter.setData(bars);
    f.adapter.updateBar(bars.at(-1));
    f.adapter.updateTechnicalIndicators([], []);
    f.resize();
    f.window.dispatch("pointerup", { clientY: 100 });
    f.ready();
    assert.equal(f.metricEvents.length, count);
    assert.equal(f.primaryWrites(), writes);
    assert.equal(f.removed(), true);
    assert.deepEqual(f.adapter.technicalPaneMetrics(), []);
    if (old) {
      assert.deepEqual(old.calc(bars, old), []);
      assert.equal(old.extendData.context.disposed, true);
      assert.deepEqual(
        oldAxis.createTicks({ bounding: { width: 100 }, defaultTicks: [123] }),
        [123]
      );
    }
  });
}

test("KLine global callbacks stay isolated when another owner reuses the same bounded name", () => {
  let paints = 0;
  const f = nativeFixture("kline", [], {
    indicators: { mtp160: true },
    paint() {
      paints++;
    }
  });
  const { createTechnicalIndicatorInstance: create } = api(f);
  f.adapter.setData(bars);
  f.adapter.updateTechnicalIndicators([create("rsi", "old")], []);
  const old = f.activeIndicators().find((item) => item.name.startsWith("PERSONAL_TA_"));
  const mtp = f.activeIndicators().find((item) => item.name === "MTP_PERSONAL"),
    drawings = f.activeIndicators().find((item) => item.name === "DRAWINGS_PERSONAL");
  const oldAxis = f.axisRegistry.at(-1);
  f.adapter.destroy();
  const previousPaints = paints;
  const next = f.load("charts/kline-technical.ts").klineTechnical(
    f.native,
    f.options,
    () => true,
    () => null
  );
  next.setData(bars);
  next.update([create("rsi", "new")]);
  const current = f.activeIndicators().find((item) => item.name === old.name);
  assert.ok(current.result.length > 0);
  assert.deepEqual(old.calc(bars, old), []);
  assert.deepEqual(mtp.calc(bars, mtp), []);
  assert.equal(drawings.draw({ indicator: drawings }), true);
  assert.equal(paints, previousPaints);
  let reads = 0;
  const detach = f.load("charts/kline-calendar-axis.ts").attachCalendarXAxis(
    f.native,
    () => {
      reads++;
      return bars;
    },
    "1d"
  );
  assert.deepEqual(oldAxis.createTicks({ bounding: { width: 900 }, defaultTicks: [123] }), [123]);
  assert.equal(reads, 0);
  detach();
  next.dispose();
});

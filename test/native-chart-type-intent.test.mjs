import assert from "node:assert/strict";
import test from "node:test";
import { deferred, routingFixture, until } from "./controller-preference-routing-fixture.mjs";

const chartSettings = (fixture) => fixture.controller.getSnapshot().preferences.chartSettings;

test("chart type applies the latest choice and preserves the history, camera key and other settings", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  const original = f.controller.getSnapshot(),
    oldChart = f.controller.chart,
    oldKey = oldChart.source.viewKey,
    gates = [deferred(), deferred()];
  const priceRange = { from: 8, to: 14 };
  oldChart.setManualPriceRange(priceRange);
  let saves = 0;
  f.hooks.saveView = async () => {
    await gates[saves++]?.promise;
  };

  const line = f.controller.setChartType("line");
  const bars = f.controller.setChartType("bars");
  await until(() => saves === 2, "the two chart choices saved the camera");
  await f.controller.setChartSettings({ ...chartSettings(f), grid: false });
  gates[1].resolve();
  await bars;
  gates[0].resolve();
  await line;

  assert.equal(chartSettings(f).chartType, "bars");
  assert.equal(chartSettings(f).grid, false);
  assert.equal(f.controller.getSnapshot().candles, original.candles);
  assert.equal(f.controller.getSnapshot().chartRevision, original.chartRevision);
  assert.deepEqual(
    f.preferenceWrites.map((prefs) => prefs.chartSettings.chartType),
    [undefined, "bars"]
  );
  assert.equal(f.requests.length, 0);

  oldChart.options.onCrosshair(original.candles[0]);
  assert.equal(f.controller.getSnapshot().crosshairBar, null);
  f.remount();
  await until(() => f.controller.chart && f.controller.chart !== oldChart, "new native chart");
  assert.equal(f.controller.chart.source.viewKey, oldKey);
  assert.equal(f.controller.chart.options.settings.chartType, "bars");
  assert.deepEqual(f.controller.chart.getManualPriceRange(), priceRange);
  f.controller.chart.options.onCrosshair(original.candles[0]);
  assert.equal(f.controller.getSnapshot().crosshairBar, original.candles[0]);
});

test("chart type waits for drawing writes and rechecks the route before applying", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  const gate = deferred(),
    entered = deferred();
  f.hooks.annotations = async () => {
    entered.resolve();
    await gate.promise;
  };
  const drawings = f.controller.setDrawings([
    {
      id: "pending",
      name: "horizontalStraightLine",
      points: [{ timestamp: Date.now(), value: 11 }]
    }
  ]);
  await entered.promise;
  const area = f.controller.setChartType("area");
  await until(() => f.log.some(({ event }) => event === "saveView"), "chart type saved the camera");
  assert.equal(chartSettings(f).chartType, undefined);

  const { preferences } = f.controller.getSnapshot();
  f.controller.update({ preferences: { ...preferences, engine: "kline" } });
  gate.resolve();
  await Promise.all([drawings, area]);
  assert.equal(f.controller.getSnapshot().preferences.engine, "kline");
  assert.equal(f.controller.getSnapshot().drawings[0].id, "pending");
  assert.equal(chartSettings(f).chartType, undefined);
  assert.equal(f.preferenceWrites.length, 0);
});

test("choosing the current default cancels a pending type and leaves the legacy field absent", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  const gate = deferred(),
    entered = deferred();
  f.hooks.saveView = async () => {
    entered.resolve();
    await gate.promise;
  };
  const area = f.controller.setChartType("area");
  await entered.promise;
  await f.controller.setChartType("candles");
  gate.resolve();
  await area;
  assert.equal(Object.hasOwn(chartSettings(f), "chartType"), false);
  assert.equal(f.preferenceWrites.length, 0);
  assert.equal(f.requests.length, 0);
  const count = f.log.length;
  await assert.rejects(f.controller.setChartType("heikin-ashi"), { name: "RangeError" });
  assert.equal(f.log.length, count);
});

test("a stale ordinary settings form preserves a newly selected chart type", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  await f.controller.setChartType("line");
  const gate = deferred(),
    entered = deferred();
  f.hooks.saveView = async () => {
    entered.resolve();
    await gate.promise;
  };
  const settings = f.controller.setChartSettings({ ...chartSettings(f), grid: false });
  await entered.promise;
  f.hooks.saveView = undefined;
  await f.controller.setChartType("area");
  gate.resolve();
  await settings;
  assert.equal(chartSettings(f).chartType, "area");
  assert.equal(chartSettings(f).grid, false);
  assert.equal(f.preferenceWrites.at(-1).chartSettings.chartType, "area");
  assert.equal(f.requests.length, 0);
});

test("saving a full settings form still removes intentionally omitted appearance fields", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  await f.controller.setChartSettings({ lastPriceColor: "#2266ff" });
  const settings = { ...chartSettings(f) };
  delete settings.lastPriceColor;
  await f.controller.setChartType("area");
  await f.controller.setPreferences({ chartSettings: settings });
  assert.equal(chartSettings(f).chartType, "area");
  assert.equal(Object.hasOwn(chartSettings(f), "lastPriceColor"), false);
});

test("an auxiliary chart changes only its own type and saves its own camera before switching", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  await f.controller.setChartType("line");
  const parent = f.controller.getSnapshot();
  let historyRequests = 0;
  Object.assign(f.client, {
    addEventListener() {},
    removeEventListener() {},
    serverNow: () => Date.now(),
    watchCandles: () => () => {},
    loadCandles: async () => {
      historyRequests++;
      return { candles: parent.candles, cached: true, requests: 0 };
    }
  });
  const { WorkspacePanelController } = f.load("screens/terminal/workspace-panel-controller.ts");
  const { loadPanelPreferences } = f.load("screens/terminal/workspace-panel-preferences.ts");
  const { viewKey } = f.load("screens/terminal/controller-bridge.ts");
  const panel = new WorkspacePanelController(f.controller, 2, () => {});
  t.after(() => {
    panel.stop();
    panel.dispose();
  });
  panel.configure(parent.rows[0], parent);
  await until(
    () => panel.getSnapshot().annotationReady && !panel.getSnapshot().loading,
    "auxiliary chart loaded"
  );
  const initial = panel.getSnapshot();
  assert.equal(initial.preferences.chartSettings.chartType, undefined);
  const camera = { camera: { barSpace: 9, rightOffsetBars: 6 } };
  const view = viewKey(initial.preferences);
  panel.chart = {
    source: { owner: parent.owner, viewKey: view, uid: parent.rows[0].uid },
    getView: () => camera
  };
  const positions = [];
  f.db.put = async (name, record) => {
    positions.push([name, record]);
  };
  await panel.setChartType("bars");
  const current = panel.getSnapshot();
  assert.equal(current.preferences.chartSettings.chartType, "bars");
  assert.equal(current.candles, initial.candles);
  assert.equal(chartSettings(f).chartType, "line");
  assert.equal(f.preferenceWrites.length, 1);
  assert.equal(historyRequests, 1);
  assert.equal(
    loadPanelPreferences(parent.owner, 2, parent.preferences).chartSettings.chartType,
    "bars"
  );
  assert.deepEqual(structuredClone(positions), [
    [
      "preferences",
      { id: `workspace-camera:${JSON.stringify([parent.owner, 2, view])}`, value: camera }
    ]
  ]);
});

for (const [boundary, invalidate] of Object.entries({
  owner: ({ controller }) => {
    const { owner } = controller.getSnapshot();
    controller.update({ owner: "other" });
    controller.update({ owner });
  },
  import: ({ controller }) => {
    controller.update({ importingBackup: true });
    controller.update({ importingBackup: false });
  },
  revision: ({ controller }) => {
    const { chartRevision } = controller.getSnapshot();
    controller.update({ chartRevision: chartRevision + 1 });
  },
  uid: ({ controller }) => {
    const { rows } = controller.getSnapshot();
    controller.update({ rows: rows.map((row) => ({ ...row, uid: "another-uid" })) });
  },
  session: ({ controller, client }) => {
    controller.session.client = { ...client };
  }
})) {
  test(`pending chart type cannot cross a changed ${boundary}`, async (t) => {
    const f = await routingFixture();
    t.after(() => f.close());
    const gate = deferred(),
      entered = deferred();
    f.hooks.saveView = async () => {
      entered.resolve();
      await gate.promise;
    };
    const area = f.controller.setChartType("area");
    await entered.promise;
    invalidate(f);
    gate.resolve();
    await area;
    assert.equal(Object.hasOwn(chartSettings(f), "chartType"), false);
    assert.equal(f.preferenceWrites.length, 0);
    assert.equal(f.requests.length, 0);
  });
}

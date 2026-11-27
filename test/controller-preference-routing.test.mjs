import test from "node:test";
import assert from "node:assert/strict";
import { routingFixture, deferred, until, find } from "./controller-preference-routing-fixture.mjs";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

function settingsEngineControl(controller) {
  const jsx = (type, props) => ({ type, props });
  const load = createSourceLoader({
    react: {
      useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}]
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("fragment") },
    "react-dom": { createPortal: () => assert.fail("settings fixture must not open a portal") },
    "screens/terminal/context.js": {
      useTerminal: () => ({ controller, state: controller.getSnapshot() })
    }
  });
  const settings = load("screens/terminal/ChartSettingsDialog.js").ChartSettingsDialog();
  const sections = find(settings, (node) => node.props?.content?.instrument);
  const picker = find(sections.props.content.instrument, (node) =>
    node.props?.id === "chart-settings-engine"
  );
  return load("screens/terminal/ChartEngineSelect.js").ChartEngineSelect(picker.props);
}

test("switching the timeframe leaves the instrument drawings available during history loading", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  const drawings = [{ id: "support", name: "horizontalStraightLine", points: [{ timestamp: 1, value: 10 }] }];
  const view = deferred();
  f.controller.update({ drawings });
  f.hooks.loadView = async () => view.promise;
  const switching = f.controller.setTimeframe("4h");
  await until(() => f.controller.getSnapshot().preferences.timeframe === "4h");
  assert.deepEqual(f.controller.getSnapshot().drawings, drawings);
  view.resolve();
  await switching;
});

for (const boundary of ["saveView", "editing.flush"]) {
  test(`independent TF/engine intents compose while ${boundary} waits, with old camera origin`, async (t) => {
    const f = await routingFixture();
    t.after(() => f.close());
    const gate = deferred(),
      entered = deferred();
    if (boundary === "saveView") {
      let calls = 0;
      f.hooks.saveView = async () => {
        if (++calls === 1) {
          entered.resolve();
          await gate.promise;
        }
      };
    } else {
      f.hooks.annotations = async () => {
        entered.resolve();
        await gate.promise;
      };
      void f.controller.setDrawings([
        {
          id: "pending",
          name: "horizontalStraightLine",
          points: [{ timestamp: Date.now(), value: 11 }]
        }
      ]);
    }
    const tf = f.controller.setTimeframe("1h");
    await entered.promise;
    assert.equal(f.controller.getSnapshot().preferences.timeframe, "1d");
    assert.equal(f.preferenceWrites.length, 0);
    const engineControl = settingsEngineControl(f.controller);
    assert.equal(engineControl.type, "select");
    assert.equal(engineControl.props.id, "chart-settings-engine");
    assert.equal(engineControl.props.value, "tradingview");
    assert.ok(!engineControl.props.disabled);
    const engine = f.controller.setPreferences({ engine: "kline" });
    gate.resolve();
    await Promise.all([tf, engine]);
    const p = f.controller.getSnapshot().preferences;
    assert.equal(p.timeframe, "1h");
    assert.equal(p.engine, "kline");
    assert.deepEqual(
      f.requests.map((request) => [request.timeframe, request.engine]),
      [["1h", "kline"]]
    );
    assert.ok(
      f.log
        .filter((entry) => entry.event === "saveView")
        .every((entry) => entry.key.includes(":1d:tradingview:"))
    );
  });
}

test("same-field latest depth before first commit writes only latest camera target", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  const gate = deferred(),
    entered = deferred();
  let calls = 0;
  f.hooks.saveView = async () => {
    if (++calls === 1) {
      entered.resolve();
      await gate.promise;
    }
  };
  const first = f.controller.setPreferences({ rangeDays: 5 });
  await entered.promise;
  const latest = f.controller.setPreferences({ rangeDays: 30 });
  gate.resolve();
  await Promise.all([first, latest]);
  assert.equal(f.controller.getSnapshot().preferences.rangeDays, 30);
  assert.ok(!f.log.some((entry) => entry.event === "transactionPut" && entry.key.endsWith(":5")));
  assert.ok(f.log.some((entry) => entry.event === "transactionPut" && entry.key.endsWith(":30")));
});

test("independent symbol/TF compose and latest symbol clears older explicit pending UID", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  const state = f.controller.getSnapshot();
  f.controller.update({
    rows: [
      ...state.rows,
      { ...state.rows[0], symbol: "SBER", ticker: "SBER", uid: "uid-SBER" },
      { ...state.rows[0], symbol: "RTSI", ticker: "RTSI", uid: "uid-RTSI" }
    ]
  });
  const gate = deferred(),
    entered = deferred();
  let calls = 0;
  f.hooks.saveView = async () => {
    if (++calls === 1) {
      entered.resolve();
      await gate.promise;
    }
  };
  const first = f.controller.setPreferences({ symbol: "SBER", instrumentUid: "uid-SBER" });
  await entered.promise;
  const tf = f.controller.setTimeframe("1h");
  const latest = f.controller.setPreferences({ symbol: "RTSI" });
  gate.resolve();
  await Promise.all([first, tf, latest]);
  const p = f.controller.getSnapshot().preferences;
  assert.equal(p.symbol, "RTSI");
  assert.equal(p.instrumentUid, "uid-RTSI");
  assert.equal(p.timeframe, "1h");
  assert.deepEqual(
    f.requests.map((request) => [request.symbol, request.timeframe, request.uid]),
    [["RTSI", "1h", "uid-RTSI"]]
  );
});

test("late intent during carry invalidates its transaction guard and retries combined latest intent", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  const gate = deferred(),
    entered = deferred();
  let calls = 0;
  f.hooks.transaction = async () => {
    if (++calls === 1) {
      entered.resolve();
      await gate.promise;
    }
  };
  const first = f.controller.setPreferences({ rangeDays: 5 });
  await entered.promise;
  const latest = f.controller.setPreferences({ rangeDays: 30 });
  gate.resolve();
  await Promise.all([first, latest]);
  assert.equal(f.controller.getSnapshot().preferences.rangeDays, 30);
  assert.ok(!f.log.some((entry) => entry.event === "transactionPut" && entry.key.endsWith(":5")));
});

test("already committed camera copy is retained when a later intent arrives before transaction completion", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  const gate = deferred(),
    entered = deferred();
  let calls = 0;
  f.hooks.afterTransaction = async () => {
    if (++calls === 1) {
      entered.resolve();
      await gate.promise;
    }
  };
  const first = f.controller.setPreferences({ rangeDays: 5 });
  await entered.promise;
  const latest = f.controller.setPreferences({ rangeDays: 30 });
  gate.resolve();
  await Promise.all([first, latest]);
  assert.equal(f.controller.getSnapshot().preferences.rangeDays, 30);
  assert.ok(f.log.some((entry) => entry.event === "transactionPut" && entry.key.endsWith(":5")));
  assert.ok(f.log.some((entry) => entry.event === "transactionPut" && entry.key.endsWith(":30")));
});

test("reload stages ready=false atomically; invalid depth cannot cancel committed TF load", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  const gate = deferred(),
    entered = deferred();
  f.hooks.savePreferences = async () => {
    entered.resolve();
    await gate.promise;
  };
  const tf = f.controller.setTimeframe("1h");
  await entered.promise;
  const staged = f.controller.getSnapshot();
  assert.equal(staged.preferences.timeframe, "1h");
  assert.equal(staged.historyViewReady, false);
  assert.equal(staged.loading, false);
  assert.equal(staged.candles.length, 0);
  assert.equal(f.rangeProps().disabled, true);
  assert.equal(f.requests.length, 0, "no eager history before preferences persistence");
  const invalid = f.controller.setPreferences({ rangeDays: 30 });
  gate.resolve();
  await Promise.all([tf, invalid]);
  assert.equal(f.controller.getSnapshot().preferences.rangeDays, 365);
  assert.equal(f.controller.getSnapshot().historyViewReady, true);
  assert.ok(f.controller.getSnapshot().candles.length > 0);
  assert.deepEqual(
    f.requests.map((request) => request.timeframe),
    ["1h"]
  );
});

test("slow old network does not hold newer routing critical commit", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  const network = deferred(),
    entered = deferred();
  let requests = 0;
  f.hooks.candles = async () => {
    if (++requests === 1) {
      entered.resolve();
      await network.promise;
    }
  };
  const tf = f.controller.setTimeframe("1h");
  await entered.promise;
  await f.controller.setPreferences({ engine: "kline" });
  assert.equal(f.controller.getSnapshot().preferences.timeframe, "1h");
  assert.equal(f.controller.getSnapshot().preferences.engine, "kline");
  network.resolve();
  await tf;
  assert.equal(f.controller.getSnapshot().preferences.engine, "kline");
});

test("nonrouting style/layout updates during depth carry survive fresh remerge", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  const gate = deferred(),
    entered = deferred();
  f.hooks.transaction = async () => {
    entered.resolve();
    await gate.promise;
  };
  const depth = f.controller.setPreferences({ rangeDays: 30 });
  await entered.promise;
  await f.controller.setPreferences({
    sidebarWidth: 430,
    chartSettings: {
      ...f.controller.getSnapshot().preferences.chartSettings,
      legendCollapsed: true
    }
  });
  gate.resolve();
  await depth;
  assert.equal(f.controller.getSnapshot().preferences.rangeDays, 30);
  assert.equal(f.controller.getSnapshot().preferences.sidebarWidth, 430);
  assert.equal(f.controller.getSnapshot().preferences.chartSettings.legendCollapsed, true);
});

test("forceReload retains original validity; invalid fallback fields are not replayed", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  const gate = deferred(),
    entered = deferred();
  let calls = 0,
    valid = true;
  f.hooks.saveView = async () => {
    if (++calls === 1) {
      entered.resolve();
      await gate.promise;
    }
  };
  const stale = f.controller.setPreferences({ symbol: "SBER" }, true, () => valid);
  await entered.promise;
  valid = false;
  const tf = f.controller.setTimeframe("1h");
  gate.resolve();
  await Promise.all([stale, tf]);
  assert.equal(f.controller.getSnapshot().preferences.symbol, "GAZP");
  assert.equal(f.controller.getSnapshot().preferences.timeframe, "1h");
  const before = f.requests.length;
  await f.controller.setPreferences({}, true);
  assert.equal(
    f.requests.length,
    before + 1,
    "valid forceReload reloads even unchanged preferences"
  );
});

for (const mode of ["owner", "import", "revision", "client-without-update", "dispose"]) {
  test(`pending intent cannot cross sticky ${mode} scope boundary`, async (t) => {
    const f = await routingFixture();
    t.after(() => f.close());
    const gate = deferred(),
      entered = deferred();
    let calls = 0;
    f.hooks.saveView = async () => {
      if (++calls === 1) {
        entered.resolve();
        await gate.promise;
      }
    };
    const tf = f.controller.setTimeframe("1h");
    await entered.promise;
    const initial = f.controller.getSnapshot();
    if (mode === "owner") {
      f.controller.update({ owner: "other" });
      f.controller.update({ owner: initial.owner });
    }
    if (mode === "import") {
      f.controller.update({ importingBackup: true });
      f.controller.update({ importingBackup: false });
    }
    if (mode === "revision") {
      f.controller.update({ chartRevision: initial.chartRevision + 1 });
      f.controller.update({ chartRevision: initial.chartRevision });
    }
    if (mode === "client-without-update") f.controller.session.client = { ...f.client };
    if (mode === "dispose") f.controller.dispose();
    gate.resolve();
    await tf;
    assert.equal(f.controller.getSnapshot().preferences.timeframe, "1d");
    assert.equal(f.preferenceWrites.length, 0);
    assert.equal(f.requests.length, 0);
  });
}

test("storage errors reject their callers without poisoning later routing requests", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  f.hooks.saveView = async () => {
    throw new Error("camera write failed");
  };
  await assert.rejects(f.controller.setTimeframe("1h"), /camera write failed/);
  f.hooks.saveView = undefined;
  await f.controller.setTimeframe("1h");
  assert.equal(f.controller.getSnapshot().preferences.timeframe, "1h");
  assert.equal(f.requests.length, 1);
});

test("invalidated depth cancels only its record, preserving force/sidebar during actual indicator refresh", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  const first = deferred(),
    firstEntered = deferred(),
    second = deferred(),
    secondEntered = deferred(),
    network = deferred(),
    networkEntered = deferred();
  let saves = 0,
    requests = 0;
  f.hooks.saveView = async () => {
    if (++saves === 1) {
      firstEntered.resolve();
      await first.promise;
    } else if (saves === 2) {
      secondEntered.resolve();
      await second.promise;
    }
  };
  f.hooks.candles = async () => {
    if (++requests === 1) {
      networkEntered.resolve();
      await network.promise;
    }
  };
  const before = f.controller.getSnapshot().preferences.indicators.ma;
  const depth = f.controller.setPreferences({ rangeDays: 30 });
  await firstEntered.promise;
  const force = f.controller.setPreferences({ sidebarWidth: 431 }, true);
  first.resolve();
  await secondEntered.promise;
  const refresh = f.controller.toggleIndicator("ma");
  await networkEntered.promise;
  second.resolve();
  await Promise.all([depth, force]);
  assert.equal(f.controller.getSnapshot().preferences.rangeDays, 365);
  assert.equal(f.controller.getSnapshot().preferences.sidebarWidth, 431);
  assert.equal(f.controller.getSnapshot().preferences.indicators.ma, !before);
  assert.equal(
    f.preferenceWrites.length,
    2,
    "indicator write plus independently valid force/sidebar write"
  );
  network.resolve();
  await refresh;
});

test("transient loading bounce does not rearm a rejected atomic depth/style record", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  const first = deferred(),
    firstEntered = deferred(),
    second = deferred(),
    secondEntered = deferred();
  let saves = 0;
  f.hooks.saveView = async () => {
    if (++saves === 1) {
      firstEntered.resolve();
      await first.promise;
    } else if (saves === 2) {
      secondEntered.resolve();
      await second.promise;
    }
  };
  const original = f.controller.getSnapshot().preferences.sidebarWidth;
  const depth = f.controller.setPreferences({ rangeDays: 30, sidebarWidth: 439 });
  await firstEntered.promise;
  const force = f.controller.setPreferences({}, true);
  first.resolve();
  await secondEntered.promise;
  f.hooks.candles = async (_symbol, _timeframe, range) => {
    const day = 86400000,
      today = Math.floor(Date.now() / day) * day;
    return {
      candles: Array.from({ length: 2001 }, (_, i) => ({
        timestamp: today - (2000 - i) * day,
        open: 10,
        high: 12,
        low: 9,
        close: 11,
        volume: 10
      })).filter((bar) => bar.timestamp >= range.from && bar.timestamp <= range.to),
      cached: true,
      requests: 0
    };
  };
  await f.controller.loadHistory(true);
  assert.equal(f.controller.getSnapshot().loading, false);
  assert.equal(f.controller.getSnapshot().historyViewReady, true);
  second.resolve();
  await Promise.all([depth, force]);
  assert.equal(f.controller.getSnapshot().preferences.rangeDays, 365);
  assert.equal(f.controller.getSnapshot().preferences.sidebarWidth, original);
  assert.equal(f.preferenceWrites.length, 1);
});

test("camera carry failure cancels depth only and keeps a separately valid forced preference", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  const gate = deferred(),
    entered = deferred();
  let transactions = 0;
  f.hooks.transaction = async () => {
    if (++transactions === 1) {
      entered.resolve();
      await gate.promise;
    }
  };
  const depth = f.controller.setPreferences({ rangeDays: 30 });
  await entered.promise;
  const force = f.controller.setPreferences({ sidebarWidth: 433 }, true);
  f.controller.chart.retired = true;
  gate.resolve();
  await Promise.all([depth, force]);
  assert.equal(f.controller.getSnapshot().preferences.rangeDays, 365);
  assert.equal(f.controller.getSnapshot().preferences.sidebarWidth, 433);
  assert.equal(f.preferenceWrites.length, 1);
  assert.ok(!f.log.some((entry) => entry.event === "transactionPut" && entry.key.endsWith(":30")));
});

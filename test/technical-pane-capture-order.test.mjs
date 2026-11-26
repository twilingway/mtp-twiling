import test from "node:test";
import assert from "node:assert/strict";
import { nativeFixture } from "./native-technical-fixture.mjs";
import {
  load,
  make,
  actions,
  model,
  capture,
  geometry,
  panes,
  preferences,
  metrics,
  controller,
  tick
} from "./technical-pane-capture-order-fixture.mjs";
const order = (layout) => layout.map((item) => item.paneId);

for (const engine of ["lightweight", "kline"])
  test(`${engine}: real separator callback→persist→reconcile keeps untouched pane order and resized ratios`, async (t) => {
    const instances = panes(),
      c = controller(instances, [], engine === "lightweight" ? "tradingview" : "kline"),
      tasks = [],
      captured = [],
      f = nativeFixture(engine, [], {
        onTechnicalPaneLayout(layout) {
          captured.push(structuredClone(layout));
          tasks.push(actions.persistTechnicalPaneLayout(c, layout, () => true));
        }
      });
    t.after(() => f.adapter.destroy());
    f.container.clientHeight = 952;
    f.resize();
    f.adapter.updateTechnicalIndicators(instances, []);
    f.ready();
    const before = f.adapter.technicalPaneMetrics(),
      camera = f.camera(),
      writes = f.primaryWrites(),
      expectedKeys = ["price", "pane:size1", "pane:size2", "pane:size3", "pane:size4"];
    assert.deepEqual(
      before.map((p) => p.key),
      expectedKeys
    );
    if (engine === "kline")
      assert.deepEqual(
        before.map((p) => p.height),
        [258, 165, 166, 165, 166]
      );
    const boundary = before[3].top + 10;
    f.container.dispatch("pointerdown", { clientY: boundary });
    if (engine === "lightweight") {
      f.panes[2].setHeight(before[2].height + 56);
      f.panes[3].setHeight(before[3].height - 56);
    } else {
      f.native.setPaneOptions({ id: "technical:size2", height: before[2].height + 56 });
      f.native.setPaneOptions({ id: "technical:size3", height: before[3].height - 56 });
    }
    const after = f.adapter.technicalPaneMetrics(),
      total = after.reduce((sum, p) => sum + p.height, 0);
    f.window.dispatch("pointerup", { clientY: boundary + 56 });
    f.ready();
    await Promise.all(tasks);
    assert.equal(captured.length, 1);
    assert.deepEqual(order(captured[0]), ["size1", "size2", "size3", "size4"]);
    const saved = c.getSnapshot().preferences.technicalPaneLayout;
    assert.deepEqual(saved, captured[0]);
    assert.equal(c.writes.length, 1);
    assert.equal(saved[0].heightRatio, 0.18);
    assert.equal(saved[3].heightRatio, 0.18);
    assert.equal(saved[1].heightRatio, after[2].height / total);
    assert.equal(saved[2].heightRatio, after[3].height / total);
    f.adapter.updateTechnicalIndicators(instances, saved);
    f.ready();
    assert.deepEqual(
      f.adapter.technicalPaneMetrics().map((p) => p.key),
      expectedKeys
    );
    for (const key of ["pane:size2", "pane:size3"]) {
      const actual = f.adapter.technicalPaneMetrics().find((p) => p.key === key).height,
        expected = after.find((p) => p.key === key).height;
      assert.ok(Math.abs(actual - expected) < 1e-8);
    }
    assert.deepEqual(f.camera(), camera);
    assert.equal(f.primaryWrites(), writes);
    const json = JSON.parse(
      JSON.stringify({
        application: "personal-terminal",
        schemaVersion: 1,
        layout: c.getSnapshot().preferences,
        drawings: [],
        images: []
      })
    );
    assert.deepEqual(
      load("model/backup-format.js").validateBackup(json).layout.technicalPaneLayout,
      saved
    );
    assert.deepEqual(
      load("services/drive/backup.js").sanitizeDriveBackup(json).layout.technicalPaneLayout,
      saved
    );
  });

test("capture follows actual native top, keeps untouched saved ratios/collapse and never persists their viewport normalization", () => {
  const ids = ["size3", "size1", "size4", "size2"],
    before = metrics(ids, [30, 120, 80, 170], 300),
    after = metrics(ids, [30, 140, 60, 170], 300),
    saved = [
      { paneId: "size2", heightRatio: 0.67, collapsed: false },
      { paneId: "size3", heightRatio: 0.43, collapsed: true }
    ];
  // KLine metrics may be listed in model order; native top is the authoritative measured order.
  const result = capture(saved, [...before].reverse(), [
    after[3],
    after[0],
    after[4],
    after[1],
    after[2]
  ]);
  assert.deepEqual(order(result), ids);
  assert.deepEqual(result[0], saved[1]);
  assert.deepEqual(result[3], saved[0]);
  assert.equal(result[1].heightRatio, 140 / 700);
  assert.equal(result[2].heightRatio, 60 / 700);
  assert.equal(model.isTechnicalPaneLayout(result), true);
  assert.deepEqual(order(saved), ["size2", "size3"]);
  assert.equal(capture(saved, before, before), null);
});

test("writer honors full captured order over old sparse order and filters removed IDs without dropping fresh active prefs", async () => {
  const current = panes(["size1", "size2", "size3", "size4", "new"]),
    prior = [
      ...preferences(["size2", "size3"], 0.2),
      ...preferences(["removed"], 0.4),
      ...preferences(["new"], 0.31)
    ],
    c = controller(current, prior),
    captured = preferences(["size4", "removed", "size1", "size2", "size3"]);
  captured[0].heightRatio = 0.25;
  await actions.persistTechnicalPaneLayout(c, captured, () => true);
  const saved = c.getSnapshot().preferences.technicalPaneLayout;
  assert.deepEqual(order(saved), ["size4", "size1", "size2", "size3", "new"]);
  assert.equal(saved.at(-1).heightRatio, 0.31);
  assert.deepEqual(
    model.technicalIndicatorGroups(current, saved).map((g) => g.key),
    order(saved).map((id) => `pane:${id}`)
  );
});

test("hidden/collapsed/stacked panes keep stable IDs and only resized ratios; subsequent pane move/removal cannot resurrect stale captured keys", async () => {
  const first = panes(),
    instances = [
      { ...first[0], visible: false },
      first[1],
      first[2],
      first[3],
      make("atr", "stacked", { pane: { kind: "pane", id: "size2" }, order: 10 })
    ],
    layout = [
      { paneId: "size1", heightRatio: 0.27, collapsed: true },
      ...preferences(["size2", "size3", "size4"], 0.15)
    ],
    before = metrics(["size1", "size2", "size3", "size4"], [30, 150, 150, 150], 400),
    after = metrics(["size1", "size2", "size3", "size4"], [30, 180, 120, 150], 400),
    snapshot = capture(layout, before, after),
    c = controller(instances, layout);
  assert.equal(snapshot[0].collapsed, true);
  assert.equal(snapshot[0].heightRatio, 0.27);
  assert.equal(snapshot[3].heightRatio, 0.15);
  await actions.persistTechnicalPaneLayout(c, snapshot, () => true);
  const groups = model.technicalIndicatorGroups(
    instances,
    c.getSnapshot().preferences.technicalPaneLayout
  );
  assert.equal(groups.length, 4);
  assert.equal(groups[1].instances.length, 2);
  assert.equal(groups[0].instances[0].visible, false);
  assert.equal(geometry(1000, groups)[1].height, 30);
  await actions.updateTechnicalIndicator(c, "size4", (item) => ({
    ...item,
    pane: { kind: "pane", id: "size2" }
  }));
  await actions.updateTechnicalIndicator(c, "size3", () => null);
  await actions.persistTechnicalPaneLayout(c, snapshot, () => true);
  assert.deepEqual(order(c.getSnapshot().preferences.technicalPaneLayout), ["size1", "size2"]);
  assert.equal(
    model.technicalIndicatorGroups(
      c.getSnapshot().preferences.technicalIndicators,
      c.getSnapshot().preferences.technicalPaneLayout
    )[1].instances.length,
    3
  );
});

test("full100 capture retains untouched defaults and IDs within strict shape while changed gesture uncollapses only resized pane", () => {
  const ids = Array.from({ length: 100 }, (_, i) => `p${i}`),
    before = metrics(ids, [...Array(98).fill(30), 30, 40], 160),
    after = metrics(ids, [...Array(98).fill(30), 40, 30], 160),
    result = capture([{ paneId: "p98", heightRatio: 0.4, collapsed: true }], before, after);
  assert.equal(result.length, 100);
  assert.equal(model.isTechnicalPaneLayout(result), true);
  assert.deepEqual(order(result), ids);
  assert.equal(result[0].heightRatio, 0.18);
  assert.equal(result[98].collapsed, false);
  assert.equal(result[99].heightRatio, 0.05);
});

test("capture persistence retains original guard cancellation on owner/import/session/valid boundaries and releases subscriptions", async () => {
  for (const mutate of [
    (c) => {
      c.update({ owner: "other" });
      c.update({ owner: "one" });
    },
    (c) => {
      c.update({ importingBackup: true });
      c.update({ importingBackup: false });
    },
    (c) => {
      c.sessionKey = () => ({});
    }
  ]) {
    const c = controller();
    let release;
    c.gate = new Promise((resolve) => {
      release = resolve;
    });
    const pending = actions.persistTechnicalPaneLayout(
      c,
      preferences(["size4", "size3", "size2", "size1"]),
      () => true
    );
    await tick();
    mutate(c);
    release();
    await pending;
    assert.equal(c.writes.length, 0);
    assert.equal(c.listeners.size, 0);
  }
  const c = controller();
  await actions.persistTechnicalPaneLayout(c, preferences(["size1"]), () => false);
  assert.equal(c.writes.length, 0);
  assert.equal(c.listeners.size, 0);
});

test("pending capture cannot overwrite a freshly removed or moved pane before storage commits", async () => {
  for (const moved of [false, true]) {
    const c = controller(panes(), preferences(["size1", "size2", "size3", "size4"]));
    let release;
    c.gate = new Promise((resolve) => {
      release = resolve;
    });
    const pending = actions.persistTechnicalPaneLayout(
      c,
      preferences(["size4", "size3", "size2", "size1"]),
      () => true
    );
    await tick();
    const prior = c.getSnapshot().preferences;
    const technicalIndicators = moved
      ? prior.technicalIndicators.map((item) =>
          item.id === "size4" ? { ...item, pane: { kind: "pane", id: "size2" } } : item
        )
      : prior.technicalIndicators.filter((item) => item.id !== "size4");
    const fresh = {
      ...prior,
      technicalIndicators,
      technicalPaneLayout: prior.technicalPaneLayout.filter((item) => item.paneId !== "size4")
    };
    c.update({ preferences: fresh });
    release();
    await pending;
    assert.equal(c.writes.length, 0);
    assert.equal(c.getSnapshot().preferences, fresh);
    assert.equal(c.listeners.size, 0);
  }
});

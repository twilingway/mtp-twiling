import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";
import {
  actions as currentActions,
  captureIntent,
  controller,
  panes,
  preferences,
  metrics,
  model,
  tick
} from "./technical-pane-capture-order-fixture.mjs";

// Optional read-only before proof: run the same regressions against the frozen d5 writer.
const actions = process.argv.includes("--baseline-d5")
  ? createSourceLoader({}, (relative, file) =>
      relative === "screens/terminal/technical-indicator-actions.ts"
        ? execFileSync(
            "git",
            ["show", "d5c306040b45c606de3981b077c631fd67df444e:src/" + relative],
            {
              cwd: fileURLToPath(new URL("../", import.meta.url)),
              encoding: "utf8",
              windowsHide: true
            }
          )
        : readFileSync(file, "utf8")
    )("screens/terminal/technical-indicator-actions.js")
  : currentActions;
const ids = ["size1", "size2", "size3", "size4"],
  order = (layout) => layout.map((item) => item.paneId);

for (const baseline of ["full", "partial", "none"])
  for (const field of ["collapse", "height"])
    test(`previous queued untouched ${field} survives resize with ${baseline} saved layout`, async () => {
      const layout =
          baseline === "full"
            ? preferences(ids)
            : baseline === "partial"
              ? preferences(["size2", "size3"])
              : [],
        instances = panes(),
        c = controller(instances, layout),
        measuredOrder = model
          .technicalIndicatorGroups(instances, layout)
          .map((group) => group.pane.id),
        before = metrics(
          measuredOrder,
          measuredOrder.map((id) => (id === "size2" || id === "size4" ? 166 : 165))
        ),
        after = metrics(
          measuredOrder,
          measuredOrder.map((id) =>
            id === "size2" ? 222 : id === "size3" ? 109 : id === "size4" ? 166 : 165
          )
        ),
        snapshot = captureIntent(layout, before, after),
        untouched = baseline === "full" ? "size1" : "size4";
      assert.deepEqual([...snapshot.context.resizedPaneIds].sort(), ["size2", "size3"]);
      let release;
      c.gate = new Promise((resolve) => {
        release = resolve;
      });
      const earlier =
        field === "collapse"
          ? actions.changeTechnicalPane(c, untouched, true)
          : actions.changeTechnicalPreferences(c, (p) => ({
              technicalPaneLayout: p.technicalPaneLayout.some((entry) => entry.paneId === untouched)
                ? p.technicalPaneLayout.map((entry) =>
                    entry.paneId === untouched ? { ...entry, heightRatio: 0.37 } : entry
                  )
                : [
                    ...p.technicalPaneLayout,
                    { paneId: untouched, heightRatio: 0.37, collapsed: false }
                  ]
            }));
      await tick();
      const pending = actions.persistTechnicalPaneLayout(
        c,
        snapshot.layout,
        () => true,
        snapshot.context
      );
      release();
      await Promise.all([earlier, pending]);
      const saved = c.getSnapshot().preferences.technicalPaneLayout,
        fresh = saved.find((entry) => entry.paneId === untouched);
      assert.equal(c.writes.length, 2);
      assert.equal(
        field === "collapse" ? fresh.collapsed : fresh.heightRatio,
        field === "collapse" ? true : 0.37
      );
      assert.deepEqual(order(saved), measuredOrder, "a newly added override has no reorder intent");
      for (const id of ["size2", "size3"])
        assert.equal(
          saved.find((entry) => entry.paneId === id).heightRatio,
          snapshot.layout.find((entry) => entry.paneId === id).heightRatio
        );
      assert.equal(c.listeners.size, 0);
    });

test("previous queued explicit pane reorder wins over old measured order while touched heights still commit", async () => {
  const layout = preferences(ids),
    c = controller(panes(), layout),
    before = metrics(ids, [165, 166, 165, 166]),
    after = metrics(ids, [165, 222, 109, 166]),
    snapshot = captureIntent(layout, before, after);
  let release;
  c.gate = new Promise((resolve) => {
    release = resolve;
  });
  const earlier = actions.moveTechnicalPane(c, "size1", "size4", "after");
  await tick();
  const pending = actions.persistTechnicalPaneLayout(
    c,
    snapshot.layout,
    () => true,
    snapshot.context
  );
  release();
  await Promise.all([earlier, pending]);
  const saved = c.getSnapshot().preferences.technicalPaneLayout;
  assert.deepEqual(order(saved), ["size2", "size3", "size4", "size1"]);
  assert.equal(saved.find((entry) => entry.paneId === "size2").heightRatio, 222 / 920);
  assert.equal(saved.find((entry) => entry.paneId === "size3").heightRatio, 109 / 920);
});

test("earlier queued new active pane survives full old snapshot with fresh fields and stable order", async () => {
  const layout = preferences(ids),
    c = controller(panes(), layout),
    snapshot = captureIntent(
      layout,
      metrics(ids, [165, 166, 165, 166]),
      metrics(ids, [165, 222, 109, 166])
    );
  let release;
  c.gate = new Promise((resolve) => {
    release = resolve;
  });
  const earlier = actions.changeTechnicalPreferences(c, (p) => ({
    technicalIndicators: [...p.technicalIndicators, { ...panes(["new"])[0], order: 8 }],
    technicalPaneLayout: [
      ...p.technicalPaneLayout,
      { paneId: "new", heightRatio: 0.31, collapsed: true }
    ]
  }));
  await tick();
  const pending = actions.persistTechnicalPaneLayout(
    c,
    snapshot.layout,
    () => true,
    snapshot.context
  );
  release();
  await Promise.all([earlier, pending]);
  const saved = c.getSnapshot().preferences.technicalPaneLayout;
  assert.deepEqual(order(saved), [...ids, "new"]);
  assert.deepEqual(saved.at(-1), { paneId: "new", heightRatio: 0.31, collapsed: true });
});

test("legacy3arg partial geometry callers preserve fresh full groups order and untouched fields", async () => {
  const layout = preferences(["size3", "size1", "size4", "size2"]),
    c = controller(panes(), layout);
  layout[1].collapsed = true;
  layout[1].heightRatio = 0.37;
  await actions.persistTechnicalPaneLayout(
    c,
    [{ paneId: "size2", heightRatio: 0.24, collapsed: false }],
    () => true
  );
  const saved = c.getSnapshot().preferences.technicalPaneLayout;
  assert.deepEqual(order(saved), order(layout));
  assert.equal(saved[1].heightRatio, 0.37);
  assert.equal(saved[1].collapsed, true);
});

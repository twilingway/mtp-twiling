import test from "node:test";
import assert from "node:assert/strict";
import { sourceModules, row, header } from "./helpers/watchlist-sections.mjs";

const load = sourceModules(),
  model = load("model/watchlist-sections.js"),
  { changeWatchlistSections: change } = load("model/watchlist-sections-actions.js"),
  { watchlistGroups } = load("model/watchlist-sections-view.js"),
  key = model.watchlistEntryKey;
const labels = (ledger) =>
  ledger.entries.map((entry) =>
    entry.kind === "section" ? `[${entry.title}]` : `${entry.symbol}:${entry.uid}`
  );
function fixture() {
  const rows = [row("A"), row("B"), row("C"), row("D"), row("E")];
  return {
    rows,
    ledger: model.reconcileWatchlistSections(rows),
    refs: model.watchlistReferences(rows)
  };
}

test("manual ledger: contextual header splits at row; empty sections persist; delete releases members to top level", () => {
  const { rows, refs, ledger } = fixture();
  let next = change(ledger, { kind: "insert", header: header("last"), before: key(refs[3]) });
  next = change(next, { kind: "insert", header: header("middle"), before: key(refs[1]) });
  assert.deepEqual(labels(next), [
    "A:uid-A",
    "[middle]",
    "B:uid-B",
    "C:uid-C",
    "[last]",
    "D:uid-D",
    "E:uid-E"
  ]);
  next = change(next, { kind: "insert", header: header("empty"), before: null });
  assert.deepEqual(model.reconcileWatchlistSections(rows, next), next);
  next = change(next, { kind: "rename", id: "section-middle", title: "Акции / Stocks" });
  next = change(next, { kind: "collapse", id: "section-middle" });
  assert.equal(next.entries[1].collapsed, true);
  assert.deepEqual(
    model.orderedWatchlistRows(rows, next, false).map((r) => r.symbol),
    ["A", "D", "E"]
  );
  next = change(next, { kind: "delete", id: "section-middle" });
  assert.deepEqual(labels(next), [
    "A:uid-A",
    "B:uid-B",
    "C:uid-C",
    "[last]",
    "D:uid-D",
    "E:uid-E",
    "[empty]"
  ]);
  assert.deepEqual(model.orderedWatchlistRows(rows, next), rows);
});

test("delete a non-first section never adopts members into preceding section", () => {
  const { refs, ledger } = fixture();
  let next = change(ledger, { kind: "insert", header: header("one"), before: key(refs[1]) });
  next = change(next, { kind: "insert", header: header("two"), before: key(refs[3]) });
  next = change(next, { kind: "delete", id: "section-two" });
  assert.deepEqual(labels(next), ["A:uid-A", "D:uid-D", "E:uid-E", "[one]", "B:uid-B", "C:uid-C"]);
});

test("instrument drag before/after boundary, keyboard steps, and mobile assignment cross sections without losing rows", () => {
  const { rows, refs, ledger } = fixture();
  let next = change(ledger, { kind: "insert", header: header("one"), before: key(refs[1]) });
  next = change(next, { kind: "insert", header: header("two"), before: key(refs[3]) });
  next = change(next, {
    kind: "move",
    source: key(refs[0]),
    target: "section:section-two",
    placement: "after"
  });
  assert.deepEqual(labels(next), [
    "[one]",
    "B:uid-B",
    "C:uid-C",
    "[two]",
    "A:uid-A",
    "D:uid-D",
    "E:uid-E"
  ]);
  next = change(next, { kind: "step", source: key(refs[0]), direction: -1 });
  assert.deepEqual(labels(next), [
    "[one]",
    "B:uid-B",
    "C:uid-C",
    "A:uid-A",
    "[two]",
    "D:uid-D",
    "E:uid-E"
  ]);
  next = change(next, { kind: "assign", source: key(refs[2]), section: null });
  next = change(next, { kind: "assign", source: key(refs[4]), section: "section-one" });
  assert.deepEqual(labels(next), [
    "C:uid-C",
    "[one]",
    "B:uid-B",
    "A:uid-A",
    "E:uid-E",
    "[two]",
    "D:uid-D"
  ]);
  assert.equal(model.orderedWatchlistRows(rows, next).length, rows.length);
  assert.equal(new Set(model.orderedWatchlistRows(rows, next)).size, rows.length);
});

test("collapsed header drag moves all hidden members; invalid/self/stale operations are no-ops", () => {
  const { rows, refs, ledger } = fixture();
  let next = change(ledger, { kind: "insert", header: header("one"), before: key(refs[1]) });
  next = change(next, { kind: "insert", header: header("two"), before: key(refs[3]) });
  next = change(next, { kind: "collapse", id: "section-two" });
  assert.equal(
    change(next, {
      kind: "move",
      source: "section:section-two",
      target: key(refs[4]),
      placement: "before"
    }),
    null
  );
  next = change(next, {
    kind: "move",
    source: "section:section-two",
    target: "section:section-one",
    placement: "before"
  });
  assert.deepEqual(labels(next), [
    "A:uid-A",
    "[two]",
    "D:uid-D",
    "E:uid-E",
    "[one]",
    "B:uid-B",
    "C:uid-C"
  ]);
  assert.equal(next.entries[1].collapsed, true);
  assert.deepEqual(
    model.orderedWatchlistRows(rows, next, false).map((r) => r.symbol),
    ["A", "B", "C"]
  );
  for (const action of [
    { kind: "rename", id: "section-missing", title: "title" },
    { kind: "rename", id: "section-one", title: "<script>" },
    { kind: "move", source: key(refs[0]), target: key(refs[0]), placement: "after" },
    { kind: "assign", source: key(refs[0]), section: "section-foreign" }
  ])
    assert.equal(change(next, action), null);
});

test("all instrument insertions retain an exact permutation and leave canonical quote objects untouched", () => {
  const { rows, refs, ledger } = fixture();
  const original = JSON.stringify(rows);
  const seeded = change(ledger, { kind: "insert", header: header("one"), before: key(refs[2]) });
  for (const source of refs)
    for (const target of seeded.entries)
      for (const placement of ["before", "after"]) {
        const result = change(seeded, {
          kind: "move",
          source: key(source),
          target: key(target),
          placement
        });
        if (!result) continue;
        assert.equal(model.isWatchlistSections(result), true);
        assert.deepEqual(new Set(model.orderedWatchlistRows(rows, result)), new Set(rows));
        assert.equal(model.orderedWatchlistRows(rows, result).length, rows.length);
      }
  assert.equal(JSON.stringify(rows), original);
});

test("reconcile distinguishes UID/symbol/occurrence, removes foreign refs, retains empty headers and appends new live rows", () => {
  const rows = [row("SAME", "one"), row("SAME", "two"), row("SAME", "one"), row("OLD", null)];
  const refs = model.watchlistReferences(rows);
  assert.equal(new Set(refs.map(key)).size, 4);
  const previous = {
    version: 1,
    entries: [refs[1], header("empty"), refs[2], refs[0], refs[3], { ...refs[0], uid: "foreign" }]
  };
  const added = row("NEW", "new");
  const next = model.reconcileWatchlistSections([rows[0], rows[1], rows[2], added], previous);
  assert.deepEqual(model.orderedWatchlistRows([rows[0], rows[1], rows[2], added], next), [
    rows[1],
    rows[2],
    rows[0],
    added
  ]);
  assert.equal(next.entries[1].kind, "section");
  assert.deepEqual(model.orderedWatchlistRows(rows), rows);
});

test("group sorting/filtering uses real row references and leaves membership and hidden rows unchanged", () => {
  const { rows, refs, ledger } = fixture();
  let next = change(ledger, { kind: "insert", header: header("one"), before: key(refs[2]) });
  next = change(next, { kind: "insert", header: header("empty"), before: null });
  const serialized = JSON.stringify(next);
  const groups = watchlistGroups(rows, next, (r) => r.symbol !== "D", "symbol", -1);
  assert.deepEqual(
    groups.map((g) => g.rows.map((r) => r.row.symbol)),
    [["B", "A"], ["E", "C"], []]
  );
  assert.equal(groups[1].rows[0].position.index, 4);
  assert.equal(groups[1].rows[0].row, rows[4]);
  assert.equal(JSON.stringify(next), serialized);
  assert.equal(model.orderedWatchlistRows(rows, next).length, 5);
});

test("moving any header preserves every section membership and never captures top-level instruments", () => {
  const { rows, refs, ledger } = fixture();
  let seeded = change(ledger, { kind: "insert", header: header("one"), before: key(refs[2]) });
  seeded = change(seeded, { kind: "insert", header: header("two"), before: key(refs[4]) });
  seeded = change(seeded, { kind: "insert", header: header("empty"), before: null });
  const memberships = (value) =>
    Object.fromEntries(
      watchlistGroups(rows, value).map((group) => [
        group.section?.id ?? "top",
        group.rows.map((display) => display.key)
      ])
    );
  const original = memberships(seeded);
  for (const source of seeded.entries.filter((entry) => entry.kind === "section")) {
    for (const target of seeded.entries)
      for (const placement of ["before", "after"]) {
        const result = change(seeded, {
          kind: "move",
          source: key(source),
          target: key(target),
          placement
        });
        if (result) assert.deepEqual(memberships(result), original);
      }
    for (const direction of [-1, 1]) {
      const result = change(seeded, { kind: "step", source: key(source), direction });
      if (result) assert.deepEqual(memberships(result), original);
    }
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { controllerFixture, deferred, row, header } from "./helpers/watchlist-sections.mjs";

function removalClient(f) {
  let rows = [...f.rows];
  const client = {
    owner: "profile-A",
    flush: async () => {},
    removeInstrument: async (reference) => {
      rows = rows.filter((r) => r.uid !== reference.uid);
    },
    snapshot: () => ({ rows, profileKey: "profile-A", authenticated: true, marketReady: true })
  };
  f.controller.session.client = client;
  f.controller.flush = async () => {};
  f.controller.session.applyBankState = (snapshot) => f.controller.update({ rows: snapshot.rows });
  return client;
}

test("remove-selected fallback waiting on saveView cannot overwrite a completed import on the same owner/client", async () => {
  const f = controllerFixture(),
    entered = deferred(),
    gate = deferred();
  removalClient(f);
  f.controller.saveView = async () => {
    entered.resolve();
    await gate.promise;
  };
  const removing = f.controller.removeInstrument(f.rows[0]);
  await entered.promise;
  f.controller.update({ importingBackup: true });
  const imported = {
    ...f.controller.getSnapshot().preferences,
    symbol: "THREE",
    instrumentUid: "uid-THREE",
    watchlistSections: {
      version: 1,
      entries: [header("imported"), ...f.model.watchlistReferences([f.rows[2], f.rows[1]])]
    }
  };
  f.controller.update({ preferences: imported, chartRevision: 1, importingBackup: false });
  gate.resolve();
  await removing;
  assert.equal(f.controller.getSnapshot().preferences, imported);
  assert.equal(await f.db.get("preferences", "layout:profile-A"), undefined);
  assert.equal(f.reloads(), 0);
});

test("canonical reorder waiting on a layout write rejects owner/profile/import bounces before client mutation", async () => {
  for (const boundary of ["owner", "profile", "import"]) {
    const f = controllerFixture(),
      entered = deferred(),
      gate = deferred(),
      writes = [];
    let reorders = 0;
    const client = {
      owner: "profile-A",
      reorderWatchlist: async () => {
        reorders++;
        return true;
      },
      snapshot: () => ({
        rows: f.rows,
        profileKey: "profile-A",
        marketReady: true,
        authenticated: true
      })
    };
    f.controller.session.client = client;
    f.db.put = async (store, record) => {
      writes.push({ store, record: structuredClone(record) });
      entered.resolve();
      await gate.promise;
    };
    const position = (index) => ({ index, uid: f.rows[index].uid, symbol: f.rows[index].symbol });
    const reordering = f.controller.reorderWatchlist(
      { source: position(2), target: position(0), placement: "before" },
      "profile-A"
    );
    await entered.promise;
    if (boundary === "owner") {
      f.controller.update({ owner: "profile-B" });
      f.controller.update({ owner: "profile-A" });
    }
    if (boundary === "profile") {
      f.controller.update({ profileTransition: true });
      f.controller.update({ profileTransition: false });
    }
    if (boundary === "import") {
      f.controller.update({ importingBackup: true });
      f.controller.update({ importingBackup: false });
    }
    gate.resolve();
    assert.equal(await reordering, false, boundary);
    assert.equal(reorders, 0, boundary);
    assert.ok(writes.every((write) => write.record.owner === "profile-A"));
  }
});

test("remove waits reject profile/import/owner boundaries before mutation and before publishing a stale client snapshot", async () => {
  for (const phase of ["flush", "client"])
    for (const boundary of ["owner", "profile", "import"]) {
      const f = controllerFixture(),
        entered = deferred(),
        gate = deferred();
      const client = removalClient(f);
      let removals = 0;
      const remove = client.removeInstrument;
      client.removeInstrument = async (reference) => {
        removals++;
        if (phase === "client") {
          entered.resolve();
          await gate.promise;
        }
        await remove(reference);
      };
      if (phase === "flush")
        f.controller.flush = async () => {
          entered.resolve();
          await gate.promise;
        };
      const removing = f.controller.removeInstrument(f.rows[0]);
      await entered.promise;
      const replacement = [row("IMPORTED")],
        preferences = {
          ...f.controller.getSnapshot().preferences,
          symbol: "IMPORTED",
          instrumentUid: "uid-IMPORTED"
        };
      if (boundary === "owner")
        f.controller.update({ owner: "profile-B", rows: replacement, preferences });
      if (boundary === "profile") {
        f.controller.update({ profileTransition: true });
        f.controller.update({ profileTransition: false, rows: replacement, preferences });
      }
      if (boundary === "import") {
        f.controller.update({ importingBackup: true });
        f.controller.update({
          importingBackup: false,
          chartRevision: 1,
          rows: replacement,
          preferences
        });
      }
      gate.resolve();
      await removing;
      assert.equal(f.controller.getSnapshot().rows, replacement, `${phase}/${boundary}`);
      assert.equal(f.controller.getSnapshot().preferences, preferences, `${phase}/${boundary}`);
      assert.equal(removals, phase === "client" ? 1 : 0);
      assert.equal(await f.db.get("preferences", "layout:profile-B"), undefined);
      assert.equal(await f.db.get("preferences", "layout:profile-A"), undefined);
    }
});

test("removing the first identical UID/symbol occurrence through actual MarketClient never duplicates surviving rows or refs", async () => {
  const f = controllerFixture(),
    { MarketClient } = f.load("services/market-client.js"),
    rows = [
      row("SAME", "shared"),
      { ...row("SAME", "shared"), name: "second occurrence" },
      row("OTHER")
    ],
    snapshots = [],
    cache = {
      saveWatchlistSnapshot: async (owner, values) => snapshots.push({ owner, values: [...values] })
    },
    client = new MarketClient(null, "Test", cache, { owner: "profile-A", online: () => false });
  client.values = rows;
  const refs = f.model.watchlistReferences(rows),
    original = { version: 1, entries: [header("one"), refs[1], header("two"), refs[0], refs[2]] };
  await client.removeInstrument({ uid: "shared", symbol: "SAME" });
  assert.equal(client.rows.length, 2);
  assert.equal(client.rows[0], rows[1]);
  let reconciled = f.model.reconcileWatchlistSections(client.rows, original);
  let ordered = f.model.orderedWatchlistRows(client.rows, original);
  assert.equal(ordered.length, 2);
  assert.equal(ordered.filter((r) => r.uid === "shared").length, 1);
  assert.equal(
    new Set(reconciled.entries.map(f.model.watchlistEntryKey)).size,
    reconciled.entries.length
  );
  await client.removeInstrument({ uid: "shared", symbol: "SAME" });
  reconciled = f.model.reconcileWatchlistSections(client.rows, original);
  ordered = f.model.orderedWatchlistRows(client.rows, original);
  assert.deepEqual(ordered, [rows[2]]);
  assert.equal(reconciled.entries.filter((entry) => entry.kind === "section").length, 2);
  assert.equal(reconciled.entries.filter((entry) => entry.kind === "instrument").length, 1);
  assert.deepEqual(
    snapshots.map((snapshot) => snapshot.values.length),
    [2, 1]
  );
});

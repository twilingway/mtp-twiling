import test from "node:test";
import assert from "node:assert/strict";
import {
  sourceModules,
  row,
  header,
  backup,
  deferred,
  controllerFixture
} from "./helpers/watchlist-sections.mjs";
import { createPortableFixture } from "./helpers/portable-database.mjs";

const load = sourceModules(),
  model = load("model/watchlist-sections.js"),
  { isProfilePreferences, validateBackup } = load("model/backup-format.js"),
  { sanitizeDriveBackup, prepareDriveBackup, restoreDriveBackup } = load(
    "services/drive/backup.js"
  );
const ledger = () => ({
  version: 1,
  entries: [
    header("one"),
    ...model.watchlistReferences([row("ONE"), row("SAME", "two")]),
    header("empty")
  ]
});

test("strict metadata validators reject accessors/prototypes/unknown keys/duplicate refs/injection/limits without executing getters", () => {
  assert.equal(model.isWatchlistSections(ledger()), true);
  assert.equal(isProfilePreferences({}), true);
  assert.equal(isProfilePreferences({ watchlistSections: ledger() }), true);
  let reads = 0;
  const accessor = Object.defineProperty({}, "entries", {
    enumerable: true,
    get() {
      reads++;
      return [];
    }
  });
  accessor.version = 1;
  const entryAccessor = { ...header("one") };
  Object.defineProperty(entryAccessor, "title", {
    enumerable: true,
    get() {
      reads++;
      return "unsafe";
    }
  });
  const arrayAccessor = [header("one")];
  Object.defineProperty(arrayAccessor, "0", {
    enumerable: true,
    get() {
      reads++;
      return header("one");
    }
  });
  const invalid = [
    null,
    [],
    { version: 2, entries: [] },
    accessor,
    Object.create(ledger()),
    { version: 1, entries: [Object.create(header("one"))] },
    { ...ledger(), token: "invalid" },
    { version: 1, entries: [entryAccessor] },
    { version: 1, entries: arrayAccessor },
    { version: 1, entries: [header("one"), header("one")] },
    {
      version: 1,
      entries: [
        model.watchlistReferences([row("ONE")])[0],
        model.watchlistReferences([row("ONE")])[0]
      ]
    },
    { version: 1, entries: [header("one", "<img onerror=bad>")] },
    { version: 1, entries: [header("one", "bad\nname")] },
    { version: 1, entries: [header("one", "x".repeat(81))] },
    { version: 1, entries: [{ ...header("one"), id: "__proto__" }] },
    { version: 1, entries: [{ ...header("one"), owner: "other" }] },
    {
      version: 1,
      entries: [{ kind: "instrument", uid: "token:bad key", symbol: "ONE", occurrence: 0 }]
    },
    { version: 1, entries: [{ kind: "instrument", uid: null, symbol: "ONE", occurrence: -1 }] },
    {
      version: 1,
      entries: [
        JSON.parse(
          '{"kind":"section","id":"section-one","title":"One","collapsed":false,"__proto__":{}}'
        )
      ]
    },
    { version: 1, entries: Array.from({ length: 201 }, (_, i) => header(String(i))) },
    {
      version: 1,
      entries: Array.from({ length: 10001 }, (_, i) => ({
        kind: "instrument",
        uid: `id-${i}`,
        symbol: "ONE",
        occurrence: 0
      }))
    }
  ];
  for (const value of invalid) {
    assert.equal(model.isWatchlistSections(value), false);
    assert.equal(isProfilePreferences({ watchlistSections: value }), false);
    assert.throws(() => validateBackup(backup({ watchlistSections: value })));
    assert.throws(() => sanitizeDriveBackup(backup({ watchlistSections: value })));
  }
  const layoutAccessor = Object.defineProperty({}, "watchlistSections", {
    enumerable: true,
    get() {
      reads++;
      return ledger();
    }
  });
  assert.equal(isProfilePreferences(layoutAccessor), false);
  assert.throws(() => validateBackup(backup(layoutAccessor)));
  assert.throws(() => sanitizeDriveBackup(backup(layoutAccessor)));
  assert.equal(reads, 0);
});

test("actual storage transactions + manual JSON backup and Drive v2 payload preserve canonical rows and exact display ledger across owners", async () => {
  const f = await createPortableFixture(),
    rows = [row("ONE"), row("SAME", "two")],
    sections = {
      version: 1,
      entries: [
        model.watchlistReferences(rows)[1],
        header("one"),
        model.watchlistReferences(rows)[0],
        header("empty")
      ]
    },
    layout = { symbol: "ONE", instrumentUid: "uid-ONE", watchlistSections: sections };
  await f.storage.savePreferences("profile-A", layout);
  await f.storage.saveWatchlistSnapshot("profile-A", rows);
  await f.storage.savePreferences("profile-B", { symbol: "UNCHANGED" });
  const exported = f.json(await f.storage.createBackup("profile-A"));
  assert.deepEqual(exported.layout.watchlistSections, sections);
  assert.deepEqual(
    exported.watchlist.map((r) => r.uid),
    rows.map((r) => r.uid)
  );
  await f.storage.importBackup("profile-C", exported);
  assert.deepEqual((await f.storage.loadPreferences("profile-C")).watchlistSections, sections);
  assert.deepEqual(await f.storage.loadPreferences("profile-B"), { symbol: "UNCHANGED" });
  const portable = sanitizeDriveBackup(exported),
    prepared = await prepareDriveBackup(portable),
    restored = await restoreDriveBackup(
      prepared.payload,
      prepared.images.map((i) => i.body)
    );
  assert.equal(restored.schemaVersion, 2);
  assert.deepEqual(restored.layout.watchlistSections, sections);
  assert.deepEqual(
    model
      .orderedWatchlistRows(restored.watchlist, restored.layout.watchlistSections)
      .map((r) => r.uid),
    ["two", "uid-ONE"]
  );
  const broken = structuredClone(exported);
  broken.layout.watchlistSections.entries[1].title = "<script>";
  const writesBefore = f.database.transactions.length;
  await assert.rejects(f.storage.importBackup("profile-C", broken));
  assert.deepEqual((await f.storage.loadPreferences("profile-C")).watchlistSections, sections);
  assert.ok(f.database.transactions.slice(writesBefore).every((tx) => tx.mode === "readonly"));
});

test("actual controller serializes rapid insert/collapse/rename/move writes without losing selection, quotes, camera or TA prefs", async () => {
  const f = controllerFixture(),
    refs = f.model.watchlistReferences(f.rows),
    key = f.model.watchlistEntryKey,
    gate = deferred(),
    entered = deferred();
  f.controller.saveView = async () => {
    entered.resolve();
    await gate.promise;
  };
  const before = f.controller.getSnapshot(),
    indicators = [{ id: "keep-exact-TA-reference" }];
  f.controller.update({ preferences: { ...before.preferences, technicalIndicators: indicators } });
  const one = f.persist(f.controller, {
    kind: "insert",
    header: header("one"),
    before: key(refs[1])
  });
  await entered.promise;
  const two = f.persist(f.controller, { kind: "collapse", id: "section-one" }),
    three = f.persist(f.controller, { kind: "rename", id: "section-one", title: "Раздел" }),
    four = f.persist(f.controller, {
      kind: "assign",
      source: key(refs[0]),
      section: "section-one"
    });
  gate.resolve();
  assert.deepEqual(await Promise.all([one, two, three, four]), [true, true, true, true]);
  const state = f.controller.getSnapshot(),
    sections = state.preferences.watchlistSections;
  assert.equal(sections.entries[0].title, "Раздел");
  assert.equal(sections.entries[0].collapsed, true);
  assert.deepEqual(f.model.orderedWatchlistRows(f.rows, sections), [
    f.rows[1],
    f.rows[2],
    f.rows[0]
  ]);
  assert.equal(state.preferences.symbol, "ONE");
  assert.equal(state.preferences.instrumentUid, "uid-ONE");
  assert.equal(state.preferences.technicalIndicators, indicators);
  assert.equal(state.rows, f.rows);
  assert.equal(state.candles, before.candles);
  assert.equal(state.drawings, before.drawings);
  assert.equal(f.controller.chart, f.chart);
  assert.equal(f.reloads(), 0);
  assert.deepEqual(
    (await f.db.get("preferences", "layout:profile-A")).value.watchlistSections,
    sections
  );
});

test("actual persistence rejection CAS rolls back only our section field and leaves later unrelated prefs, queue and storage intact", async () => {
  const f = controllerFixture(),
    originalPut = f.db.put,
    entered = deferred(),
    gate = deferred();
  await f
    .load("services/storage.ts")
    .savePreferences("profile-A", f.controller.getSnapshot().preferences);
  f.db.put = async () => {
    entered.resolve();
    await gate.promise;
    throw new Error("storage rejected");
  };
  const pending = f.persist(f.controller, { kind: "insert", header: header("one"), before: null });
  await entered.promise;
  const optimistic = f.controller.getSnapshot();
  assert.equal(optimistic.preferences.watchlistSections.entries.at(-1).title, "one");
  f.controller.update({
    preferences: { ...optimistic.preferences, locale: "en", sidebarWidth: 450 }
  });
  gate.resolve();
  await assert.rejects(pending, /storage rejected/);
  assert.equal(f.controller.getSnapshot().preferences.watchlistSections, undefined);
  assert.equal(f.controller.getSnapshot().preferences.locale, "en");
  assert.equal(f.controller.getSnapshot().preferences.sidebarWidth, 450);
  assert.equal(
    (await f.db.get("preferences", "layout:profile-A")).value.watchlistSections,
    undefined
  );
  f.db.put = originalPut;
  assert.equal(
    await f.persist(f.controller, { kind: "insert", header: header("retry"), before: null }),
    true
  );
});

test("CAS rejection cannot overwrite a newer ledger, another owner or another session", async () => {
  for (const boundary of ["new-ledger", "owner", "session"]) {
    const f = controllerFixture(),
      entered = deferred(),
      gate = deferred();
    f.db.put = async () => {
      entered.resolve();
      await gate.promise;
      throw new Error("rejected");
    };
    const pending = f.persist(f.controller, {
      kind: "insert",
      header: header("one"),
      before: null
    });
    await entered.promise;
    const imported = { version: 1, entries: [header("newer")] };
    if (boundary === "owner") f.controller.update({ owner: "profile-B" });
    if (boundary === "session") f.controller.session.client = { owner: "different-session" };
    f.controller.update({
      preferences: { ...f.controller.getSnapshot().preferences, watchlistSections: imported }
    });
    gate.resolve();
    await assert.rejects(pending, /rejected/);
    assert.equal(f.controller.getSnapshot().preferences.watchlistSections, imported);
    if (boundary === "owner")
      assert.equal(await f.db.get("preferences", "layout:profile-B"), undefined);
  }
});

test("queued actions are sticky-cancelled across owner/import/profile/route/session bounce while a real controller waits", async () => {
  for (const boundary of [
    "owner",
    "import",
    "profileTransition",
    "route",
    "session",
    "revision",
    "rows",
    "external-ledger"
  ]) {
    const f = controllerFixture(),
      entered = deferred(),
      gate = deferred();
    f.controller.saveView = async () => {
      entered.resolve();
      await gate.promise;
    };
    const first = f.persist(f.controller, { kind: "insert", header: header("one"), before: null });
    await entered.promise;
    const second = f.persist(f.controller, { kind: "insert", header: header("two"), before: null });
    const old = f.controller.getSnapshot();
    if (boundary === "owner") {
      f.controller.update({ owner: "B" });
      f.controller.update({ owner: "profile-A" });
    }
    if (boundary === "import") {
      f.controller.update({ importingBackup: true });
      f.controller.update({ importingBackup: false });
    }
    if (boundary === "profileTransition") {
      f.controller.update({ profileTransition: true });
      f.controller.update({ profileTransition: false });
    }
    if (boundary === "route") {
      f.controller.update({ preferences: { ...old.preferences, instrumentUid: "another" } });
      f.controller.update({ preferences: old.preferences });
    }
    if (boundary === "session") {
      f.controller.session.client = { owner: "other" };
      f.controller.update({ toast: "session changed" });
      f.controller.session.client = null;
    }
    if (boundary === "revision") {
      f.controller.update({ chartRevision: 1 });
      f.controller.update({ chartRevision: 0 });
    }
    if (boundary === "rows") f.controller.update({ rows: [] });
    if (boundary === "external-ledger")
      f.controller.update({ preferences: { ...old.preferences, watchlistSections: ledger() } });
    gate.resolve();
    const result = await Promise.all([first, second]);
    if (["rows", "external-ledger"].includes(boundary)) {
      assert.equal(result[0], false);
      // A separate later queued action may merge a fresh row/ledger state, retaining imported sections.
      assert.equal(result[1], true);
      if (boundary === "external-ledger")
        assert.equal(
          f.controller.getSnapshot().preferences.watchlistSections.entries[0].title,
          "one"
        );
    } else assert.deepEqual(result, [false, false], boundary);
    assert.equal(await f.db.get("preferences", "layout:B"), undefined);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { createGuestFixture } from "./helpers/guest-recovery-database.mjs";

const target = "profile-v2:device",
  journal = "device-workspace-migration:v1";
const record = (id, owner, value) => ({ id, owner, value });
const row = (uid) => ({
  uid,
  symbol: uid.toUpperCase(),
  name: uid,
  price: null,
  previousClose: null
});
function localStore() {
  const values = new Map();
  return {
    values,
    blocked: false,
    get length() {
      if (this.blocked) throw new DOMException("blocked", "SecurityError");
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      if (this.blocked) throw new DOMException("blocked", "SecurityError");
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (this.blocked) throw new DOMException("blocked", "SecurityError");
      values.set(key, value);
    }
  };
}
async function setup(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    local = localStore();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: local });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  });
  const f = await createGuestFixture(),
    api = f.load("services/workspace-identity.ts");
  return { ...f, api, local };
}
const sources = (f) =>
  structuredClone(
    Object.fromEntries(Object.entries(f.database.stores).map(([store, map]) => [store, [...map]]))
  );
const assertSources = (f, before) => {
  for (const [store, entries] of Object.entries(before))
    for (const [id, value] of entries)
      assert.deepEqual(f.database.stores[store].get(id), value, `${store}/${id}`);
};
const prepare = (f, options = {}) =>
  f.api.prepareDeviceWorkspace({ valid: () => true, ...options });

test("atomic COW migration preserves settings, history, cameras, sources and secret read boundaries; ready never reimports", async (t) => {
  const f = await setup(t);
  await f.storage.savePreferences("public", {
    engine: "kline",
    rangeDays: 180,
    chartSettings: { grid: false }
  });
  await f.storage.saveWatchlistSnapshot("public", [row("a")]);
  await f.storage.savePreferences("bank", { engine: "tradingview" });
  await f.storage.saveWatchlistSnapshot("bank", [row("b")]);
  await f.storage.saveHistory(
    "public",
    "a",
    "1d",
    [{ timestamp: 1700000000000, open: 1, high: 2, low: 1, close: 2, volume: 1 }],
    { from: 1, to: 2, fetchedAt: 3 }
  );
  await f.storageDB.put("preferences", {
    id: 'workspace-camera:["public",2,"A:1d:kline:180"]',
    value: { camera: { barSpace: 9, rightOffsetBars: -2 } }
  });
  await f.storageDB.put(
    "preferences",
    record("chart-camera:public:kline", "public", {
      symbol: "A",
      timeframe: "1d",
      camera: { barSpace: 10, rightOffsetBars: -3 }
    })
  );
  f.database.stores.preferences.set("session", { id: "session", value: "private sentinel" });
  f.database.stores.preferences.set("google-auth:bank", {
    id: "google-auth:bank",
    value: "private sentinel"
  });
  f.database.stores.vault.set("device-key", { id: "device-key", key: "private sentinel" });
  const before = sources(f);
  f.database.reads.length = 0;
  const binding = await prepare(f, { preferredOwner: "public" });
  assert.equal(binding.owner, "device");
  assert.equal(binding.primaryOwner, "public");
  assert.deepEqual(
    (await f.storage.loadWatchlist(target)).map((item) => item.uid),
    ["a", "b"]
  );
  assert.equal((await f.storage.loadPreferences(target)).chartSettings.grid, false);
  assert.ok(f.database.stores.preferences.has('workspace-camera:["device",2,"A:1d:kline:180"]'));
  assert.ok(f.database.stores.preferences.has(`chart-camera:${target}:kline`));
  assert.ok([...f.database.stores.history.values()].some((entry) => entry.owner === target));
  assert.ok([...f.database.stores.coverage.values()].some((entry) => entry.owner === target));
  assertSources(f, before);
  assert.ok(f.database.transactions.every((tx) => !tx.names.includes("vault")));
  assert.ok(f.database.reads.every(({ key }) => !["session", "google-auth:bank"].includes(key)));
  await f.storage.saveWatchlistSnapshot(target, []);
  assert.deepEqual(await prepare(f, { preferredOwner: "bank" }), binding);
  assert.deepEqual(await f.storage.loadWatchlist(target), []);
});

test("visible preferred owner wins; ready v2 lineage outranks raw and raw bank history remains available", async (t) => {
  const f = await setup(t);
  await f.storage.savePreferences("public", { rangeDays: 30 });
  await f.storage.savePreferences("bank", { rangeDays: 90 });
  await f.storage.savePreferences("profile-v2:bank", { rangeDays: 180 });
  await f.storageDB.put("preferences", record("v2-profile-ready:bank", "profile-v2:bank", true));
  const binding = await prepare(f, { preferredOwner: "bank" });
  assert.equal(binding.primaryOwner, "bank");
  assert.equal((await f.storage.loadPreferences(target)).rangeDays, 180);
});

test("native commit followed by abort keeps committed stage; blocked storage readers recover each primary pane and new edits durably", async (t) => {
  const f = await setup(t),
    abort = new AbortController();
  f.local.setItem(
    "mtp:workspace-presentation:public",
    JSON.stringify({ layoutId: "4-balanced", flags: { instrument: false } })
  );
  f.local.setItem('mtp:workspace:["public",2]:instrument', "A");
  f.local.setItem(
    'mtp:workspace:["public",2]:preferences',
    JSON.stringify({ engine: "kline", rangeDays: 180, chartSettings: { grid: false } })
  );
  f.local.setItem(
    'mtp:workspace:["public",3]:preferences',
    JSON.stringify({ engine: "tradingview", rangeDays: 30, chartSettings: { grid: true } })
  );
  f.local.setItem(
    'mtp:workspace-grid:["public","4-balanced","desktop"]',
    JSON.stringify({ column: Array(12).fill(50), row: [100, 200] })
  );
  f.database.hooks.afterNativeCommit = (tx) => {
    if (tx.mode === "readwrite" && f.database.stores.preferences.has(journal)) {
      abort.abort();
      f.local.blocked = true;
    }
  };
  assert.equal((await prepare(f, { signal: abort.signal })).owner, "device");
  assert.equal(f.database.stores.preferences.get(journal).phase, "fallback");
  const presentation = f.load("screens/terminal/workspace-presentation.ts"),
    panels = f.load("screens/terminal/workspace-panel-preferences.ts"),
    grid = f.load("screens/terminal/workspace-grid-storage.ts"),
    layouts = f.load("model/chart-workspace-layout.ts");
  assert.equal(presentation.loadWorkspacePresentation("device").layoutId, "4-balanced");
  assert.equal(panels.loadWorkspaceInstrument("device", 2), "A");
  const initial = {
    timeframe: "1d",
    rangeDays: 10,
    engine: "kline",
    chartSettings: {},
    indicators: {}
  };
  assert.equal(panels.loadPanelPreferences("device", 2, initial).rangeDays, 180);
  assert.equal(panels.loadPanelPreferences("device", 3, initial).rangeDays, 30);
  assert.deepEqual(
    grid.readWorkspaceGridSizes(
      'mtp:workspace-grid:["device","4-balanced","desktop"]',
      layouts.chartLayout("4-balanced"),
      false
    ).row,
    [100, 200]
  );
  panels.saveWorkspaceInstrument("device", 2, "B");
  await f.storageDB.flush();
  delete f.database.hooks.afterNativeCommit;
  f.load("services/workspace-identity-local.ts").hydrateDevicePresentation([], () => {});
  await prepare(f);
  assert.equal(panels.loadWorkspaceInstrument("device", 2), "B");
  assert.equal(f.local.values.get('mtp:workspace:["public",2]:instrument'), "A");
});

test("corruption, limits, quota and precommit abort never leave a ready or partial canonical workspace", async (t) => {
  for (const failure of ["corrupt", "limit", "quota", "abort", "valid"]) {
    const f = await setup(t),
      abort = new AbortController();
    let valid = true;
    await f.storage.savePreferences("public", { rangeDays: failure === "corrupt" ? -1 : 180 });
    if (failure === "limit") {
      await f.storage.saveWatchlistSnapshot(
        "public",
        Array.from({ length: 200 }, (_, index) => row(`a${index}`))
      );
      await f.storage.saveWatchlistSnapshot(
        "bank",
        Array.from({ length: 200 }, (_, index) => row(`b${index}`))
      );
    }
    const before = sources(f);
    if (failure === "quota")
      f.database.hooks.beforeWriteComplete = () => {
        throw new DOMException("full", "QuotaExceededError");
      };
    if (["abort", "valid"].includes(failure))
      f.database.hooks.beforeWriteComplete = () => {
        if (failure === "abort") abort.abort();
        else valid = false;
      };
    await assert.rejects(prepare(f, { signal: abort.signal, valid: () => valid }));
    assert.equal(f.database.stores.preferences.has(journal), false, failure);
    assert.ok(
      Object.values(f.database.stores).every(
        (map) => ![...map.values()].some((value) => value.owner === target)
      ),
      failure
    );
    assertSources(f, before);
  }
});

test("two starts share one committed merge and copied guest decision never resurrects abandoned raw data", async (t) => {
  const f = await setup(t);
  await f.storage.savePreferences("public", { rangeDays: 180 });
  await f.storage.savePreferences("guest", { rangeDays: -1 });
  await f.storageDB.put(
    "preferences",
    record("guest-public-adoption:v1", "profile-v2:public", { status: "copied" })
  );
  const results = await Promise.all([prepare(f), prepare(f)]);
  assert.deepEqual(results[0], results[1]);
  assert.equal((await f.storage.loadPreferences(target)).rangeDays, 180);
  assert.equal(f.database.stores.preferences.get("layout:guest").value.rangeDays, -1);
});

test("cloud selection preserves a primary association and pauses ambiguous alternatives without reading auth", async (t) => {
  const f = await setup(t),
    { chooseCloudOwner } = f.load("services/workspace-identity-cloud.ts");
  const association = {
    schemaVersion: 1,
    markerId: "12345678-1234-4123-8123-123456789012",
    deviceId: "12345678-1234-4123-8123-123456789013",
    baseHeads: []
  };
  await f.storageDB.put("preferences", record("drive-v2:bankA", "bankA", association));
  await f.storageDB.put("preferences", record("drive-v2:bankB", "bankB", association));
  const keys = ["drive-v2:bankA", "drive-v2:bankB"];
  assert.equal((await chooseCloudOwner("bankA", keys)).owner, "bankA");
  const ambiguous = await chooseCloudOwner("public", keys);
  assert.equal(ambiguous.owner, "device");
  assert.ok(ambiguous.conflicts.every(({ key }) => key === "ambiguous-associations"));
  assert.deepEqual(f.database.stores.preferences.get("drive-v2:bankA").value, association);
});

test("raw guest is projected without seeding/adoption and its source survives unchanged", async (t) => {
  const f = await setup(t);
  await f.storage.savePreferences("guest", { rangeDays: 180, chartSettings: { grid: false } });
  await f.storage.saveWatchlistSnapshot("guest", [row("a")]);
  const before = sources(f),
    binding = await prepare(f);
  assert.equal(binding.primaryOwner, "guest");
  assert.equal((await f.storage.loadPreferences(target)).rangeDays, 180);
  assert.equal(f.database.stores.preferences.has("guest-public-adoption:v1"), false);
  assert.equal(f.database.stores.preferences.has("v2-profile-ready:guest"), false);
  assertSources(f, before);
});

test("history/coverage combine raw and ready-v2 lineage atomically, deduplicate timestamps and retain primary quotes", async (t) => {
  const f = await setup(t),
    codec = f.load("model/history-codec.ts");
  const time = 1700000000000,
    bar = (timestamp, close) => ({ timestamp, open: 1, high: 10, low: 1, close, volume: 1 });
  await f.storage.savePreferences("profile-v2:bank", { rangeDays: 90 });
  await f.storageDB.put("preferences", record("v2-profile-ready:bank", "profile-v2:bank", true));
  await f.storage.saveHistory("bank", "a", "1d", [bar(time, 2), bar(time + 1000, 3)], {
    from: 1,
    to: 5
  });
  await f.storage.saveHistory("profile-v2:bank", "a", "1d", [bar(time, 8)], { from: 3, to: 9 });
  await f.storage.saveHistory("public", "a", "1d", [bar(time, 4), bar(time + 2000, 5)], {
    from: 7,
    to: 11
  });
  await prepare(f, { preferredOwner: "bank" });
  const history = [...f.database.stores.history.values()].filter((value) => value.owner === target);
  assert.equal(history.length, 1);
  assert.deepEqual(
    codec.decodeCandles(history[0].data).map(({ close }) => close),
    [8, 3, 5]
  );
  const coverage = [...f.database.stores.coverage.values()].find((value) => value.owner === target);
  assert.deepEqual(
    coverage.ranges.map(({ from, to }) => ({ from, to })),
    [{ from: 1, to: 11 }]
  );
});

test("cold selection sees public presentation-only records ahead of a remembered workspace", async (t) => {
  const f = await setup(t);
  await f.storage.savePreferences("bank", { rangeDays: 90 });
  await f.storageDB.put("preferences", { id: "last-profile", value: { owner: "bank" } });
  f.local.setItem('mtp:workspace:["public",2]:instrument', "A");
  assert.equal((await prepare(f)).primaryOwner, "public");
});

test("unknown journal version and malformed presentation reject without rewriting source or declaring ready", async (t) => {
  const f = await setup(t);
  await f.storage.savePreferences("public", { rangeDays: 180 });
  await f.storageDB.put("preferences", { id: journal, version: 2, phase: "future" });
  const before = sources(f);
  await assert.rejects(prepare(f), (error) => error.code === "journal-invalid");
  assertSources(f, before);
  f.database.stores.preferences.delete(journal);
  f.local.setItem('mtp:workspace:["public",2]:preferences', JSON.stringify({ rangeDays: -1 }));
  await assert.rejects(prepare(f), (error) => error.code === "source-invalid");
  assert.equal(f.database.stores.preferences.has(journal), false);
});

test("ancient unbound v1 keys remain untouched and have a safe counted recovery reference", async (t) => {
  const f = await setup(t);
  f.local.setItem("terminal.preferences.v1", "not interpreted here");
  f.local.setItem("terminal.drawings.v1:private-account:1d:AAA", "not interpreted here");
  const binding = await prepare(f);
  assert.ok(
    binding.conflicts.some(
      (entry) =>
        entry.sourceOwner === "legacy-local" &&
        entry.key === "preserved-unbound-v1:2" &&
        entry.recoveryRef === "workspace-unbound-v1"
    )
  );
  assert.equal(JSON.stringify(binding).includes("private-account"), false);
  assert.equal(f.local.getItem("terminal.preferences.v1"), "not interpreted here");
  assert.equal(
    f.local.getItem("terminal.drawings.v1:private-account:1d:AAA"),
    "not interpreted here"
  );
  assert.deepEqual(f.database.stores.preferences.get("workspace-unbound-v1"), {
    id: "workspace-unbound-v1",
    version: 1,
    status: "preserved-unbound",
    preferences: 1,
    drawings: 1
  });
});

test("ready recovery rejects missing, foreign or corrupt canonical baseline without importing sources", async (t) => {
  const f = await setup(t);
  await f.storage.savePreferences("public", { engine: "kline", rangeDays: 180 });
  await f.storage.saveWatchlistSnapshot("public", [row("a")]);
  await prepare(f);
  const pref = f.database.stores.preferences;
  const originals = new Map(
    ["layout", "watchlist", "market"].map((kind) => [
      `${kind}:${target}`,
      structuredClone(pref.get(`${kind}:${target}`))
    ])
  );
  const invalid = [
    ["layout", undefined],
    ["watchlist", undefined],
    ["market", undefined],
    ["layout", { ...originals.get(`layout:${target}`), owner: "public" }],
    ["layout", { ...originals.get(`layout:${target}`), value: { rangeDays: -1 } }],
    ["layout", { ...originals.get(`layout:${target}`), value: undefined }],
    ["watchlist", { ...originals.get(`watchlist:${target}`), value: undefined }],
    ["watchlist", { ...originals.get(`watchlist:${target}`), value: [{}] }],
    ["market", { ...originals.get(`market:${target}`), value: { at: 1 } }],
    ["market", { ...originals.get(`market:${target}`), value: { rows: [], at: "invalid" } }]
  ];
  for (const [kind, value] of invalid) {
    const id = `${kind}:${target}`;
    if (value === undefined) pref.delete(id);
    else pref.set(id, structuredClone(value));
    const before = sources(f);
    f.database.reads.length = 0;
    await assert.rejects(
      prepare(f, { preferredOwner: "bank" }),
      (error) => error.code === "journal-invalid"
    );
    assertSources(f, before);
    assert.ok(
      f.database.reads.every(
        ({ key }) => !["layout:public", "watchlist:public", "market:public"].includes(key)
      )
    );
    pref.set(id, structuredClone(originals.get(id)));
  }
  await f.storage.savePreferences(target, {
    engine: "tradingview",
    rangeDays: 90,
    symbol: "",
    instrumentUid: null
  });
  await f.storage.saveWatchlistSnapshot(target, []);
  await prepare(f);
  assert.equal((await f.storage.loadPreferences(target)).rangeDays, 90);
  assert.deepEqual(await f.storage.loadWatchlist(target), []);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function fixture() {
  const stores = Object.fromEntries(["preferences", "drawings", "images", "history", "vault"].map(name => [name, new Map()]));
  const hooks = {};
  const database = {
    get: async (name, id) => stores[name].get(id),
    all: async name => [...stores[name].values()],
    put: async (name, value) => stores[name].set(value.id, value),
    flush: async () => {},
    transaction: async (_names, action) => {
      const copy = Object.fromEntries(Object.entries(stores).map(([name, store]) => [name, new Map(store)]));
      const pending = [];
      let aborted = false;
      const tx = { abort() { aborted = true; }, objectStore(name) {
        return { getAll() { const request = {}; pending.push(() => {
          hooks.beforeRead?.(name);
          request.result = [...copy[name].values()]; request.onsuccess();
        }); return request; }, delete: id => copy[name].delete(id), put(value) {
          if (hooks.failPut) throw new Error("write failed");
          copy[name].set(value.id, value);
        } };
      } };
      action(tx);
      while (pending.length && !aborted) pending.shift()();
      if (aborted) throw new DOMException("aborted", "AbortError");
      for (const name of Object.keys(stores)) stores[name] = copy[name];
    }
  };
  const modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative).replace(/\.js$/, ".ts");
    if (file.endsWith("storage-db.ts")) return database;
    if (file.endsWith("storage-history.ts")) return {};
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
    } }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
      spec => load(path.relative(root, path.resolve(path.dirname(file), spec))), module, module.exports
    );
    return module.exports;
  }
  const drawing = (id, value) => ({ id, name: "horizontalStraightLine", points: [{ timestamp: 1700000000, value }] });
  for (const owner of ["A", "B"]) {
    stores.drawings.set(`${owner}:SBER`, { id: `${owner}:SBER`, owner, symbol: "SBER", items: [drawing("same", 1), drawing("deleted", 2)] });
    stores.images.set(`${owner}:old`, { id: `${owner}:old`, owner, symbol: "SBER", name: "old", point: { timestamp: 1700000000, value: 1 }, width: 100, blob: new Blob(["old"], { type: "image/png" }) });
    stores.preferences.set(`view:${owner}:old`, { id: `view:${owner}:old`, owner, viewKey: "old", value: {} });
    stores.preferences.set(`drive:${owner}`, { id: `drive:${owner}`, owner, value: "local association" });
    stores.history.set(owner, { id: owner, owner, data: "history" });
    stores.vault.set(owner, { id: owner, owner, data: "private" });
  }
  const backup = {
    application: "personal-terminal", schemaVersion: 1, layout: { locale: "en", favoriteIntervals: ["1d"] }, watchlist: [], views: [],
    drawings: [{ symbol: "SBER", items: [drawing("same", 100)] }],
    images: [{ id: "new", symbol: "SBER", type: "image/png", width: 100, point: { timestamp: 1700000000, value: 3 }, data: btoa("new bytes") }]
  };
  return { stores, hooks, backup, storage: load("services/storage.ts") };
}

test("portable replace updates and deletes drawings/images and preserves history, vault and other owners", async () => {
  const f = fixture(), untouched = JSON.stringify([...f.stores.drawings.get("B:SBER").items]);
  await f.storage.importBackup("A", f.backup, { replacePortable: true });
  assert.equal(f.stores.drawings.get("A:SBER").items.length, 1);
  assert.equal(f.stores.drawings.get("A:SBER").items[0].points[0].value, 100);
  const images = [...f.stores.images.values()].filter(image => image.owner === "A");
  assert.equal(images.length, 1); assert.equal(await images[0].blob.text(), "new bytes");
  assert.equal(f.stores.preferences.has("view:A:old"), false);
  assert.equal(f.stores.preferences.get("drive:A").value, "local association");
  assert.equal(JSON.stringify(f.stores.drawings.get("B:SBER").items), untouched);
  assert.equal(f.stores.images.has("B:old"), true);
  assert.equal(f.stores.history.get("A").data, "history"); assert.equal(f.stores.vault.get("A").data, "private");
});

test("ordinary import retains merge semantics", async () => {
  const f = fixture(); await f.storage.importBackup("A", f.backup);
  assert.equal(f.stores.drawings.get("A:SBER").items.length, 2);
  assert.equal(f.stores.drawings.get("A:SBER").items[0].points[0].value, 1);
  assert.equal([...f.stores.images.values()].filter(image => image.owner === "A").length, 2);
});

test("portable transaction aborts atomically on a new local edit or write failure", async () => {
  for (const kind of ["guard", "failure"]) {
    const f = fixture(); let valid = true;
    if (kind === "guard") f.hooks.beforeRead = () => { valid = false; };
    else f.hooks.failPut = true;
    await assert.rejects(f.storage.importBackup("A", f.backup, { replacePortable: true, valid: () => valid }));
    assert.equal(f.stores.drawings.get("A:SBER").items.length, 2);
    assert.equal(f.stores.images.has("A:old"), true); assert.equal(f.stores.preferences.has("view:A:old"), true);
  }
});

test("portable import rejects partial snapshots before any mutation", async () => {
  const f = fixture(); delete f.backup.views;
  await assert.rejects(f.storage.importBackup("A", f.backup, { replacePortable: true }));
  assert.equal(f.stores.images.has("A:old"), true);
});

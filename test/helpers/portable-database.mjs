import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root = fileURLToPath(new URL("../../src/", import.meta.url));
class NativeBoundaryDatabase {
  stores = Object.fromEntries(
    ["preferences", "drawings", "images", "history", "coverage", "vault"].map((name) => [
      name,
      new Map()
    ])
  );
  transactions = [];
  hooks = {};
  transaction(names, mode = "readonly") {
    const tx = new NativeBoundaryTransaction(this, Array.isArray(names) ? names : [names], mode);
    this.transactions.push(tx);
    return tx;
  }
  close() {}
}
class NativeBoundaryTransaction {
  state = "active";
  error = null;
  pending = 0;
  commitScheduled = false;
  abortCalls = 0;
  constructor(database, names, mode) {
    this.database = database;
    this.names = names;
    this.mode = mode;
    this.copy = Object.fromEntries(
      names.map((name) => [
        name,
        new Map([...database.stores[name]].map(([key, value]) => [key, structuredClone(value)]))
      ])
    );
  }
  emit(type) {
    this[`on${type}`]?.(new Event(type));
  }
  abort() {
    this.abortCalls++;
    if (this.state !== "active")
      throw new DOMException("Native commit already started", "InvalidStateError");
    this.state = "aborted";
    queueMicrotask(() => {
      // Aborted pending requests can bubble error before the transaction's abort event.
      if (this.pending > 0) this.emit("error");
      this.emit("abort");
    });
  }
  objectStore(name) {
    if (!this.names.includes(name)) throw new Error("store outside transaction");
    return {
      get: (key) => this.request(name, "get", () => structuredClone(this.copy[name].get(key))),
      getAll: () =>
        this.request(name, "getAll", () => structuredClone([...this.copy[name].values()])),
      index: (index) => ({
        getAll: (key) =>
          this.request(name, "getAll", () =>
            structuredClone(
              [...this.copy[name].values()].filter(
                (value) =>
                  index === "ownerSymbol" && value.owner === key[0] && value.symbol === key[1]
              )
            )
          )
      }),
      put: (value) =>
        this.request(name, "put", () => {
          this.copy[name].set(value.id, structuredClone(value));
          return value.id;
        }),
      delete: (key) => this.request(name, "delete", () => this.copy[name].delete(key))
    };
  }
  request(name, kind, operation) {
    if (this.state !== "active") throw new DOMException("Inactive", "TransactionInactiveError");
    const request = {};
    this.pending++;
    setImmediate(async () => {
      try {
        if (this.state !== "active") return;
        if (["put", "delete"].includes(kind))
          await this.database.hooks.beforeWriteComplete?.(this, name, kind);
        if (this.state !== "active") return;
        request.result = operation();
        request.onsuccess?.(new Event("success"));
      } catch (error) {
        if (this.state === "active") {
          this.error = error;
          this.emit("error");
          this.abort();
        }
      } finally {
        this.pending--;
        if (this.state === "active" && this.pending === 0) this.scheduleCommit();
      }
    });
    return request;
  }
  scheduleCommit() {
    if (this.commitScheduled) return;
    this.commitScheduled = true;
    setImmediate(() => {
      this.commitScheduled = false;
      if (this.state !== "active" || this.pending !== 0) return;
      this.state = "committing";
      if (this.mode === "readwrite")
        for (const name of this.names) this.database.stores[name] = this.copy[name];
      this.database.hooks.afterNativeCommit?.(this);
      setImmediate(() => {
        this.state = "finished";
        this.emit("complete");
      });
    });
  }
}

export async function createPortableFixture() {
  const database = new NativeBoundaryDatabase();
  const indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = database;
        request.onsuccess();
      });
      return request;
    }
  };
  const modules = new Map();
  const filename = (relative) => path.resolve(root, relative).replace(/\.js$/, ".ts");
  function compile(file, module, asynchronous = false) {
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS
      }
    }).outputText;
    return vm.runInThisContext(
      `(${asynchronous ? "async " : ""}function(require,module,exports,indexedDB,IDBKeyRange,window){${code}\n})`,
      { filename: file }
    )(
      (spec) => load(path.relative(root, path.resolve(path.dirname(file), spec))),
      module,
      module.exports,
      indexedDB,
      { only: (value) => value },
      { dispatchEvent() {} }
    );
  }
  function load(relative) {
    const file = filename(relative);
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    compile(file, module);
    return module.exports;
  }
  const dbFile = filename("services/storage-db.ts"),
    dbModule = { exports: {} };
  modules.set(dbFile, dbModule);
  await compile(dbFile, dbModule, true);
  return {
    database,
    load,
    json: (value) => JSON.parse(JSON.stringify(value)),
    storageDB: dbModule.exports,
    storage: load("services/storage.ts")
  };
}

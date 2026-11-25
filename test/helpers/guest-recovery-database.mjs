import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root = fileURLToPath(new URL("../../src/", import.meta.url));
function compare(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = compare(a[i], b[i]);
      if (c) return c;
    }
    return a.length - b.length;
  }
  if (Array.isArray(a)) return 1;
  if (Array.isArray(b)) return -1;
  return a === b ? 0 : a < b ? -1 : 1;
}
function matches(key, range) {
  if (!range) return true;
  if (Object.hasOwn(range, "only")) return compare(key, range.only) === 0;
  return compare(key, range.lower) >= 0 && compare(key, range.upper) <= 0;
}
export class GuestDatabase {
  tail = Promise.resolve();
  reads = [];
  stores = Object.fromEntries(
    ["preferences", "drawings", "images", "history", "coverage", "vault"].map((name) => [
      name,
      new Map()
    ])
  );
  transactions = [];
  hooks = {};
  transaction(names, mode = "readonly") {
    const tx = new GuestTransaction(this, Array.isArray(names) ? names : [names], mode);
    this.transactions.push(tx);
    return tx;
  }
  close() {}
}
class GuestTransaction {
  state = "active";
  error = null;
  pending = 0;
  commitScheduled = false;
  abortCalls = 0;
  constructor(database, names, mode) {
    this.database = database;
    this.names = names;
    this.mode = mode;
    const previous = database.tail;
    database.tail = new Promise((resolve) => {
      this.finished = resolve;
    });
    this.ready = previous.then(() => {
      this.copy = Object.fromEntries(
        names.map((name) => [
          name,
          new Map([...database.stores[name]].map(([key, value]) => [key, structuredClone(value)]))
        ])
      );
    });
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
      this.finished();
    });
  }
  objectStore(name) {
    if (!this.names.includes(name)) throw new Error("store outside transaction");
    const query = (range, keys, index) => {
      const records = [...this.copy[name]].filter(([key, value]) =>
        matches(index ? [value.owner, value.symbol] : key, range)
      );
      if (!keys)
        this.database.reads.push(
          ...records.map(([key, value]) => ({ store: name, key, owner: value.owner }))
        );
      return keys
        ? records.map(([key]) => key)
        : structuredClone(records.map(([, value]) => value));
    };
    return {
      get: (key) =>
        this.request(name, "get", () => {
          const value = this.copy[name].get(key);
          this.database.reads.push({ store: name, key, owner: value?.owner });
          return structuredClone(value);
        }),
      getAll: (range) => this.request(name, "getAll", () => query(range, false)),
      getAllKeys: (range) => this.request(name, "getAllKeys", () => query(range, true)),
      index: (index) => {
        if (index !== "ownerSymbol") throw new Error("unsupported index");
        return {
          getAll: (range) => this.request(name, "getAll", () => query(range, false, index)),
          getAllKeys: (range) => this.request(name, "getAllKeys", () => query(range, true, index))
        };
      },
      put: (value) =>
        this.request(
          name,
          "put",
          () => {
            this.copy[name].set(value.id, structuredClone(value));
            return value.id;
          },
          value
        ),
      delete: (key) => this.request(name, "delete", () => this.copy[name].delete(key))
    };
  }
  request(name, kind, operation, metadata) {
    if (this.state !== "active") throw new DOMException("Inactive", "TransactionInactiveError");
    const request = {};
    this.pending++;
    setImmediate(async () => {
      try {
        await this.ready;
        if (this.state !== "active") return;
        if (!["put", "delete"].includes(kind))
          await this.database.hooks.beforeReadComplete?.(this, name, kind);
        if (["put", "delete"].includes(kind))
          await this.database.hooks.beforeWriteComplete?.(this, name, kind, metadata);
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
        this.finished();
      });
    });
  }
}

export async function createGuestFixture() {
  const database = new GuestDatabase();
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
      { only: (value) => ({ only: value }), bound: (lower, upper) => ({ lower, upper }) },
      new EventTarget()
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

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const tick = () => new Promise(setImmediate);
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function countedAbort() {
  const controller = new AbortController(), listeners = new Set(), wrappers = new Map();
  const signal = controller.signal;
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (type, listener, options) => {
    let actual = listener;
    if (type === "abort") {
      listeners.add(listener);
      if (options?.once) actual = function(event) {
        listeners.delete(listener); wrappers.delete(listener);
        if (typeof listener === "function") listener.call(this,event); else listener.handleEvent(event);
      };
      wrappers.set(listener,actual);
    }
    return add(type, actual, options);
  };
  signal.removeEventListener = (type, listener, options) => {
    const actual = wrappers.get(listener) ?? listener;
    if (type === "abort") { listeners.delete(listener); wrappers.delete(listener); }
    return remove(type, actual, options);
  };
  return { controller, signal, listeners };
}

// Native-shaped asynchronous IDB requests and transaction events. This executes the real
// storage-db.ts transaction wrapper; committing precedes delivery of the JS complete event.
// It is a deterministic boundary fake, not a browser/native IndexedDB timing measurement.
class NativeBoundaryDatabase {
  stores = Object.fromEntries(["preferences", "drawings", "images", "history", "coverage", "vault"].map(name => [name, new Map()]));
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
    this.database = database; this.names = names; this.mode = mode;
    this.copy = Object.fromEntries(names.map(name => [name, new Map([...database.stores[name]].map(([key,value]) => [key,structuredClone(value)]))]));
  }
  emit(type) { this[`on${type}`]?.(new Event(type)); }
  abort() {
    this.abortCalls++;
    if (this.state !== "active") throw new DOMException("Native commit already started", "InvalidStateError");
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
      get: key => this.request(name,"get",() => structuredClone(this.copy[name].get(key))),
      getAll: () => this.request(name,"getAll",() => structuredClone([...this.copy[name].values()])),
      put: value => this.request(name,"put",() => { this.copy[name].set(value.id,structuredClone(value)); return value.id; }),
      delete: key => this.request(name,"delete",() => this.copy[name].delete(key))
    };
  }
  request(name, kind, operation) {
    if (this.state !== "active") throw new DOMException("Inactive", "TransactionInactiveError");
    const request = {}; this.pending++;
    setImmediate(async () => {
      try {
        if (this.state !== "active") return;
        if (["put","delete"].includes(kind)) await this.database.hooks.beforeWriteComplete?.(this,name,kind);
        if (this.state !== "active") return;
        request.result = operation(); request.onsuccess?.(new Event("success"));
      } catch (error) {
        if (this.state === "active") {
          this.error = error; this.emit("error"); this.abort();
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
      setImmediate(() => { this.state = "finished"; this.emit("complete"); });
    });
  }
}

async function fixture() {
  const database = new NativeBoundaryDatabase();
  const indexedDB = { open() {
    const request = {};
    queueMicrotask(() => { request.result = database; request.onsuccess(); });
    return request;
  } };
  const context = vm.createContext({ indexedDB, window: { dispatchEvent() {} }, console,
    crypto, Blob, Date, Error, DOMException, Event, AbortController, AbortSignal, TextEncoder,
    TextDecoder, structuredClone, btoa, atob, setTimeout, clearTimeout, setInterval, clearInterval });
  const modules = new Map();
  const filename = relative => path.resolve(root,relative).replace(/\.js$/, ".ts");
  function compile(file, module, asynchronous = false) {
    const code = ts.transpileModule(readFileSync(file,"utf8"), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
    } }).outputText;
    return vm.runInContext(`(${asynchronous?"async ":""}function(require,module,exports){${code}\n})`,context,{filename:file})(
      spec => load(path.relative(root,path.resolve(path.dirname(file),spec))),module,module.exports);
  }
  function load(relative) {
    const file = filename(relative);
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file,module); compile(file,module);
    return module.exports;
  }
  const dbFile = filename("services/storage-db.ts"), dbModule = { exports: {} };
  modules.set(dbFile,dbModule); await compile(dbFile,dbModule,true);
  return { database, load, storageDB: dbModule.exports, storage: load("services/storage.ts") };
}
const drawing = value => ({ id:"same",name:"horizontalStraightLine",points:[{timestamp:1700000000,value}] });
function populate(database) {
  for (const owner of ["A","B"]) {
    database.stores.preferences.set(`layout:${owner}`,{id:`layout:${owner}`,owner,value:{locale:"ru"}});
    database.stores.preferences.set(`drive:${owner}`,{id:`drive:${owner}`,owner,value:"local-only"});
    database.stores.drawings.set(`${owner}:SBER`,{id:`${owner}:SBER`,owner,symbol:"SBER",items:[drawing(1)]});
    database.stores.images.set(`${owner}:image`,{id:`${owner}:image`,owner,symbol:"SBER",blob:new Blob(["old"],{type:"image/png"}),point:{timestamp:1700000000,value:1},width:100});
    database.stores.history.set(owner,{id:owner,owner,data:"history"});
    database.stores.vault.set(owner,{id:owner,owner,data:"private"});
  }
}
const backup = value => ({ application:"personal-terminal",schemaVersion:1,
  layout:{locale:value===1?"ru":"en"},watchlist:[],views:[],
  drawings:[{symbol:"SBER",items:[drawing(value)]}],images:[] });
function unchanged(database) {
  for (const owner of ["A","B"]) {
    assert.equal(database.stores.drawings.get(`${owner}:SBER`).items[0].points[0].value,1);
    assert.equal(database.stores.images.has(`${owner}:image`),true);
    assert.equal(database.stores.history.get(owner).data,"history");
    assert.equal(database.stores.vault.get(owner).data,"private");
    assert.equal(database.stores.preferences.get(`drive:${owner}`).value,"local-only");
    assert.equal(database.stores.preferences.get(`layout:${owner}`).value.locale,"ru");
  }
}

test("pre-aborted signal rejects before creating a transaction or invoking the writer",async()=>{
  const f=await fixture(), a=countedAbort(); populate(f.database); a.controller.abort();
  await assert.rejects(f.storageDB.transaction(["preferences"],()=>assert.fail("writer ran"),a.signal),{name:"AbortError"});
  await assert.rejects(f.storage.importBackup("A",backup(100),{replacePortable:true,signal:a.signal}),{name:"AbortError"});
  assert.equal(f.database.transactions.length,0); assert.equal(a.listeners.size,0); unchanged(f.database);
});

test("portable queued-write abort rolls back atomically and removes the signal listener",async()=>{
  const f=await fixture(), a=countedAbort(), gate=deferred(), entered=deferred(); populate(f.database);
  f.database.hooks.beforeWriteComplete=async()=>{entered.resolve();await gate.promise;};
  const importing=f.storage.importBackup("A",backup(100),{replacePortable:true,signal:a.signal});
  const rejected=assert.rejects(importing,{name:"AbortError"});
  await entered.promise; assert.equal(a.listeners.size,1); a.controller.abort(); gate.resolve();
  await rejected; assert.equal(a.listeners.size,0); unchanged(f.database);
});

test("native commit before JS complete is not turned into a transaction error by late abort",async()=>{
  const f=await fixture(), a=countedAbort();
  f.database.hooks.afterNativeCommit=tx=>{if(tx.mode==="readwrite")a.controller.abort();};
  await f.storageDB.transaction(["preferences"],tx=>tx.objectStore("preferences").put({id:"committed",value:1}),a.signal);
  assert.equal(f.database.stores.preferences.get("committed").value,1);
  assert.equal(a.listeners.size,0);
  assert.equal(f.database.transactions[0].abortCalls,1);
});

test("ordinary file import keeps merge semantics and does not acquire the Drive signal contract",async()=>{
  const f=await fixture(),a=countedAbort();populate(f.database);a.controller.abort();
  await f.storage.importBackup("A",backup(100),{signal:a.signal});
  assert.equal(f.database.stores.preferences.get("layout:A").value.locale,"en");
  assert.equal(f.database.stores.drawings.get("A:SBER").items[0].points[0].value,1);
  assert.equal(f.database.stores.images.has("A:image"),true);
  assert.equal(f.database.stores.history.get("A").data,"history");
  assert.equal(f.database.stores.vault.get("A").data,"private");
  assert.equal(a.listeners.size,0);
});

test("successful complete, native abort, native error and writer throw all clean up listeners",async()=>{
  for(const kind of ["complete","abort","error","throw"]){
    const f=await fixture(), a=countedAbort(); let tx;
    if(kind==="error")f.database.hooks.beforeWriteComplete=()=>{throw new Error("native failure");};
    const running=f.storageDB.transaction(["preferences"],value=>{
      tx=value;
      if(kind==="throw")throw new Error("writer failure");
      if(kind==="abort")value.abort();else value.objectStore("preferences").put({id:"new",value:1});
    },a.signal);
    if(kind==="complete")await running;else await assert.rejects(running);
    assert.equal(a.listeners.size,0,kind);
    const aborts=tx.abortCalls;a.controller.abort();await tick();assert.equal(tx.abortCalls,aborts,kind);
    f.database.hooks={};
    await f.storageDB.transaction(["preferences"],next=>next.objectStore("preferences").put({id:"next",value:2}));
    assert.equal(f.database.stores.preferences.get("next").value,2);
  }
});

for(const phase of ["owner","session","logout"]){
  test(`whole Drive -> transfer -> controller import -> storage TX aborts on ${phase} while writes are pending`,async()=>{
    const f=await fixture(), a=countedAbort(), gate=deferred(), entered=deferred();populate(f.database);
    // Session preparation completes the non-destructive v2 copy before a Drive import is allowed.
    await f.load("services/storage-v2.ts").prepareProfileV2("A");
    const {DriveCoordinator}=f.load("services/drive/coordinator.ts");
    const {TerminalBackups}=f.load("screens/terminal/controller-backups.ts");
    const {driveBackupDigest}=f.load("services/drive/backup.ts");
    let state={owner:"A",name:"Test",authenticated:true,preferences:{},chartRevision:0};
    let client={rows:[],start:async()=>({})}, profile={owner:"A",session:client,authenticated:true,blocked:false};
    const initial=backup(1),incoming=backup(100),base=crypto.randomUUID(),head=crypto.randomUUID();
    let importedSignal,commits=0,authorized=false;
    const transfers=new TerminalBackups({
      getState:()=>state,getClient:()=>client,getChart:()=>null,isAlive:()=>true,
      update:patch=>{state={...state,...patch};},notify:()=>{},flush:async()=>{},saveView:async()=>{},
      editing:{flush:async()=>{},reset:()=>{commits++;}},resetHistory:()=>{},loadHistory:async()=>{},
      session:{matches:value=>value===client,prepareProfile:async()=>{},applyBankState:()=>{}}
    });
    const coordinator=new DriveCoordinator({
      profile:()=>profile,exportBackup:async()=>structuredClone(initial),
      importBackup:async(data,options)=>{importedSignal=options.signal;await transfers.import(data,options);}
    },{
      auth:{prepare:async()=>{},restore:async()=>undefined,suspend:()=>{if(authorized)a.controller.abort();},connectFromUserGesture:()=>{authorized=true;return Promise.resolve({connectionId:crypto.randomUUID(),signal:a.signal,getAccessToken:()=>"fake",invalidate:()=>a.controller.abort()});},disconnect:async()=>{if(authorized)a.controller.abort();}},
      sync:()=>({inspect:async()=>({heads:[head],snapshots:[],conflict:false}),download:async()=>incoming,
        publish:async()=>assert.fail("must pull"),resolve:async()=>assert.fail("must pull")}),
      load:async()=>({schemaVersion:1,deviceId:crypto.randomUUID(),markerId:crypto.randomUUID(),baseHeads:[base],lastSyncedDigest:await driveBackupDigest(initial),automatic:false}),
      save:async()=>assert.fail("aborted import cannot be accepted")
    });
    coordinator.profileChanged();await coordinator.prepare();
    f.database.hooks.beforeWriteComplete=async()=>{entered.resolve();await gate.promise;};
    const connecting=coordinator.connect();
    await Promise.race([entered.promise,connecting.then(()=>assert.fail("import did not reach pending writes: "+JSON.stringify(coordinator.getSnapshot())))]);
    assert.equal(importedSignal,a.signal);assert.equal(a.listeners.size,2,"coordinator + native TX listeners");
    if(phase==="owner"){state={...state,owner:"B"};profile={...profile,owner:"B"};}
    if(phase==="session"){client={};profile={...profile,session:client};}
    if(phase==="logout"){state={...state,authenticated:false};profile={...profile,authenticated:false};}
    coordinator.profileChanged();gate.resolve();await connecting;
    assert.equal(f.database.transactions.findLast(tx=>tx.mode==="readwrite").state,"aborted");
    assert.equal(a.listeners.size,0,"native TX and coordinator once-listeners removed");
    assert.equal(commits,0,"restoration/onCommitted was never reached");unchanged(f.database);
    assert.equal(coordinator.getSnapshot().phase,"disconnected");coordinator.disconnect();
  });
}

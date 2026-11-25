import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url)),
  require = createRequire(import.meta.url);
function sources(overrides = {}) {
  const modules = new Map();
  const windowBoundary = new EventTarget();
  function load(relative) {
    const file = path.resolve(root, relative).replace(/\.js$/, ".ts"),
      key = path.relative(root, file).replaceAll(path.sep, "/");
    if (key === "services/storage-v2.ts" && Object.hasOwn(overrides, "services/storage.ts")) return overrides["services/storage.ts"];
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports,window){${code}\n})`, { filename: file })(
      (specifier) =>
        specifier.startsWith(".")
          ? load(path.relative(root, path.resolve(path.dirname(file), specifier)))
          : require(specifier),
      module,
      module.exports,
      windowBoundary
    );
    return module.exports;
  }
  return load;
}
const load = sources(),
  { UserCameraEvents } = load("charts/camera-events.ts");
const tick = () => new Promise(setImmediate);
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function clock() {
  let sequence = 0,
    now = 0;
  const frames = new Map(),
    timers = new Map();
  const scheduler = {
    frame(action) {
      const id = ++sequence;
      frames.set(id, action);
      return id;
    },
    cancelFrame: (id) => frames.delete(id),
    delay(action, ms) {
      const id = ++sequence;
      timers.set(id, { due: now + ms, action });
      return id;
    },
    cancelDelay: (id) => timers.delete(id)
  };
  const step = () => {
    for (const id of [...frames.keys()]) {
      const action = frames.get(id);
      frames.delete(id);
      action?.();
    }
  };
  const advance = (ms) => {
    now += ms;
    for (const [id, timer] of [...timers])
      if (timer.due <= now) {
        timers.delete(id);
        timer.action();
      }
  };
  return {
    scheduler,
    step,
    advance,
    pending: () => frames.size + timers.size,
    drain() {
      for (let i = 0; i < 100 && (frames.size || timers.size); i++) {
        if (frames.size) step();
        else
          advance(Math.max(0, Math.min(...[...timers.values()].map((timer) => timer.due)) - now));
      }
      assert.equal(frames.size + timers.size, 0);
    }
  };
}
const initialView = () => ({
  camera: { barSpace: 8, rightOffsetBars: -3 },
  anchor: { timestamp: 1700000000000, xFraction: 0.5 },
  from: 1699990000,
  to: 1700010000
});
function observerFixture(callbacks = {}) {
  const events = [],
    hooks = {},
    timing = clock();
  let view = initialView(),
    destroyed = false;
  const observer = new UserCameraEvents(
    {
      onCameraIntent: () => {
        events.push("intent");
        callbacks.onCameraIntent?.();
      },
      onCameraChange: (value) => {
        events.push(structuredClone(value));
        callbacks.onCameraChange?.(value);
      },
      onCameraIdle: (reason) => callbacks.onCameraIdle?.(reason)
    },
    timing.scheduler
  );
  const native = {
    getView() {
      if (hooks.viewThrow) throw new Error("chart unavailable");
      return view;
    },
    setData: () => hooks.data?.(),
    updateBar: () => hooks.quote?.(),
    setView: (value) => {
      view = structuredClone(value);
      observer.nativeChanged();
    },
    fit: () => {
      view.camera.barSpace = 6;
      observer.nativeChanged();
    },
    focusPoints: () => {
      view.camera.rightOffsetBars -= 10;
      observer.nativeChanged();
    },
    zoom() {
      timing.scheduler.frame(() => {
        view.camera.barSpace *= 1.2;
        observer.nativeChanged();
      });
    },
    destroy: () => {
      destroyed = true;
    }
  };
  const adapter = observer.wrap(native);
  return {
    adapter,
    observer,
    events,
    hooks,
    timing,
    view: () => view,
    setView: (next) => {
      view = next;
    },
    destroyed: () => destroyed
  };
}

test("explicit held interaction keeps one camera baseline and cannot settle before release",()=>{
  const f=observerFixture();f.adapter.beginViewInteraction(true,true);
  for(let step=0;step<5;step++){
    f.view().camera.rightOffsetBars-=.25;f.observer.nativeChanged();f.timing.advance(1000);f.timing.step();
    f.adapter.endViewInteraction(); // Unrelated input release cannot settle an explicit hold.
    assert.equal(f.events.filter(value=>typeof value!=="string").length,0);
  }
  assert.equal(f.events.filter(value=>value==="intent").length,1);
  f.adapter.endViewInteraction(true);f.timing.drain();
  const saves=f.events.filter(value=>typeof value!=="string");assert.equal(saves.length,1);
  assert.equal(saves[0].camera.rightOffsetBars,-4.25);
});

test("intent is synchronous before native RAF; settled changes coalesce and start-only click never autosaves", () => {
  const f = observerFixture();
  f.adapter.beginViewInteraction(false);
  assert.deepEqual(f.events, ["intent"]);
  f.adapter.endViewInteraction();
  f.timing.drain();
  assert.equal(f.events.length, 1);
  f.adapter.beginViewInteraction(true);
  f.adapter.zoom();
  f.adapter.endViewInteraction();
  assert.equal(f.view().camera.barSpace, 8);
  assert.equal(f.events.filter((value) => typeof value !== "string").length, 0);
  f.timing.step();
  assert.equal(f.view().camera.barSpace, 9.6);
  f.timing.advance(249);
  assert.equal(f.events.length, 2);
  f.timing.drain();
  assert.equal(f.events.filter((value) => typeof value !== "string").length, 1);
  f.adapter.destroy();
});

test("quotes, programmatic restoration and resize notifications never open a user epoch or echo", () => {
  const f = observerFixture();
  f.hooks.quote = () => {
    f.view().camera.rightOffsetBars--;
    f.observer.nativeChanged();
  };
  for (let i = 0; i < 100; i++) f.adapter.updateBar({});
  f.adapter.setData([], true);
  f.adapter.setView({ camera: { barSpace: 19, rightOffsetBars: 20 } });
  f.observer.nativeChanged();
  f.timing.drain();
  assert.deepEqual(f.events, []);
  f.adapter.beginViewInteraction(true); // An unchanged action must not attribute a following restore to the user.
  f.adapter.setView(initialView());
  f.adapter.endViewInteraction();
  f.timing.drain();
  assert.deepEqual(f.events, ["intent"]);
});

test("pending user zoom/pan survives render and quote updates without per-tick saves", () => {
  const f = observerFixture();
  f.adapter.beginViewInteraction(true);
  f.adapter.zoom();
  f.hooks.quote = () => {
    f.view().anchor.timestamp += 60000;
    f.observer.nativeChanged();
  };
  for (let i = 0; i < 30; i++) f.adapter.updateBar({});
  f.adapter.setData([], false);
  f.timing.step();
  f.adapter.beginViewInteraction(true);
  f.view().camera.rightOffsetBars -= 5;
  f.observer.nativeChanged();
  f.adapter.endViewInteraction();
  f.timing.drain();
  const saved = f.events.filter((value) => typeof value !== "string");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].camera.barSpace, 9.6);
  assert.equal(saved[0].camera.rightOffsetBars, -8);
});

test("fit/focus are user actions and destroy/unavailable geometry bounds delayed work", () => {
  const f = observerFixture();
  f.adapter.fit();
  f.timing.drain();
  f.adapter.focusPoints([]);
  f.timing.drain();
  assert.equal(f.events.filter((value) => typeof value !== "string").length, 2);
  f.adapter.beginViewInteraction(true);
  f.adapter.zoom();
  f.adapter.endViewInteraction();
  f.adapter.destroy();
  f.timing.drain();
  assert.equal(f.destroyed(), true);
  assert.equal(f.events.filter((value) => typeof value !== "string").length, 2);
  const unavailable = observerFixture();
  unavailable.adapter.beginViewInteraction(true);
  unavailable.hooks.viewThrow = true;
  unavailable.adapter.endViewInteraction();
  unavailable.timing.drain();
  assert.equal(unavailable.events.filter((value) => typeof value !== "string").length, 0);
  assert.equal(unavailable.timing.pending(), 0);
});

function fixture() {
  const hooks = {},
    notices = [],
    flushes = { editing: 0, client: 0, storage: 0 },
    uploads = [],
    imports = [],
    key = "SBER:1d:kline:365";
  let local = {
    application: "personal-terminal",
    schemaVersion: 1,
    layout: {
      symbol: "SBER",
      instrumentUid: "one",
      timeframe: "1d",
      engine: "kline",
      rangeDays: 365
    },
    watchlist: [],
    drawings: [],
    images: [],
    views: [{ key, value: initialView() }]
  };
  const modules = sources({
    "services/storage.ts": {
      flush: async () => {
        flushes.storage++;
      },
      createBackup: async () => structuredClone(local),
      savePreferences: async () => {},
      saveAnnotationDocument: async () => {}
    },
    "services/chart-camera.ts": {
      saveChartView: async (_owner, _key, view) => {
        if (hooks.failSave) throw new Error("quota");
        await hooks.save?.();
        local.views = [{ key, value: structuredClone(view) }];
      }
    },
    "services/tbank-client.ts": { TBankClient: class {} }
  });
  const { TerminalController } = modules("screens/terminal/controller.ts"),
    controller = new TerminalController();
  controller.session.client = {
    flush: async () => {
      flushes.client++;
    },
    close: async () => {}
  };
  controller.editing.flush = async () => {
    flushes.editing++;
  };
  controller.notify = (message) => notices.push(message);
  controller.update({
    owner: "A",
    authenticated: true, marketReady: true,
    ready: true,
    rows: [{ symbol: "SBER", uid: "one", name: "Test" }],
    preferences: { ...controller.getSnapshot().preferences, ...local.layout },
    candles: [{ timestamp: 1700000000000, open: 1, high: 2, low: 1, close: 2, volume: 1 }]
  });
  const camera = modules("screens/terminal/controller-camera-sync.ts");
  let alive = true,
    adapter;
  const callbacks = camera.cameraCallbacks(
      controller,
      () => adapter,
      () => alive,
      modules("services/chart-camera.ts").saveChartView
    ),
    f = observerFixture(callbacks);
  adapter = f.adapter;
  adapter.source = { owner: "A", viewKey: key, uid: "one" };
  controller.chart = adapter;
  const { DriveCoordinator } = modules("services/drive/coordinator.ts"),
    nodes = new Map();
  let heads = [],
    record = {
      schemaVersion: 1,
      markerId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      baseHeads: [],
      automatic: true
    };
  const inspect = async () => ({
    heads: [...heads],
    conflict: heads.length > 1,
    snapshots: [...nodes].map(([nodeId]) => ({
      manifest: { nodeId, createdAt: "2026-11-25T00:00:00Z" }
    }))
  });
  const publish = async (backup) => {
    const nodeId = crypto.randomUUID();
    nodes.set(nodeId, structuredClone(backup));
    heads = [nodeId];
    uploads.push(structuredClone(backup));
    return { nodeId, inspection: await inspect() };
  };
  let auth;
  const coordinator = new DriveCoordinator(
    {
      profile: () => ({
        owner: controller.getSnapshot().owner,
        session: controller.sessionKey(),
        authenticated: controller.getSnapshot().authenticated,
        blocked: camera.cameraPending(controller)
      }),
      exportBackup: async () => {
        await camera.flushCamera(controller);
        return controller.exportBackup(false, { captureView: false });
      },
      importBackup: async (backup, options) => {
        await hooks.beforeCommit?.();
        if (!options.valid()) throw new DOMException("changed", "AbortError");
        local = structuredClone(backup);
        imports.push(backup);
        options.onCommitted();
        adapter.setView(backup.views[0].value);
      }
    },
    {
      auth: {
        prepare: async () => {},
        restore: async () => undefined,
        suspend: () => auth?.abort(),
        connectFromUserGesture: async () => {
          auth = new AbortController();
          return { signal: auth.signal, getAccessToken: () => "fixture-test-token", invalidate: () => auth.abort() };
        },
        disconnect: async () => auth?.abort()
      },
      sync: () => ({
        inspect,
        download: async (id) => {
          await hooks.download?.();
          return structuredClone(nodes.get(id));
        },
        publish,
        resolve: publish
      }),
      load: async () => structuredClone(record),
      save: async (_owner, next) => {
        record = structuredClone(next);
      }
    }
  );
  const unsubscribe = camera.subscribeCamera(controller, (kind) =>
    kind === "intent" ? coordinator.localIntent() : coordinator.localChanged()
  );
  coordinator.profileChanged();
  return {
    ...f,
    camera,
    controller,
    coordinator,
    uploads,
    imports,
    hooks,
    notices,
    flushes,
    modules,
    local: () => local,
    async connect() {
      await coordinator.prepare();
      await coordinator.connect();
    },
    remote() {
      const incoming = structuredClone(local);
      incoming.layout.chartSettings = { theme: "light" };
      const id = crypto.randomUUID();
      nodes.set(id, incoming);
      heads = [id];
    },
    kill() {
      alive = false;
    },
    close() {
      unsubscribe();
      coordinator.disconnect();
      adapter.destroy();
      controller.dispose();
    }
  };
}

test("Drive polling after quote-only native shifts neither captures a live view nor publishes/conflicts", async (t) => {
  const f = fixture();
  t.after(() => f.close());
  await f.connect();
  assert.equal(f.uploads.length, 1);
  f.hooks.quote = () => {
    f.view().camera.rightOffsetBars--;
    f.view().anchor.timestamp += 60000;
    f.observer.nativeChanged();
  };
  for (let i = 0; i < 20; i++) f.adapter.updateBar({});
  f.timing.drain();
  await tick();
  await f.coordinator.sync();
  await f.coordinator.sync();
  assert.equal(f.uploads.length, 1);
  assert.equal(f.local().views[0].value.camera.rightOffsetBars, -3);
  f.remote();
  await f.coordinator.sync();
  assert.equal(f.imports.length, 1);
  assert.equal(f.coordinator.getSnapshot().phase, "idle");
  assert.equal(f.uploads.length, 1);
  assert.ok(
    f.flushes.editing > 0 && f.flushes.client > 0 && f.flushes.storage > 0,
    "normal durable queues still flush"
  );
});

test("manual JSON export retains live capture and settled user camera becomes a Drive edit", async (t) => {
  const f = fixture();
  t.after(() => f.close());
  await f.connect();
  f.view().camera.rightOffsetBars = -9;
  const manual = await f.controller.exportBackup(false);
  assert.equal(manual.views[0].value.camera.rightOffsetBars, -9);
  f.camera.userCameraAction(f.controller, f.adapter, () => f.adapter.zoom());
  assert.equal(f.view().camera.barSpace, 8);
  f.timing.drain();
  await tick();
  await f.coordinator.sync();
  assert.equal(f.uploads.length, 2);
  assert.equal(f.uploads[1].views[0].value.camera.barSpace, 9.6);
});

test("a poll starting after intent but before settle/save is held until the captured camera is durable", async (t) => {
  const f = fixture();
  t.after(() => f.close());
  await f.connect();
  f.remote();
  f.camera.userCameraAction(f.controller, f.adapter, () => f.adapter.zoom());
  assert.equal(f.camera.cameraPending(f.controller), true);
  await f.coordinator.sync();
  assert.equal(f.imports.length, 0);
  const gate = deferred();
  f.hooks.save = () => gate.promise;
  f.timing.drain();
  await tick();
  assert.equal(f.camera.cameraPending(f.controller), true);
  await f.coordinator.sync();
  assert.equal(f.imports.length, 0);
  // A quote after settled readback must not change the already captured user view.
  f.view().camera.rightOffsetBars = -99;
  gate.resolve();
  await f.camera.flushCamera(f.controller);
  assert.equal(f.local().views[0].value.camera.rightOffsetBars, -3);
  assert.equal(f.local().views[0].value.camera.barSpace, 9.6);
  assert.equal(f.camera.cameraPending(f.controller), false);
  await f.coordinator.sync();
  assert.equal(f.coordinator.getSnapshot().phase, "conflict");
  assert.equal(f.imports.length, 0);
});

test("unchanged clicks release camera pending and save failure cannot permit a remote overwrite", async (t) => {
  const f = fixture();
  t.after(() => f.close());
  await f.connect();
  f.adapter.beginViewInteraction(false);
  assert.equal(f.camera.cameraPending(f.controller), true);
  f.adapter.endViewInteraction();
  assert.equal(f.camera.cameraPending(f.controller), false);
  f.hooks.failSave = true;
  f.camera.userCameraAction(f.controller, f.adapter, () => f.adapter.zoom());
  f.timing.drain();
  await tick();
  assert.equal(f.camera.cameraPending(f.controller), true);
  f.remote();
  await f.coordinator.sync();
  assert.equal(f.imports.length, 0);
  f.hooks.failSave = false;
  f.camera.userCameraAction(f.controller, f.adapter, () => f.adapter.zoom());
  f.timing.drain();
  await f.camera.flushCamera(f.controller);
  assert.equal(f.camera.cameraPending(f.controller), false);
  assert.equal(f.notices.length, 1);
});

test("native pan/zoom intent during download or before commit invalidates incoming before its first RAF", async (t) => {
  for (const phase of ["download", "commit"]) {
    const f = fixture();
    t.after(() => f.close());
    await f.connect();
    f.remote();
    const gate = deferred();
    let entered = false;
    f.hooks[phase === "download" ? "download" : "beforeCommit"] = async () => {
      entered = true;
      await gate.promise;
    };
    const syncing = f.coordinator.sync();
    while (!entered) await tick();
    f.camera.userCameraAction(f.controller, f.adapter, () => f.adapter.zoom());
    assert.equal(f.view().camera.barSpace, 8, "native setter still waits for RAF");
    gate.resolve();
    await syncing;
    assert.equal(f.imports.length, 0);
    assert.equal(f.coordinator.getSnapshot().error, "local-changed");
    f.timing.drain();
    await tick();
    assert.equal(f.local().views[0].value.camera.barSpace, 9.6);
  }
});

test("owner/session/UID/viewKey/retired/recovery changes reject delayed camera saves and intents", async (t) => {
  for (const mutation of [
    (f) => f.controller.update({ owner: "B" }),
    (f) => {
      f.controller.session.client = { close: async () => {} };
    },
    (f) => {
      f.adapter.source.uid = "other";
    },
    (f) => {
      f.adapter.source.viewKey = "other";
    },
    (f) => {
      f.adapter.retired = true;
    },
    (f) => {
      f.adapter.persistView = false;
    },
    (f) => f.controller.update({ importRecoveryRequired: true }),
    (f) => f.controller.update({ historyViewReady: false }),
    (f) => f.kill()
  ]) {
    const f = fixture();
    t.after(() => f.close());
    f.adapter.beginViewInteraction(true);
    f.adapter.zoom();
    f.adapter.endViewInteraction();
    mutation(f);
    f.timing.drain();
    await tick();
    assert.equal(f.local().views[0].value.camera.barSpace, 8);
    const events = [];
    const stop = f.camera.subscribeCamera(f.controller, (kind) => events.push(kind));
    f.adapter.beginViewInteraction(true);
    assert.deepEqual(events, []);
    stop();
  }
});

test("save failures are bounded and success permits a later failure notification", async (t) => {
  const f = fixture();
  t.after(() => f.close());
  f.hooks.failSave = true;
  for (let i = 0; i < 2; i++) {
    f.camera.userCameraAction(f.controller, f.adapter, () => f.adapter.zoom());
    f.timing.drain();
    await tick();
  }
  assert.equal(f.notices.length, 1);
  f.hooks.failSave = false;
  f.camera.userCameraAction(f.controller, f.adapter, () => f.adapter.zoom());
  f.timing.drain();
  await tick();
  f.hooks.failSave = true;
  f.camera.userCameraAction(f.controller, f.adapter, () => f.adapter.zoom());
  f.timing.drain();
  await tick();
  assert.equal(f.notices.length, 2);
});

test("capture handlers invalidate before native input and block canvas mutation during import without blocking recovery controls", async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const { createCameraInput } = f.modules("screens/terminal/camera-input.ts"),
    input = createCameraInput(f.controller);
  const event = (x = 10) => ({
    pointerId: 1,
    button: 0,
    clientX: x,
    target: null,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    }
  });
  input.down(event());
  assert.equal(f.events[0], "intent");
  input.move(event(30));
  f.view().camera.rightOffsetBars = -20;
  f.observer.nativeChanged();
  input.up({ pointerId: 1 });
  f.timing.drain();
  await tick();
  assert.equal(f.local().views[0].value.camera.rightOffsetBars, -20);
  f.controller.update({ importingBackup: true });
  const blocked = event();
  assert.equal(input.down(blocked), false);
  assert.equal(blocked.prevented, true);
  assert.equal(blocked.stopped, true);
  const wheel = event();
  assert.equal(input.action(wheel), false);
  assert.equal(wheel.prevented, true);
  input.cancel();
  const oldElement = globalThis.Element;
  try {
    globalThis.Element = class {
      closest() {
        return "button";
      }
    };
    const recovery = event();
    recovery.target = new globalThis.Element();
    input.down(recovery);
    assert.equal(recovery.prevented, false);
    assert.equal(recovery.stopped, false);
  } finally {
    if (oldElement === undefined) delete globalThis.Element;
    else globalThis.Element = oldElement;
  }
});

test("wheel/pinch capture arms user changes while hover and purely vertical motion do not save an X-camera", async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const { createCameraInput } = f.modules("screens/terminal/camera-input.ts"),
    input = createCameraInput(f.controller);
  const event = (pointerId, clientX) => ({
    pointerId,
    clientX,
    button: 0,
    target: null,
    preventDefault() {},
    stopPropagation() {}
  });
  input.move(event(1, 10));
  assert.equal(f.events.length, 0);
  input.down(event(1, 10));
  input.move(event(1, 10));
  input.up({ pointerId: 1 });
  f.timing.drain();
  await tick();
  assert.equal(f.events.filter((value) => typeof value !== "string").length, 0);
  input.down(event(1, 10));
  input.down(event(2, 30));
  input.move(event(2, 30));
  f.view().camera.barSpace = 16;
  f.observer.nativeChanged();
  input.up({ pointerId: 2 });
  input.up({ pointerId: 1 });
  f.timing.drain();
  await tick();
  assert.equal(f.local().views[0].value.camera.barSpace, 16);
  input.action(event(3, 10));
  f.view().camera.barSpace = 24;
  f.observer.nativeChanged();
  f.timing.drain();
  await tick();
  assert.equal(f.local().views[0].value.camera.barSpace, 24);
});

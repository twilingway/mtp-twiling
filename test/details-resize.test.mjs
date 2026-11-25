import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function sources(overrides = {}, globals = {}) {
  const cells = new Map();
  const context = vm.createContext({
    console,
    Date,
    Math,
    Promise,
    TextEncoder,
    TextDecoder,
    crypto,
    Blob,
    ...globals
  });
  function load(relative) {
    let filename = path.resolve(root, relative).replace(/\.js$/, ".ts");
    if (!existsSync(filename)) filename += "x";
    const key = path.relative(root, filename).replaceAll(path.sep, "/");
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (cells.has(key)) return cells.get(key).exports;
    const module = { exports: {} };
    cells.set(key, module);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${code}\n})`, { filename }).runInContext(
      context
    )(
      (specifier) =>
        Object.hasOwn(overrides, specifier)
          ? overrides[specifier]
          : load(path.relative(root, path.resolve(path.dirname(filename), specifier))),
      module,
      module.exports
    );
    return module.exports;
  }
  return load;
}
const model = sources()("model/details-resize.ts");

test("geometry reserves list controls and both regions without modifying the preference", () => {
  assert.equal(model.detailsRatio(undefined), 0.45);
  for (const invalid of [NaN, Infinity, "0.4", null])
    assert.equal(model.detailsRatio(invalid), 0.45);
  assert.equal(model.detailsRatio(10), 0.85);
  assert.equal(model.detailsRatio(-1), 0.15);
  for (const total of [0, 40, 150, 300, 760, 1200]) {
    for (const preferred of [0.15, 0.45, 0.85]) {
      const value = model.detailsGeometry(total, 140, preferred);
      assert.ok(value.height >= value.minimum && value.height <= value.maximum);
      assert.ok(value.height <= total && value.height >= 0);
      if (total >= 400) {
        assert.ok(total - value.height >= 200);
        assert.ok(value.height >= 96);
      } else {
        assert.ok(total - value.height >= total * 0.65 - 0.001);
      }
    }
  }
  assert.equal(model.detailsGeometry(760, 140, 0.85).height, 560);
  assert.equal(model.detailsGeometry(150, 140, 0.85).height, 52.5);
  assert.equal(model.detailsGeometry(1200, 140, 0.85).height, 1000);
});

test("optional backup ratio is bounded, legacy compatible and retained by Drive", async () => {
  const load = sources();
  const { validateBackup } = load("model/backup-format.ts");
  const { sanitizeDriveBackup, driveBackupDigest } = load("services/drive/backup.ts");
  const backup = {
    application: "personal-terminal",
    schemaVersion: 1,
    layout: { symbol: "SBER" },
    drawings: [],
    images: []
  };
  assert.ok(validateBackup(backup));
  for (const ratio of [0.15, 0.45, 0.85]) {
    const input = { ...backup, layout: { ...backup.layout, rightDetailsHeightRatio: ratio } };
    assert.ok(validateBackup(input));
    assert.equal(sanitizeDriveBackup(input).layout.rightDetailsHeightRatio, ratio);
  }
  for (const ratio of [0, 0.1499, 0.8501, 1, NaN, Infinity, "0.4", null]) {
    assert.throws(() => validateBackup({ ...backup, layout: { rightDetailsHeightRatio: ratio } }));
    assert.throws(() =>
      sanitizeDriveBackup({ ...backup, layout: { rightDetailsHeightRatio: ratio } })
    );
  }
  assert.notEqual(
    await driveBackupDigest(backup),
    await driveBackupDigest({ ...backup, layout: { rightDetailsHeightRatio: 0.45 } })
  );
});

test("actual profile storage exports and imports the ratio without crossing owners", async () => {
  const records = new Map();
  const put = async (store, record) => {
    records.set(`${store}/${record.id}`, structuredClone(record));
  };
  const storage = sources({
    "services/storage-db.ts": {
      get: async (store, id) => structuredClone(records.get(`${store}/${id}`)),
      put,
      all: async (store) =>
        [...records.entries()]
          .filter(([key]) => key.startsWith(store + "/"))
          .map(([, value]) => structuredClone(value)),
      flush: async () => {},
      transaction: async (_stores, action) =>
        action({
          objectStore: (store) => ({
            put: (record) => {
              records.set(`${store}/${record.id}`, structuredClone(record));
            }
          })
        })
    }
  })("services/storage.ts");
  await storage.savePreferences("one", { symbol: "SBER", rightDetailsHeightRatio: 0.7 });
  await storage.savePreferences("two", { symbol: "GAZP", rightDetailsHeightRatio: 0.2 });
  const exported = await storage.createBackup("one");
  assert.equal(exported.layout.rightDetailsHeightRatio, 0.7);
  await storage.importBackup("three", exported);
  assert.equal((await storage.loadPreferences("three")).rightDetailsHeightRatio, 0.7);
  assert.equal((await storage.loadPreferences("two")).rightDetailsHeightRatio, 0.2);
  assert.equal((await storage.loadPreferences("one")).rightDetailsHeightRatio, 0.7);
  assert.equal((await storage.createBackup("three")).layout.rightDetailsHeightRatio, 0.7);
});

function fixture(preferred = 0.45) {
  let state = {
    owner: "one",
    chartRevision: 0,
    mobilePanelOpen: true,
    objectPanel: false,
    preferences: { rightDetailsHeightRatio: preferred }
  };
  const hooks = [],
    effects = [],
    writes = [],
    pending = [],
    events = new Map(),
    classes = new Set();
  let cursor = 0,
    node,
    observer;
  const style = new Map();
  class Element {
    constructor(height = 0) {
      this.offsetHeight = height;
    }
  }
  const panel = {
    clientHeight: 800,
    style: {
      setProperty: (key, value) => style.set(key, value),
      removeProperty: (key) => style.delete(key)
    },
    querySelector: (selector) =>
      ({
        ".watchlist-heading": new Element(60),
        ".watchlist-search": new Element(40),
        ".watchlist-meta": new Element(40),
        ".private-note": new Element(32)
      })[selector]
  };
  const element = new Element(8);
  Object.assign(element, {
    parentElement: panel,
    captured: null,
    focus() {},
    setPointerCapture(pointer) {
      this.captured = pointer;
    },
    hasPointerCapture(pointer) {
      return this.captured === pointer;
    },
    releasePointerCapture() {
      this.captured = null;
      node.props.onLostPointerCapture(event());
    }
  });
  const controller = {
    getSnapshot: () => state,
    setPreferences: (patch, _reload, valid) =>
      new Promise((resolve) => {
        pending.push(() => {
          if (valid()) {
            writes.push(patch);
            state = { ...state, preferences: { ...state.preferences, ...patch } };
          }
          resolve();
        });
      }),
    notify: (message) => assert.fail(message)
  };
  const jsx = (type, props) => ({ type, props });
  const load = sources(
    {
      react: {
        useRef(initial) {
          const i = cursor++;
          return (hooks[i] ??= { current: initial });
        },
        useState(initial) {
          const i = cursor++;
          if (!hooks[i]) hooks[i] = { value: typeof initial === "function" ? initial() : initial };
          return [
            hooks[i].value,
            (next) => {
              hooks[i].value = next;
            }
          ];
        },
        useCallback(callback, deps) {
          const i = cursor++;
          if (!hooks[i] || deps.some((value, index) => value !== hooks[i].deps[index]))
            hooks[i] = { deps, callback };
          return hooks[i].callback;
        },
        useLayoutEffect(effect, deps) {
          const i = cursor++;
          if (!hooks[i] || deps.some((value, index) => value !== hooks[i].deps[index])) {
            effects.push(() => {
              hooks[i]?.cleanup?.();
              hooks[i] = { deps, cleanup: effect() };
            });
          }
        }
      },
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "i18n/messages.ts": { t: (value) => value },
      "screens/terminal/context.tsx": { useTerminal: () => ({ state, controller }) }
    },
    {
      HTMLElement: Element,
      getComputedStyle: () => ({ marginTop: "0px", marginBottom: "0px" }),
      document: {
        documentElement: {
          classList: {
            add: (value) => classes.add(value),
            remove: (value) => classes.delete(value)
          }
        }
      },
      window: {
        addEventListener: (key, callback) => events.set(key, callback),
        removeEventListener: (key) => events.delete(key)
      },
      ResizeObserver: class {
        constructor(callback) {
          observer = callback;
        }
        observe() {}
        disconnect() {}
      }
    }
  );
  const Divider = load("screens/terminal/DetailsDivider.tsx").DetailsDivider;
  function render() {
    cursor = 0;
    node = Divider();
    node.props.ref.current = element;
    while (effects.length) effects.shift()();
    return node;
  }
  function event(extra = {}) {
    return {
      currentTarget: element,
      pointerId: 7,
      button: 0,
      clientY: 400,
      prevented: false,
      stopped: false,
      preventDefault() {
        this.prevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
      ...extra
    };
  }
  return {
    render,
    event,
    element,
    panel,
    style,
    classes,
    writes,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    call: (name, extra) => {
      const e = event(extra);
      node.props[name](e);
      return e;
    },
    flush: async () => {
      while (pending.length) pending.shift()();
      await Promise.resolve();
    },
    blur: () => events.get("blur")(),
    resize: () => observer(),
    unmount: () => {
      for (const hook of hooks) hook?.cleanup?.();
    }
  };
}

test("pointer resize commits only at release, blocks chart events and supports touch", async () => {
  const f = fixture();
  f.render();
  assert.equal(f.style.get("--watchlist-details-height"), "342px");
  const down = f.call("onPointerDown", { pointerType: "touch" });
  assert.ok(down.prevented && down.stopped);
  assert.equal(f.element.captured, 7);
  const move = f.call("onPointerMove", { clientY: 300 });
  assert.ok(move.prevented && move.stopped);
  assert.equal(f.style.get("--watchlist-details-height"), "442px");
  assert.equal(f.writes.length, 0);
  f.call("onPointerUp");
  await f.flush();
  assert.equal(f.element.captured, null);
  assert.equal(f.classes.size, 0);
  assert.equal(f.writes[0].rightDetailsHeightRatio, 442 / 760);
  for (const name of [
    "onClick",
    "onDoubleClick",
    "onMouseDown",
    "onContextMenu",
    "onWheel",
    "onTouchStart"
  ])
    assert.ok(f.call(name).stopped);
  f.unmount();
});

test("all cancellation paths release capture and never commit intermediate height", async () => {
  for (const kind of [
    "cancel",
    "capture",
    "blur",
    "escape",
    "owner",
    "import",
    "recovery",
    "revision",
    "collapse",
    "objects",
    "mobile",
    "resize",
    "unmount"
  ]) {
    const f = fixture();
    f.render();
    f.call("onPointerDown");
    f.call("onPointerMove", { clientY: 300 });
    if (kind === "cancel") f.call("onPointerCancel");
    if (kind === "capture") f.call("onLostPointerCapture");
    if (kind === "blur") f.blur();
    if (kind === "escape") f.call("onKeyDown", { key: "Escape" });
    if (kind === "owner") f.update({ owner: "two" });
    if (kind === "import") f.update({ importingBackup: true });
    if (kind === "recovery") f.update({ importRecoveryRequired: true });
    if (kind === "revision") f.update({ chartRevision: 1 });
    if (kind === "collapse") f.update({ preferences: { rightPanelCollapsed: true } });
    if (kind === "objects") f.update({ objectPanel: true });
    if (kind === "mobile") f.update({ mobilePanelOpen: false });
    if (kind === "resize") {
      f.panel.clientHeight = 400;
      f.resize();
    }
    if (kind === "unmount") f.unmount();
    else {
      f.call("onPointerMove");
      f.call("onPointerUp");
    }
    await f.flush();
    assert.equal(f.writes.length, 0, kind);
    assert.equal(f.element.captured, null, kind);
    assert.equal(f.classes.size, 0, kind);
    if (kind !== "unmount") f.unmount();
  }
});

test("deferred writes are invalidated by owner/import/unmount and keyboard uses bounded values", async () => {
  for (const patch of [{ owner: "two" }, { importingBackup: true }, { chartRevision: 1 }, null]) {
    const f = fixture();
    f.render();
    f.call("onKeyDown", { key: "ArrowUp" });
    if (patch) f.update(patch);
    else f.unmount();
    await f.flush();
    assert.equal(f.writes.length, 0);
    if (patch) f.unmount();
  }
  for (const [key, expected] of [
    ["ArrowUp", 352 / 760],
    ["ArrowDown", 332 / 760],
    ["Home", 0.15],
    ["End", 560 / 760]
  ]) {
    const f = fixture();
    const node = f.render();
    assert.equal(node.props.role, "separator");
    assert.equal(node.props["aria-orientation"], "horizontal");
    const e = f.call("onKeyDown", { key });
    assert.ok(e.prevented && e.stopped);
    await f.flush();
    assert.equal(f.writes[0].rightDetailsHeightRatio, expected);
    f.unmount();
  }
  const f = fixture(0.85);
  f.render();
  f.panel.clientHeight = 190;
  f.resize();
  assert.equal(f.style.get("--watchlist-details-height"), "52.5px");
  await f.flush();
  assert.equal(f.writes.length, 0);
  f.panel.clientHeight = 1240;
  f.resize();
  assert.equal(f.style.get("--watchlist-details-height"), "1000px");
  f.unmount();
});

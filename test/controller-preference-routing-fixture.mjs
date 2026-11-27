import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(`${target}/package.json`);
const ts = require("typescript");
const tick = () => new Promise(setImmediate);
export function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}
export async function until(valid, label) {
  for (let i = 0; i < 100; i++) {
    if (valid()) return;
    await tick();
  }
  assert.fail(`checkpoint not reached: ${label}`);
}
const clone = (value) => structuredClone(value);

function sourceModules(overrides, react) {
  const root = `${target}/src`;
  const cache = new Map();
  const local = new Map();
  const context = vm.createContext({
    console,
    URL,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    DOMException,
    Event,
    CustomEvent,
    EventTarget,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    window: new EventTarget(),
    navigator: { onLine: true },
    localStorage: {
      getItem: (key) => local.get(key) ?? null,
      setItem: (key, value) => local.set(key, value)
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    structuredClone
  });
  function load(relative) {
    let filename = path.resolve(root, relative);
    if (filename.endsWith(".js")) {
      filename = filename.slice(0, -3) + ".ts";
      if (!fs.existsSync(filename)) filename += "x";
    }
    const key = path.relative(root, filename).replaceAll(path.sep, "/");
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (cache.has(filename)) return cache.get(filename).exports;
    assert.ok(!key.startsWith("../"));
    const module = { exports: {} };
    cache.set(filename, module);
    const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${output}\n})`, { filename }).runInContext(
      context
    )(
      (specifier) => {
        if (specifier === "react") return react;
        if (specifier === "react/jsx-runtime")
          return {
            jsx: (type, props) => ({ type, props }),
            jsxs: (type, props) => ({ type, props })
          };
        assert.ok(specifier.startsWith("."), specifier);
        return load(path.relative(root, path.resolve(path.dirname(filename), specifier)));
      },
      module,
      module.exports
    );
    return module.exports;
  }
  return load;
}
export function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const result = find(child, predicate);
    if (result) return result;
  }
  return null;
}
const VIEW = { camera: { barSpace: 8, rightOffsetBars: 3 } };

export async function routingFixture() {
  const log = [],
    requests = [],
    preferenceWrites = [];
  const hooks = {};
  let controller;
  const storage = {
    loadDrawings: async () => [],
    loadImages: async () => [],
    loadView: async (owner, key) => hooks.loadView?.(owner, key),
    saveView: async (owner, key, value) => {
      log.push({ event: "saveView", key });
      await hooks.saveView?.(owner, key, value);
    },
    savePreferences: async (owner, preferences) => {
      preferenceWrites.push(clone(preferences));
      log.push({
        event: "savePreferences",
        timeframe: preferences.timeframe,
        engine: preferences.engine
      });
      await hooks.savePreferences?.(owner, preferences);
    },
    saveAnnotationDocument: async (...args) => hooks.annotations?.(...args),
    flush: async () => {},
    loadCoverage: async () => []
  };
  const db = {
    get: async () => undefined,
    all: async () => [],
    put: async () => {},
    transaction: async (_names, action) => {
      await hooks.transaction?.();
      action({
        objectStore: () => ({
          put: (record) => log.push({ event: "transactionPut", key: record.viewKey }),
          delete: () => {}
        })
      });
      await hooks.afterTransaction?.();
    }
  };
  const refs = [];
  let refIndex = 0,
    effects = [];
  const react = {
    memo: (fn) => fn,
    useRef: (initial) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }),
    useMemo: (fn) => fn(),
    useEffect: (effect) => effects.push(effect)
  };
  const factory = (options) => {
    let hasData = false;
    let priceRange = null;
    return {
      options,
      retired: false,
      persistView: true,
      getView: () => (hasData ? clone(VIEW) : null),
      plotSize: () => ({ width: 800, height: 500 }),
      setData: (data) => {
        hasData = data.length > 0;
      },
      setView: () => {},
      getManualPriceRange: () => priceRange,
      setManualPriceRange: (range) => {
        priceRange = range;
      },
      updateTechnicalIndicators: () => {},
      updateTechnicalInputs: () => {},
      destroy() {
        this.retired = true;
      }
    };
  };
  const load = sourceModules(
    {
      "services/storage-v2.ts": storage,
      "services/storage-db.ts": db,
      "services/storage-v2-migration.ts": {
        physicalOwner: (owner) => owner,
        prepareProfileV2: async () => {}
      },
      "services/market-client.ts": { MarketClient: class {} },
      "screens/terminal/context.tsx": {
        useTerminal: (select = (state) => state) => ({
          controller,
          state: select(controller.getSnapshot())
        }),
        useTerminalState: (target, select) => select(target.getSnapshot())
      },
      "screens/terminal/ClockZoneControl.tsx": { ClockZoneControl: () => null },
      "screens/terminal/TerminalIndicatorControls.tsx": { TerminalIndicatorControls: () => null },
      "screens/terminal/NativeChartTypeMenu.tsx": { NativeChartTypeMenu: () => null },
      "screens/terminal/intervals/TimeframeMenu.tsx": {
        TimeframeMenu: function TimeframeMenuStub() {}
      },
      "screens/terminal/chart-price-metadata.ts": { watchChartPriceMetadata: () => () => {} },
      "charts/lightweight.ts": { makeLightweight: factory },
      "charts/kline.ts": { makeKline: factory }
    },
    react
  );
  controller = new (load("screens/terminal/controller.ts").TerminalController)();
  const DAY = 86400000;
  const bars = Array.from({ length: 1001 }, (_, i) => ({
    timestamp: Date.now() - (1000 - i) * DAY,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    volume: 10
  }));
  const client = {
    owner: "owner-A",
    authenticated: true,
    marketReady: true,
    candles: async (symbol, timeframe, range, options) => {
      requests.push({
        symbol,
        timeframe,
        uid: options.uid,
        engine: controller.getSnapshot().preferences.engine
      });
      const result = await hooks.candles?.(symbol, timeframe, range, options);
      if (result) return result;
      const interval = load("model/intervals/native-timeframes.ts").NATIVE_TIMEFRAME_CONFIG[timeframe].ms ?? 30 * DAY;
      const available = interval === DAY
        ? bars
        : Array.from({ length: 1001 }, (_, i) => ({
            ...bars[0],
            timestamp: Date.now() - (1000 - i) * interval
          }));
      return {
        candles: available.filter((bar) => bar.timestamp >= range.from),
        requests: 0,
        cached: true
      };
    },
    close: async () => {},
    flush: async () => {}
  };
  controller.session.client = client;
  controller.update({
    owner: "owner-A",
    ready: true,
    authenticated: true,
    marketReady: true,
    status: "connected",
    rows: [
      {
        symbol: "GAZP",
        ticker: "GAZP",
        uid: "uid-GAZP",
        name: "Gazprom",
        currency: "rub",
        step: 0.01,
        price: 11,
        previousClose: 10,
        color: "#123456",
        mark: "G"
      }
    ],
    preferences: { ...controller.getSnapshot().preferences, instrumentUid: "uid-GAZP" }
  });
  await controller.loadHistory();
  assert.equal(controller.getSnapshot().historyViewReady, true);
  assert.equal(controller.getSnapshot().loading, false);
  assert.ok(controller.getSnapshot().candles.length > 0);
  const rangeProps = () =>
    find(
      load("screens/terminal/intervals/ChartRangeControl.tsx").ChartRangeControl(),
      (node) => node.props?.id === "range"
    ).props;
  const toolbar = () => load("screens/terminal/Toolbar.tsx").Toolbar();
  let cleanup;
  const canvas = load("screens/terminal/chart-lifecycle.ts").useChartCanvas;
  const container = { current: {} };
  function remount() {
    cleanup?.();
    refIndex = 0;
    effects = [];
    canvas(container, () => [], {});
    const cleanups = effects.map((effect) => effect());
    cleanup = () => cleanups.forEach((dispose) => dispose?.());
  }
  remount();
  await until(() => controller.chart !== null, "initial actual lifecycle mount");
  const key = () => {
    const p = controller.getSnapshot().preferences;
    return `${p.symbol}:${p.timeframe}:${p.engine}:${p.rangeDays}`;
  };
  let mountedKey = key();
  const unsubscribe = controller.subscribe(() => {
    if (key() !== mountedKey) {
      mountedKey = key();
      remount();
    }
  });
  requests.length = 0;
  return {
    controller,
    hooks,
    log,
    requests,
    preferenceWrites,
    rangeProps,
    toolbar,
    remount,
    load,
    db,
    storage,
    client,
    close() {
      unsubscribe();
      cleanup?.();
      controller.dispose();
    }
  };
}

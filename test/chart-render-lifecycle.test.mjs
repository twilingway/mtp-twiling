import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function sourceModules(overrides) {
  const modules = new Map(),
    context = vm.createContext({ console, Map, Date, Math, Promise });
  function load(relative) {
    if (Object.hasOwn(overrides, relative)) return overrides[relative];
    const file = path.resolve(root, relative).replace(/\.js$/, ".ts"),
      key = path.relative(root, file).replaceAll(path.sep, "/");
    if (key === "services/storage-v2.ts" && Object.hasOwn(overrides, "services/storage.ts")) return overrides["services/storage.ts"];
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const output = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${output}\n})`).runInContext(context)(
      (specifier) =>
        Object.hasOwn(overrides, specifier)
          ? overrides[specifier]
          : load(path.relative(root, path.resolve(path.dirname(file), specifier))),
      module,
      module.exports
    );
    return module.exports;
  }
  return load;
}

test("toolbar settings preserve the live adapter/canvas/camera; hiding drawings redraws it and native appearance still updates", async () => {
  const cells = [],
    listeners = new Set(), metadata = [],
    adapters = [],
    paints = [],
    layoutWrites = [];
  let cursor = 0,
    effects = [],
    destroyed = 0,
    saves = 0,
    illegalSaves = 0,
    viewLoads = 0,
    savedView,
    nearStarts = 0,
    crosshairs = 0;
  let releaseFirstView;
  const firstView = new Promise(resolve => { releaseFirstView = resolve; });
  const equal = (a, b) =>
    a && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useRef(value) {
      const slot = cursor++;
      return (cells[slot] ??= { current: value });
    },
    useMemo(factory, deps) {
      const slot = cursor++;
      if (!equal(cells[slot]?.deps, deps)) cells[slot] = { deps, value: factory() };
      return cells[slot].value;
    },
    useEffect(action, deps) {
      const slot = cursor++,
        previous = cells[slot];
      if (!equal(previous?.deps, deps))
        effects.push(() => {
          previous?.cleanup?.();
          cells[slot] = { deps, cleanup: action() };
        });
    }
  };
  const camera = { camera: { barSpace: 1.0550660792951543, rightOffsetBars: -2 } },
    candles = [{ timestamp: 1700000000000, open: 90, high: 95, low: 85, close: 92, volume: 100 }],
    flags = { ma: false, ema: false, volume: true, mtp160: false, mtp440: false, mtp640: false };
  let state = {
    owner: "owner",
    chartRevision: 0,
    authenticated: true,
    rows: [{ symbol: "GAZP", uid: "uid" }],
    preferences: {
      symbol: "GAZP",
      timeframe: "1d",
      engine: "tradingview",
      rangeDays: 365,
      indicators: flags,
      chartSettings: {}
    },
    candles,
    drawings: [{ id: "drawing", layer: "back" }],
    preview: null,
    selectedObject: null
  };
  const controller = {
    chart: null,
    sessionKey: () => null,
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    setPreferences: async (patch, _reload, valid) => {
      await Promise.resolve();
      if (valid && !valid()) return;
      layoutWrites.push(patch);
      state = { ...state, preferences: { ...state.preferences, ...patch } };
    },
    scheduleOlderHistory() {
      nearStarts++;
    },
    setCrosshair() {
      crosshairs++;
    },
    notify(message) {
      assert.fail(message);
    }
  };
  function factory(options) {
    let currentView = camera,
      pendingView = null,
      hasData = false;
    const adapter = {
      canvas: {},
      options,
      getView: () => currentView,
      setData() {
        hasData = true;
        if (pendingView) {
          currentView = pendingView;
          pendingView = null;
        }
      },
      updateBar() {},
      updatePriceFormat(value) { metadata.push(value); },
      setView(view) {
        if (hasData) currentView = view;
        else pendingView = view;
      },
      redrawDrawings: () => options.paint({}, 800, 500, () => null, "back"),
      destroy: () => {
        destroyed++;
      }
    };
    adapters.push(adapter);
    return adapter;
  }
  const load = sourceModules({
    react: hooks,
    "screens/terminal/context.ts": { useTerminal: () => ({ controller, state }) },
    "screens/terminal/controller-bridge.ts": {
      viewKey: (p) => `${p.symbol}:${p.timeframe}:${p.engine}:${p.rangeDays}`
    },
    "charts/lightweight.ts": { makeLightweight: factory },
    "charts/kline.ts": { makeKline: factory },
    "services/chart-camera.ts": {
      loadChartView: async () => {
        viewLoads++;
        if (viewLoads === 1) await firstView;
        return savedView;
      },
      saveAdapterView: async (adapter) => {
        saves++;
        if (state.historyViewReady === false && adapter?.persistView !== false) illegalSaves++;
      }
    },
    "model/drawing-model.ts": {
      paintDrawings: (_ctx, drawings) => paints.push(drawings.map((item) => item.id))
    }
  });
  const { useChartCanvas } = load("screens/terminal/chart-lifecycle.ts"),
    ref = { current: {} },
    visible = (current) =>
      current.preferences.chartSettings.drawingTools?.drawingsHidden ? [] : current.drawings;
  async function render() {
    cursor = 0;
    effects = [];
    useChartCanvas(ref, visible);
    for (const effect of effects) effect();
    await new Promise(setImmediate);
  }
  async function tools(patch) {
    state = {
      ...state,
      preferences: {
        ...state.preferences,
        indicators: { ...flags },
        chartSettings: {
          ...state.preferences.chartSettings,
          drawingTools: {
            ...state.preferences.chartSettings.drawingTools,
            ...patch
          }
        }
      }
    };
    await render();
  }
  await render();
  assert.equal(controller.chart,null,"native factory is still awaiting its view");
  state={...state,rows:state.rows.map(row=>({...row,step:.005}))};
  await render();releaseFirstView();await new Promise(setImmediate);
  const original = controller.chart,
    canvas = original.canvas;
  assert.equal(metadata.at(-1).step,.005,"latest metadata arriving during async initialization is applied");
  const loadsBefore=viewLoads,viewBefore=original.getView();
  state={...state,rows:state.rows.map(row=>({...row,step:.000002}))};
  listeners.forEach(listener=>listener());await render();
  assert.equal(metadata.at(-1).step,.000002);assert.equal(controller.chart,original);
  assert.equal(original.getView(),viewBefore);assert.equal(viewLoads,loadsBefore);assert.equal(adapters.length,1);
  original.options.onIndicatorLayout({ volume: { heightRatio: 0.33 } });
  await new Promise(setImmediate);
  await render();
  assert.equal(layoutWrites.length, 1);
  assert.equal(state.preferences.indicatorPaneLayout.volume.heightRatio, 0.33);
  assert.equal(controller.chart, original, "pane layout cannot remount the native chart");
  for (const flag of ["backupBusy", "importingBackup", "importRecoveryRequired"]) {
    const previous = state[flag];
    state = { ...state, [flag]: true };
    original.options.onIndicatorLayout({ volume: { heightRatio: 0.7 } });
    state = { ...state, [flag]: previous };
  }
  original.retired = true;
  original.options.onIndicatorLayout({ volume: { heightRatio: 0.7 } });
  original.retired = false;
  await new Promise(setImmediate);
  assert.equal(layoutWrites.length, 1);
  // Pane dimensions are UI preferences, even before history/camera restoration is ready.
  state = { ...state, candles: [], historyViewReady: false };
  original.persistView = false;
  original.options.onIndicatorLayout({ volume: { heightRatio: 0.41 } });
  await new Promise(setImmediate);
  assert.equal(layoutWrites.length, 2);
  assert.equal(state.preferences.indicatorPaneLayout.volume.heightRatio, 0.41);
  assert.equal(original.persistView, false, "pane writes cannot enable camera persistence");
  // A transfer/source change after the async write starts must still invalidate it.
  for (const patch of [
    { backupBusy: true },
    { importingBackup: true },
    { importRecoveryRequired: true },
    { owner: "different-owner" },
    { chartRevision: state.chartRevision + 1 },
    { rows: [{ symbol: "GAZP", uid: "different-uid" }] },
    { preferences: { ...state.preferences, symbol: "SBER" } }
  ]) {
    const previous = state;
    original.options.onIndicatorLayout({ volume: { heightRatio: 0.7 } });
    state = { ...state, ...patch };
    await new Promise(setImmediate);
    assert.equal(layoutWrites.length, 2);
    state = previous;
  }
  original.options.onIndicatorLayout({ volume: { heightRatio: 0.7 } });
  original.retired = true;
  await new Promise(setImmediate);
  assert.equal(layoutWrites.length, 2);
  original.retired = false;
  state = { ...state, candles, historyViewReady: true };
  original.persistView = true;
  for (let i = 0; i < 5; i++) {
    await tools({ lastTools: { lines: i % 2 ? "segment" : "rayLine" } });
    await tools({
      magnet: i % 2 ? "off" : "strong",
      stayInDrawingMode: i % 2 === 0,
      favorites: i % 2 ? [] : ["segment"],
      snapIndicators: i % 2 === 0
    });
  }
  await tools({
    drawingsLocked: true,
    hideTarget: "drawings",
    lockTarget: "all",
    deleteLocked: true
  });
  state = {
    ...state,
    preferences: {
      ...state.preferences,
      chartSettings: {
        ...state.preferences.chartSettings,
        showLegend: false,
        legendCollapsed: true,
        showCandleCountdown: false,
        drawingTemplates: { default: { settings: { color: "#ff0000" } } }
      }
    }
  };
  await render();
  assert.equal(adapters.length, 1);
  assert.equal(destroyed, 0);
  assert.equal(saves, 0);
  assert.equal(controller.chart, original);
  assert.equal(controller.chart.canvas, canvas);
  assert.equal(controller.chart.getView(), camera);
  assert.equal(state.chartRevision, 0, "toolbar actions do not invalidate the canvas revision");
  await tools({ drawingsHidden: true });
  assert.equal(paints.at(-1).length, 0);
  await tools({ drawingsHidden: false });
  assert.equal(paints.at(-1).join(","), "drawing");
  assert.equal(controller.chart, original);
  state = {
    ...state,
    preferences: {
      ...state.preferences,
      chartSettings: { ...state.preferences.chartSettings, upColor: "#123456" }
    }
  };
  await render();
  assert.equal(adapters.length, 2);
  assert.equal(adapters.at(-1).options.indicatorPaneLayout.volume.heightRatio, 0.41);
  assert.equal(adapters.at(-1).options.settings.upColor, "#123456");
  state = {
    ...state,
    preferences: {
      ...state.preferences,
      chartSettings: { ...state.preferences.chartSettings, theme: "light" }
    }
  };
  await render();
  assert.equal(adapters.length, 3);
  assert.equal(adapters.at(-1).options.settings.theme, "light");
  await tools({ indicatorsHidden: true });
  assert.equal(adapters.length, 4);
  assert.equal(adapters.at(-1).options.indicators.volume, false);

  // Same layout and source: importing A must replace a live, manually panned B.
  const outgoing = controller.chart,
    importedA = { camera: { barSpace: 22.557140114844522, rightOffsetBars: 1.8495886 } },
    pannedB = { camera: { barSpace: 22.557140114844522, rightOffsetBars: -7.01678 } },
    beforeImportAdapters = adapters.length,
    beforeImportLoads = viewLoads,
    beforePaints = paints.length;
  outgoing.setView(pannedB);
  assert.equal(outgoing.getView(), pannedB);
  outgoing.persistView = false;
  savedView = importedA;
  state = {
    ...state,
    chartRevision: state.chartRevision + 1,
    candles: [],
    historyViewReady: false
  };
  outgoing.options.onNearStart();
  outgoing.options.onCrosshair(candles[0]);
  outgoing.options.onIndicatorLayout({ volume: { heightRatio: 0.7 } });
  assert.equal(layoutWrites.length, 2, "old-revision drag callbacks cannot write after import");
  outgoing.options.paint({}, 800, 500, () => null, "back");
  assert.equal(nearStarts, 0);
  assert.equal(crosshairs, 0);
  assert.equal(
    paints.length,
    beforePaints,
    "old revision callbacks are rejected before effect cleanup"
  );
  await render();
  assert.notEqual(controller.chart, outgoing);
  assert.equal(adapters.length, beforeImportAdapters + 1);
  assert.equal(viewLoads, beforeImportLoads + 1);
  state = { ...state, candles: [...candles] };
  await render();
  assert.equal(controller.chart.persistView, false, "partial progress must not replace target A");
  assert.notEqual(controller.chart.getView(), importedA, "A waits for restored window coverage");
  state = { ...state, historyViewReady: true };
  await render();
  assert.equal(controller.chart.persistView, true);
  assert.equal(
    controller.chart.getView(),
    importedA,
    "incoming A must apply without a page reload"
  );
  assert.equal(adapters.length, beforeImportAdapters + 1);
  assert.equal(
    viewLoads,
    beforeImportLoads + 1,
    "data arrival must not initialize a second imported adapter"
  );
  await tools({ magnet: "weak" });
  assert.equal(state.chartRevision, 1);
  assert.equal(adapters.length, beforeImportAdapters + 1);
  assert.equal(controller.chart.getView(), importedA);
  state = {
    ...state,
    historyViewReady: false,
    preferences: {
      ...state.preferences,
      chartSettings: { ...state.preferences.chartSettings, scaleFontSize: 12 }
    }
  };
  await render();
  assert.equal(
    illegalSaves,
    0,
    "native remount cleanup cannot save while saved history is pending"
  );
});

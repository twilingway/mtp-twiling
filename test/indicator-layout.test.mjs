import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function sources(overrides = {}, globals = {}) {
  const cells = new Map(),
    context = vm.createContext({ console, Date, Map, Math, Promise, queueMicrotask, ...globals });
  function load(relative) {
    let filename = path.resolve(root, relative).replace(/\.js$/, ".ts");
    if (!existsSync(filename) && filename.endsWith(".ts")) filename = filename + "x";
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
const json = (value) => JSON.parse(JSON.stringify(value));
const model = sources()("model/indicator-layout.ts");
test("pane ratios validate optional legacy layouts, finite bounds and native dimensions", () => {
  for (const ratio of [0.05, 0.32, 0.8])
    assert.equal(model.isIndicatorPaneLayout({ volume: { heightRatio: ratio } }), true);
  for (const ratio of [0, 0.049, 0.801, -1, null, ".3", NaN, Infinity])
    assert.equal(model.isIndicatorPaneLayout({ volume: { heightRatio: ratio } }), false);
  for (const value of [
    [],
    null,
    { volume: {} },
    { volume: { heightRatio: 0.3, hidden: true } },
    { other: { heightRatio: 0.3 } }
  ])
    assert.equal(model.isIndicatorPaneLayout(value), false);
  assert.equal(model.isIndicatorPaneLayout({}), true);
  assert.equal(model.volumeHeightRatio(undefined), null);
  assert.equal(model.volumePaneHeight(null, 600), 95);
  assert.equal(model.volumePaneHeight(0.3, 600), 180);
  assert.equal(model.capturedVolumeRatio(180, 420), 0.3);
  assert.equal(model.capturedVolumeRatio(1, 999), 0.05);
  assert.equal(model.capturedVolumeRatio(990, 10), 0.8);
  assert.equal(model.capturedVolumeRatio(0, 0), null);
});
test("collapse and pane layout do not change native render config or indicator flags", () => {
  const load = sources(),
    key = load("charts/render-config.ts").chartRenderConfigKey;
  const flags = Object.freeze({
    ma: true,
    ema: false,
    volume: true,
    mtp160: true,
    mtp440: false,
    mtp640: false
  });
  const settings = Object.freeze({ showLegend: true });
  assert.equal(key(settings, flags), key({ ...settings, legendCollapsed: true }, flags));
  const list = load("model/indicator-legend.ts").indicatorLegendKeys;
  assert.deepEqual(
    json(list(settings, flags)),
    json(list({ ...settings, legendCollapsed: true }, flags))
  );
  const backup = load("model/backup-format.ts");
  assert.equal(
    backup.isProfilePreferences({
      indicatorPaneLayout: { volume: { heightRatio: 0.3 } },
      chartSettings: { legendCollapsed: true }
    }),
    true
  );
  assert.equal(backup.isProfilePreferences({ chartSettings: { legendCollapsed: "false" } }), false);
  assert.equal(backup.isProfilePreferences({}), true);
});
test("native pane capture waits for adjusted MAIN bounds, ignores programmatic restore and preserves ratio on resize", () => {
  const microtasks = [],
    changes = [],
    writes = [],
    actions = new Map();
  let volume = 100,
    price = 400;
  const chart = {
    getSize: (pane) => ({ height: pane === "volume_pane" ? volume : price }),
    setPaneOptions: (options) => {
      writes.push(options);
      const total = volume + price;
      volume = options.height;
      price = total - volume;
    },
    subscribeAction: (type, callback) => actions.set(type, callback),
    unsubscribeAction: (type) => actions.delete(type)
  };
  const load = sources(
    { klinecharts: { ActionType: { OnPaneDrag: "drag" }, DomPosition: { Main: "main" } } },
    { queueMicrotask: (callback) => microtasks.push(callback) }
  );
  const pane = load("charts/kline-pane-layout.ts").attachVolumePaneLayout(chart, {
    enabled: true,
    layout: { volume: { heightRatio: 0.3 } },
    onChange: (layout) => changes.push(layout)
  });
  pane.apply();
  assert.equal(volume, 150);
  assert.equal(changes.length, 0);
  actions.get("drag")({ paneId: "" });
  assert.equal(changes.length, 0, "MAIN geometry is stale inside native OnPaneDrag");
  volume = 200;
  price = 300;
  microtasks.shift()();
  assert.equal(changes[0].volume.heightRatio, 0.4);
  volume = 200;
  price = 800;
  pane.apply();
  assert.equal(volume, 400);
  assert.equal(changes.length, 1);
  const previous = writes.length;
  pane.apply();
  assert.equal(writes.length, previous, "programmatic restore has no feedback loop");
  actions.get("drag")({ paneId: "volume_pane" });
  pane.dispose();
  volume = 500;
  price = 500;
  microtasks.shift()();
  assert.equal(changes.length, 1);
  assert.equal(actions.size, 0);
});
function nativeFixture({ ratio = 0.3, volume = true } = {}) {
  const created = [],
    removed = [],
    actions = new Map(),
    changes = [];
  let data = [],
    volumeHeight = 0,
    priceHeight = 500,
    resize;
  const chart = {
    setPaneOptions: (options) => {
      if (options.id === "volume_pane") {
        const total = priceHeight + volumeHeight;
        volumeHeight = options.height;
        priceHeight = total - volumeHeight;
      }
    },
    setPriceVolumePrecision() {},
    getSize: (pane) =>
      pane === "volume_pane"
        ? volumeHeight
          ? { height: volumeHeight, width: 800 }
          : null
        : { height: priceHeight, width: 800 },
    resize() {},
    subscribeAction: (type, callback) => actions.set(type, callback),
    unsubscribeAction: (type) => actions.delete(type),
    createIndicator: (value, _stack, options) => {
      const name = typeof value === "string" ? value : value.name;
      created.push({ name, options });
      if (name === "VOL") {
        volumeHeight = options.height;
        priceHeight = 500 - volumeHeight;
      }
      return options.id;
    },
    removeIndicator: (...args) => removed.push(args),
    applyNewData: (next) => {
      data = next;
    },
    getDataList: () => data,
    updateData() {},
    overrideIndicator() {},
    getBarSpace: () => 8,
    getOffsetRightDistance: () => 64,
    setBarSpace() {},
    scrollToRealTime() {},
    setOffsetRightDistance() {},
    scrollByDistance() {},
    convertToPixel: (input) =>
      Array.isArray(input)
        ? input.map((point) => ({ x: point.dataIndex * 8, y: 100 }))
        : { x: input.dataIndex * 8 },
    convertFromPixel: (input) => input.map(() => ({ dataIndex: 0, value: 10 })),
    getVisibleRange: () => ({ from: 0, to: data.length })
  };
  const api = {
    ActionType: {
      OnPaneDrag: "drag",
      OnDataReady: "ready",
      OnZoom: "zoom",
      OnScroll: "scroll",
      OnVisibleRangeChange: "range",
      OnCrosshairChange: "crosshair"
    },
    DomPosition: { Main: "main" },
    IndicatorSeries: { Price: "price" },
    TooltipShowRule: { None: "none" },
    LineType: { Solid: 0 },
    init: () => chart,
    registerIndicator() {},
    registerXAxis() {},
    dispose() {}
  };
  const load = sources(
    {
      klinecharts: api,
      "model/mtp.ts": {
        MtpModel: class {
          reset() {}
          update() {}
        },
        activeMtpPeriods: () => []
      }
    },
    {
      ResizeObserver: class {
        constructor(callback) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
      devicePixelRatio: 1,
      document: {
        createElement: () => ({
          style: {},
          getContext: () => ({ setTransform() {}, clearRect() {} }),
          remove() {}
        })
      }
    }
  );
  const adapter = load("charts/kline.ts").makeKline({
    container: { clientWidth: 870, clientHeight: 528, parentElement: { append() {} } },
    row: { symbol: "X", step: 1 },
    timeframe: "1d",
    rangeDays: 365,
    settings: {},
    indicators: { ma: true, ema: true, volume },
    indicatorPaneLayout: { volume: { heightRatio: ratio } },
    onIndicatorLayout: (layout) => changes.push(layout),
    onNearStart() {},
    onCrosshair() {},
    paint() {}
  });
  return {
    adapter,
    created,
    removed,
    actions,
    changes,
    volume: () => volumeHeight,
    resize: () => resize(),
    drag: (height) => {
      actions.get("drag")({ paneId: "" });
      volumeHeight = height;
      priceHeight = 500 - height;
    }
  };
}
test("production KLine adapter creates VOL once and keeps real dragged height across every full history replacement", async () => {
  const f = nativeFixture();
  assert.equal(f.volume(), 150);
  const bar = (index) => ({
    timestamp: Date.UTC(2024, 0, index + 1),
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    volume: 3
  });
  for (let index = 1; index <= 4; index++)
    f.adapter.setData(
      Array.from({ length: index }, (_, i) => bar(i)),
      false
    );
  assert.equal(f.created.filter((item) => item.name === "VOL").length, 1);
  assert.equal(f.removed.length, 0);
  f.drag(200);
  await Promise.resolve();
  assert.equal(f.changes[0].volume.heightRatio, 0.4);
  f.adapter.setData([bar(0), bar(1)], false);
  assert.equal(f.volume(), 200);
  assert.equal(f.created.filter((item) => item.name === "MA").length, 1);
  assert.equal(f.created.filter((item) => item.name === "EMA").length, 1);
  const hidden = nativeFixture({ ratio: 0.4, volume: false });
  assert.equal(
    hidden.created.some((item) => item.name === "VOL"),
    false
  );
  const shown = nativeFixture({ ratio: 0.4 });
  assert.equal(shown.volume(), 200);
  shown.adapter.destroy();
  hidden.adapter.destroy();
  f.adapter.destroy();
});
test("legend collapse exposes an accessible compact count without toggling indicators and follows the dynamic price heading", async () => {
  const jsx = (type, props) => ({ type, props });
  const flags = Object.freeze({
    volume: true,
    ma: true,
    ema: false,
    mtp160: true,
    mtp440: false,
    mtp640: false
  });
  let state = {
    owner: "owner",
    chartRevision: 0,
    authenticated: true,
    loading: false,
    candles: [],
    rows: [{ symbol: "SBER", uid: "uid", step: 0.01 }],
    preferences: {
      symbol: "SBER",
      timeframe: "1d",
      engine: "kline",
      rangeDays: 365,
      indicators: flags,
      chartSettings: {}
    }
  };
  let toggles = 0;
  const controller = {
    getSnapshot: () => state,
    setPreferences: async (patch, _reload, valid) => {
      await Promise.resolve();
      if (!valid || valid()) state = { ...state, preferences: { ...state.preferences, ...patch } };
    },
    toggleIndicator: () => {
      toggles++;
    },
    notify: (message) => assert.fail(message)
  };
  const load = sources({
    react: { memo: (component) => component },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "services/storage-db.ts": {},
    "screens/terminal/context.tsx": { useTerminal: () => ({ state, controller }) }
  });
  const Legend = load("screens/terminal/IndicatorLegend.tsx").IndicatorLegend;
  const expanded = Legend(),
    button = expanded.props.children[1];
  assert.equal(button.props["aria-expanded"], true);
  button.props.onClick();
  await new Promise(setImmediate);
  const collapsed = Legend();
  assert.equal(collapsed.props.children[0].props.hidden, true);
  assert.equal(collapsed.props.children[1].props["aria-expanded"], false);
  assert.match(collapsed.props.children[1].props["aria-label"], /\(5\)/);
  assert.equal(state.preferences.indicators, flags);
  assert.equal(toggles, 0);
  const Panel = load("screens/terminal/ChartPanel.tsx").ChartPanel,
    tree = Panel();
  const heading = tree.props.children.find((child) => child?.props?.className === "chart-heading");
  assert.equal(heading.props.children.at(-1).type, Legend);
  assert.equal(heading.props.children.at(-2).props.className, "chart-price");
});

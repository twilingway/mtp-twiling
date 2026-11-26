import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";
import { nativeSdk } from "./ta-render-kline-fixture.mjs";

const installed = readFileSync(
  new URL("../node_modules/klinecharts/dist/index.esm.js", import.meta.url),
  "utf8"
);
const enumStart = installed.indexOf("var ActionType;");
const enumEnd =
  installed.indexOf("})(ActionType || (ActionType = {}));", enumStart) +
  "})(ActionType || (ActionType = {}));".length;
const ActionType = vm.runInNewContext(installed.slice(enumStart, enumEnd) + "\nActionType");

/** Actual native Store/ChartImp/YAxis methods; only DOM, clock, styles and viewport boundary controlled. */
export function inactiveFixture(quotePrecision = 2, { baseline = false } = {}) {
  const sdk = nativeSdk();
  sdk.ActionType = ActionType;
  const pending = [],
    frames = new Map(),
    actions = new Map(),
    calls = [],
    destroyed = [],
    deferred = [];
  let sequence = 0,
    alive = true,
    hold = false,
    compiled = { groups: [], outputs: [], fills: [] },
    compiles = 0;
  let range = { from: 0, to: 8, realFrom: 0, realTo: 8 };
  const bars = Array.from({ length: 8 }, (_, i) => ({
    timestamp: (i + 1) * 1000,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1
  }));
  const styles = {
    candle: { type: "candle_solid", area: { value: "close" } },
    indicator: {
      lines: [{ color: "#123456", size: 1 }],
      bars: [{ noChangeColor: "#123456" }],
      circles: [{ noChangeColor: "#123456" }]
    },
    xAxis: { tickText: { size: 12 } },
    grid: { show: false, horizontal: { show: false }, vertical: { show: false } }
  };
  const boundary = {
    _precision: { price: quotePrecision, volume: 0 },
    getPrecision: sdk.ChartStore.prototype.getPrecision,
    setPrecision: sdk.ChartStore.prototype.setPrecision,
    getDataList: () => bars,
    getVisibleDataList: () =>
      bars
        .map((data, dataIndex) => ({ data, dataIndex }))
        .filter((v) => v.dataIndex >= range.realFrom && v.dataIndex < range.realTo),
    getStyles: () => styles,
    getCustomApi: () => ({}),
    getThousandsSeparator: () => "",
    getDecimalFoldThreshold: () => 99,
    getTimeScaleStore: () => ({
      getVisibleRange: () => range,
      getBarSpace: () => ({ bar: 10, gapBar: 8, halfBar: 5, halfGapBar: 4 })
    })
  };
  const store = new sdk.IndicatorStore(boundary);
  boundary._indicatorStore = store;
  boundary.getIndicatorStore = () => store;
  for (const name of ["addInstance", "override"]) {
    const native = store[name].bind(store);
    store[name] = (...args) => {
      const p = native(...args);
      pending.push(p);
      return p;
    };
  }
  const register = sdk.registerIndicator;
  sdk.registerIndicator = (value) =>
    register({
      ...value,
      calc: (...args) => {
        const result = value.calc(...args);
        return hold ? new Promise((resolve) => deferred.push(() => resolve(result))) : result;
      }
    });
  const chart = {
    _chartStore: boundary,
    _drawPanes: [],
    _separatorPanes: new Map(),
    getChartStore: () => boundary,
    getStyles: () => styles,
    getPriceVolumePrecision: sdk.ChartImp.prototype.getPriceVolumePrecision,
    setPriceVolumePrecision: sdk.ChartImp.prototype.setPriceVolumePrecision,
    getIndicatorByPaneId: sdk.ChartImp.prototype.getIndicatorByPaneId,
    getDataList: () => bars,
    getVisibleRange: () => range,
    getDrawPaneById(id) {
      return chart._drawPanes.find((p) => p.getId() === id) ?? null;
    },
    _createPane(_klass, id, options) {
      const pane = {
        id,
        height: options.height ?? 200,
        getId: () => id,
        getChart: () => chart,
        getOptions: () => ({ gap: { top: 0, bottom: 0 } }),
        getYAxisWidget: () => ({ getBounding: () => ({ height: pane.height, width: 80 }) }),
        setBounding(value) {
          if (value.height !== undefined) pane.height = value.height;
        },
        destroy() {
          destroyed.push(id);
        }
      };
      pane.axis = {
        getParent: () => pane,
        isInCandle: () => id === "candle_pane",
        getType: () => "normal",
        isReverse: () => false,
        getRange: () => sdk.YAxisImp.prototype.calcRange.call(pane.axis),
        buildTicks() {
          return true;
        }
      };
      pane.axis._innerConvertToPixel = sdk.YAxisImp.prototype._innerConvertToPixel;
      pane.getAxisComponent = () => pane.axis;
      pane.dom = {
        getBoundingClientRect: () => ({
          left: 0,
          top: chart._drawPanes
            .slice(0, chart._drawPanes.indexOf(pane))
            .reduce((s, p) => s + p.height + 1, 0),
          width: 300,
          height: pane.height
        })
      };
      chart._drawPanes.push(pane);
      return pane;
    },
    _setPaneOptions(value) {
      chart.setPaneOptions(value);
    },
    setPaneOptions(value) {
      calls.push(["pane", value]);
      const p = chart.getDrawPaneById(value.id);
      if (p && value.height !== undefined) p.height = value.height;
    },
    adjustPaneViewport() {
      calls.push(["native-adjust"]);
    },
    createIndicator(...args) {
      calls.push(["create", args[0].name, args[2]?.id]);
      return sdk.ChartImp.prototype.createIndicator.apply(chart, args);
    },
    overrideIndicator(...args) {
      calls.push(["override", args[0].name, args[1], Object.keys(args[0])]);
      return sdk.ChartImp.prototype.overrideIndicator.apply(chart, args);
    },
    removeIndicator(...args) {
      calls.push(["remove", ...args]);
      return sdk.ChartImp.prototype.removeIndicator.apply(chart, args);
    },
    getDom(id) {
      return chart.getDrawPaneById(id)?.dom ?? null;
    },
    getSize(id) {
      return id === "x_axis_pane"
        ? { height: 25, width: 300 }
        : { height: chart.getDrawPaneById(id)?.height ?? 0, width: 300 };
    },
    subscribeAction(type, fn) {
      if (!actions.has(type)) actions.set(type, new Set());
      actions.get(type).add(fn);
    },
    unsubscribeAction(type, fn) {
      actions.get(type)?.delete(fn);
    }
  };
  chart._createPane(null, "candle_pane", {});
  const clock = {
    requestAnimationFrame: (fn) => {
      frames.set(++sequence, fn);
      return sequence;
    },
    cancelAnimationFrame: (id) => frames.delete(id)
  };
  globalThis.__inactiveNativeFrames = clock;
  const load = createSourceLoader(
    {
      klinecharts: sdk,
      "charts/technical-render-data.js": {
        TechnicalRenderData: class {
          setData() {}
          compile() {
            compiles++;
            return compiled;
          }
          dispose() {}
        }
      },
      "charts/technical-pane-events.js": {
        attachTechnicalPaneEvents: () => ({
          observe() {},
          cancel() {},
          dispose() {},
          dragging: () => false
        })
      }
    },
    (_r, file) => {
      const s =
        baseline && file.endsWith("kline-technical.ts")
          ? process.env.KLINE_INACTIVE_BASELINE_SOURCE
            ? readFileSync(process.env.KLINE_INACTIVE_BASELINE_SOURCE, "utf8")
            : execFileSync(
                "git",
                ["show", "88d3509171fa4e690abec2267bdb8793d43813dd:src/charts/kline-technical.ts"],
                { encoding: "utf8" }
              )
          : readFileSync(file, "utf8");
      return /kline-(technical|native-members)\.ts$/.test(file)
        ? "const requestAnimationFrame=globalThis.__inactiveNativeFrames.requestAnimationFrame,cancelAnimationFrame=globalThis.__inactiveNativeFrames.cancelAnimationFrame;\n" +
            s
        : s;
    }
  );
  const adapter = load("charts/kline-technical.js").klineTechnical(
    chart,
    {
      timeframe: "1d",
      indicators: { volume: false },
      container: { clientHeight: 400, clientWidth: 300, getBoundingClientRect: () => ({ top: 0 }) }
    },
    () => alive,
    () => null
  );
  delete globalThis.__inactiveNativeFrames;
  return {
    sdk,
    chart,
    store,
    bars,
    calls,
    frames,
    actions,
    destroyed,
    adapter,
    load,
    compiles: () => compiles,
    entries: (id = "technical:mixed") => Array.from(store.getInstances(id)),
    async peer(
      precision = 6,
      series = sdk.IndicatorSeries.Normal,
      locked = false,
      values = bars.map((_, i) => 1 + (i + 1) * 1e-6)
    ) {
      const name = `LAB_${series}_${precision}_${locked}`;
      sdk.registerIndicator({
        name,
        series,
        figures: [{ key: "peer", type: "line" }],
        calc: () => values.map((peer) => ({ peer }))
      });
      chart.createIndicator(
        {
          name,
          ...(series === sdk.IndicatorSeries.Normal || locked ? { precision } : {}),
          visible: true
        },
        true,
        { id: "technical:mixed" }
      );
      await this.ready();
      if (locked) {
        chart.overrideIndicator({ name, precision: precision === 7 ? 6 : 7 }, "technical:mixed");
        chart.overrideIndicator({ name, precision }, "technical:mixed");
        await this.ready();
      }
      chart.getDrawPaneById("technical:mixed").height = load("charts/kline-pane-geometry.js")
        .klinePaneGeometry(400, [{ key: "pane:mixed", instances: [] }], null, 25)
        .find((p) => p.key === "pane:mixed").height;
      return name;
    },
    set(value) {
      compiled = value;
      adapter.update(
        value.groups.flatMap((g) => g.instances),
        value.groups.flatMap((g) => (g.preference ? [g.preference] : []))
      );
    },
    viewport(first, end) {
      range = {
        from: Math.max(0, first),
        to: Math.min(bars.length, end),
        realFrom: first,
        realTo: end
      };
      this.emit(ActionType.OnVisibleRangeChange);
    },
    emit(type) {
      for (const f of actions.get(type) ?? []) f();
    },
    sample(id = "technical:mixed") {
      const pane = chart.getDrawPaneById(id),
        axis = pane.axis;
      const result = JSON.parse(JSON.stringify(axis.getRange()));
      const ticks = JSON.parse(
        JSON.stringify(sdk.YAxisImp.prototype.optimalTicks.call(axis, [{ value: "1.0000045" }]))
      );
      return { range: result, ticks, dom: pane.dom, height: pane.height };
    },
    hold(value = true) {
      hold = value;
    },
    release() {
      hold = false;
      for (const resolve of deferred.splice(0)) resolve();
    },
    async ready() {
      while (pending.length) await Promise.all(pending.splice(0));
    },
    flush() {
      for (let i = 0; frames.size && i < 20; i++) {
        const batch = [...frames.values()];
        frames.clear();
        for (const f of batch) f();
      }
      if (frames.size) throw new Error("unbounded frame loop");
    },
    dispose() {
      adapter.dispose();
      alive = false;
    },
    retire() {
      alive = false;
    }
  };
}

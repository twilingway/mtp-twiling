import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const require = createRequire(import.meta.url);
const installed = fs.readFileSync(
  join(dirname(require.resolve("klinecharts")), "index.esm.js"),
  "utf8"
);
if (
  createHash("sha256").update(installed).digest("hex") !==
  "313a26786af901e2b5b93c16ac002c6ceeebb54ecc9b6a55e386f1b31805ca5d"
)
  throw new Error(
    "Re-review KLine 9.8.12 native figure/precision/layer SPI before updating this pin"
  );
export function nativeSdk() {
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    process: { env: { NODE_ENV: "test" } }
  });
  vm.runInContext(
    installed.replace(/^export \{[^\n]+\};$/m, "") +
      "\nglobalThis.sdk={IndicatorStore,IndicatorImp,YAxisImp,IndicatorView,IndicatorTooltipView,IndicatorLastValueView,GridView,ChartStore,ChartImp,IndicatorSeries,DomPosition,LineType,PolygonType,registerFigure,registerIndicator,registerYAxis,getYAxisClass,getIndicatorClass,getFigureClass,getSupportedIndicators,eachFigures};",
    context
  );
  return context.sdk;
}
export function recordingContext() {
  const calls = [];
  const ctx = new Proxy(
    { calls },
    {
      get(target, key) {
        if (key in target) return target[key];
        return (...args) =>
          calls.push([
            key,
            ...args,
            ...(key === "fill"
              ? [target.fillStyle, target.globalCompositeOperation]
              : key === "stroke"
                ? [target.strokeStyle, target.globalCompositeOperation]
                : [])
          ]);
      },
      set(target, key, value) {
        target[key] = value;
        calls.push(["set", key, value]);
        return true;
      }
    }
  );
  return ctx;
}
export function klineFixture(initialPrecision = 6) {
  const sdk = nativeSdk(),
    pending = [],
    frames = new Map(),
    calls = [],
    descriptors = [],
    panes = new Map();
  let compiled = { groups: [], outputs: [], fills: [] },
    frameId = 0,
    live = true;
  const bars = Array.from({ length: 8 }, (_, i) => ({
    timestamp: i + 1,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1
  }));
  let visibleFrom = 0,
    visibleTo = bars.length - 1;
  const storeBoundary = {
    _precision: { price: initialPrecision, volume: 0 },
    getPrecision: sdk.ChartStore.prototype.getPrecision,
    setPrecision: sdk.ChartStore.prototype.setPrecision,
    getDataList: () => bars,
    getIndicatorStore: () => store,
    getVisibleDataList: () =>
      bars
        .map((data, dataIndex) => ({ dataIndex, data }))
        .filter(({ dataIndex }) => dataIndex >= visibleFrom && dataIndex <= visibleTo),
    getTimeScaleStore: () => ({
      getVisibleRange: () => ({ from: 0, to: bars.length, realFrom: 0, realTo: bars.length }),
      getBarSpace: () => ({ bar: 10, halfBar: 5, gapBar: 8, halfGapBar: 4 })
    }),
    getStyles: () => ({
      indicator: {
        lines: [{ color: "#123456", size: 1 }],
        bars: [{ noChangeColor: "#123456" }],
        circles: [{ noChangeColor: "#123456" }]
      }
    })
  };
  const store = new sdk.IndicatorStore(storeBoundary);
  storeBoundary._indicatorStore = store;
  const dom = () => ({
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 300, height: 200 })
  });
  panes.set("candle_pane", dom());
  const chart = {
    getDom: (id) => panes.get(id) ?? null,
    getSize: () => ({ width: 300, height: 200 }),
    setPaneOptions() {},
    createIndicator(value, stack, options, done) {
      descriptors.push({ phase: "create", value });
      panes.set(options.id, dom());
      const promise = store.addInstance(value, options.id, stack).then(() => done?.());
      pending.push(promise);
      return options.id;
    },
    overrideIndicator(value, paneId, done) {
      descriptors.push({ phase: "override", value });
      pending.push(store.override(value, paneId).then(() => done?.()));
    },
    removeIndicator(paneId, name) {
      calls.push(["remove", paneId, name]);
      store.removeInstance(paneId, name);
    },
    getChartStore: () => storeBoundary,
    getStyles: () => ({
      candle: { type: "candle_solid", area: { value: "close" } },
      grid: {
        show: true,
        horizontal: { show: true, color: "#GRID", size: 1, style: "solid" },
        vertical: { show: false }
      }
    })
  };
  const globals = {
    requestAnimationFrame: (callback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id) => frames.delete(id)
  };
  const load = createSourceLoader(
    {
      klinecharts: sdk,
      "charts/technical-pane-events.js": {
        attachTechnicalPaneEvents: () => ({
          cancel() {},
          observe() {},
          dispose() {},
          dragging: () => false
        })
      },
      "charts/technical-render-data.js": {
        TechnicalRenderData: class {
          setData() {}
          compile() {
            return compiled;
          }
          dispose() {}
        }
      }
    },
    (_relative, file) => {
      const source = fs.readFileSync(file, "utf8");
      return file.endsWith("kline-technical.ts")
        ? "const requestAnimationFrame=globalThis.__klineTestFrames.requestAnimationFrame,cancelAnimationFrame=globalThis.__klineTestFrames.cancelAnimationFrame;\n" +
            source
        : source;
    }
  );
  globalThis.__klineTestFrames = globals;
  const { klineTechnical } = load("charts/kline-technical.js");
  delete globalThis.__klineTestFrames;
  const adapter = klineTechnical(
    chart,
    {
      timeframe: "1d",
      indicators: { volume: false },
      container: { clientHeight: 400, clientWidth: 300, getBoundingClientRect: () => ({ top: 0 }) }
    },
    () => live,
    () => null,
    () => {},
    () => calls.push(["refresh"])
  );
  const rootPane = (id) => ({
    getChart: () => chart,
    getId: () => id,
    getOptions: () => ({ gap: { top: 0, bottom: 0 } }),
    getYAxisWidget: () => ({ getBounding: () => ({ height: 200 }) })
  });
  function range(paneId = "candle_pane") {
    return sdk.YAxisImp.prototype.calcRange.call({
      getParent: () => rootPane(paneId),
      isInCandle: () => paneId === "candle_pane",
      getType: () => "normal"
    });
  }
  return {
    sdk,
    chart,
    store,
    descriptors,
    calls,
    load,
    frames,
    range,
    bars,
    entries: (pane = "candle_pane") => Array.from(store.getInstances(pane)),
    set(next) {
      compiled = next;
      adapter.update(
        next.groups.flatMap((group) => group.instances),
        []
      );
    },
    precision(value) {
      sdk.ChartImp.prototype.setPriceVolumePrecision.call({ _chartStore: storeBoundary }, value, 0);
    },
    paint(ctx = recordingContext()) {
      const params = this.params(null, ctx),
        pane = {
          ...rootPane("candle_pane"),
          getAxisComponent: () => ({ ...params.yAxis, getTicks: () => [{ coord: 50 }] })
        },
        widget = { getPane: () => pane, getBounding: () => params.bounding };
      chart.getXAxisPane = () => ({ getAxisComponent: () => params.xAxis });
      const facade = {
        getWidget: () => widget,
        getCandleBarOptions: () => null,
        eachChildren: (paint) =>
          storeBoundary
            .getVisibleDataList()
            .forEach((row) =>
              paint({ ...row, x: params.xAxis.convertToPixel(row.dataIndex) }, params.barSpace)
            ),
        createFigure: ({ name, ...options }) => new (sdk.getFigureClass(name))(options)
      };
      sdk.IndicatorView.prototype.drawImp.call(facade, ctx);
      sdk.GridView.prototype.drawImp.call(facade, ctx);
      return ctx.calls;
    },
    viewport(from, to) {
      visibleFrom = from;
      visibleTo = to;
    },
    tooltip(indicator, index = bars.length - 1) {
      const styles = {
        ...storeBoundary.getStyles().indicator,
        tooltip: { showName: false, showParams: false, icons: [], defaultValue: "-" }
      };
      return sdk.IndicatorTooltipView.prototype.getIndicatorTooltipData.call(
        {},
        bars,
        { dataIndex: index },
        indicator,
        {},
        ",",
        3,
        styles
      );
    },
    axisLabels(paneId) {
      const text = [],
        original = storeBoundary.getStyles;
      storeBoundary.getCustomApi = () => ({});
      storeBoundary.getThousandsSeparator = () => ",";
      storeBoundary.getDecimalFoldThreshold = () => 3;
      storeBoundary.getStyles = () => ({
        indicator: { ...original().indicator, lastValueMark: { show: true, text: {} } }
      });
      const pane = {
        getId: () => paneId,
        getChart: () => chart,
        getAxisComponent: () => ({ convertToNicePixel: (value) => value, isFromZero: () => false })
      };
      sdk.IndicatorLastValueView.prototype.drawImp.call(
        {
          getWidget: () => ({ getPane: () => pane, getBounding: () => ({ width: 60 }) }),
          createFigure: (value) => ({ draw: () => text.push(value.attrs.text) })
        },
        recordingContext()
      );
      storeBoundary.getStyles = original;
      return text;
    },
    crosshair(paneId, index = bars.length - 1) {
      let value;
      storeBoundary.getActionStore = () => ({
        has: () => true,
        execute: (_action, event) => {
          value = event;
        }
      });
      sdk.ChartImp.prototype.crosshairChange.call(
        { _chartStore: storeBoundary, _drawPanes: new Map([[paneId, { getId: () => paneId }]]) },
        { paneId, dataIndex: index }
      );
      return value;
    },
    async ready() {
      while (pending.length) await Promise.all(pending.splice(0));
    },
    dispose() {
      live = false;
      adapter.dispose();
    },
    params(indicator, ctx = recordingContext()) {
      return {
        ctx,
        indicator,
        kLineDataList: bars,
        visibleRange: { from: 0, to: bars.length, realFrom: 0, realTo: bars.length },
        bounding: { width: 300, height: 200 },
        barSpace: { bar: 10, halfBar: 5, gapBar: 8, halfGapBar: 4 },
        defaultStyles: storeBoundary.getStyles().indicator,
        xAxis: { convertToPixel: (index) => index * 10 },
        yAxis: { convertToPixel: (value) => 100 - value * 10 }
      };
    }
  };
}

export function output(
  id,
  values,
  geometry = { kind: "line", gaps: "break" },
  policy = "native-price"
) {
  const plot = {
    id: "value",
    seriesKey: "value",
    values,
    geometry,
    color: { kind: "solid", color: "#2962FF" },
    width: 1,
    opacity: 1,
    lineStyle: "solid",
    visible: true,
    scale: "include-when-visible",
    precisionPolicy: policy
  };
  return {
    key: `${id}/value`,
    instanceId: id,
    outputId: "value",
    paneKey: "price",
    order: 0,
    timestamps: values.map((_, i) => i + 1),
    values,
    levels: [],
    kind: geometry.kind === "columns" ? "histogram" : "line",
    style: { color: "#2962FF", width: 1, opacity: 1, lineStyle: "solid", visible: true },
    presentation: plot
  };
}
export function fill(plot, from, to) {
  return {
    id: "body",
    fromSeries: "body",
    toSeries: "value",
    color: "#4CAF50",
    opacity: 0.1,
    gaps: "break",
    from,
    to,
    visible: true,
    scale: "none",
    precisionPolicy: plot.presentation.precisionPolicy,
    key: `${plot.instanceId}/fill/body`,
    instanceId: plot.instanceId,
    paneKey: plot.paneKey,
    order: plot.order + 1,
    timestamps: plot.timestamps,
    scalePlotKey: plot.key
  };
}
export function compiled(outputs, fills = []) {
  const groups = [];
  for (const plot of outputs) {
    let group = groups.find((value) => value.key === plot.paneKey);
    if (!group) {
      group = { key: plot.paneKey, instances: [] };
      groups.push(group);
    }
    if (!group.instances.some((value) => value.id === plot.instanceId))
      group.instances.push({ id: plot.instanceId });
  }
  return { groups, outputs, fills };
}

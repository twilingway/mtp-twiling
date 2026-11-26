import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url)),
  compiled = new Map();
const plain = (value) => JSON.parse(JSON.stringify(value));
function sources(overrides, globals) {
  const modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative).replace(/\.js$/, ".ts"),
      key = path.relative(root, file).replaceAll(path.sep, "/");
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (modules.has(key)) return modules.get(key).exports;
    const module = { exports: {} };
    modules.set(key, module);
    let code = compiled.get(file);
    if (!code) {
      code = ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
      }).outputText;
      compiled.set(file, code);
    }
    vm.runInThisContext(
      `(function(require,module,exports,globals){const {window,document,ResizeObserver,requestAnimationFrame,cancelAnimationFrame,devicePixelRatio,MouseEvent}=globals;${code}\n})`,
      { filename: file }
    )(
      (specifier) =>
        Object.hasOwn(overrides, specifier)
          ? overrides[specifier]
          : load(path.relative(root, path.resolve(path.dirname(file), specifier))),
      module,
      module.exports,
      globals
    );
    return module.exports;
  }
  return load;
}
function events() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatch(type, event = {}) {
      for (const handler of listeners.get(type) ?? [])
        handler({ button: 0, pointerId: 1, clientY: 0, ...event });
    },
    listeners
  };
}
export function nativeFixture(engine, initial = [], configuration = {}) {
  const frames = new Map(),
    observers = [],
    registry = new Map(),
    axisRegistry = [],
    yAxisRegistry = [],
    allSeries = [],
    allIndicators = [];
  const window = events(),
    changes = [],
    metricEvents = [],
    calls = [];
  let frameId = 0,
    data = [],
    spacing = 6,
    offset = 8,
    removed = false,
    creations = 0,
    primaryWrites = 0;
  const container = {
    ...events(),
    clientWidth: 1000,
    clientHeight: 900,
    parentElement: { append() {} },
    getBoundingClientRect: () => ({
      top: 10,
      left: 5,
      width: 1000,
      height: container.clientHeight
    }),
    querySelectorAll: () => []
  };
  const ctx = new Proxy(
    {},
    { get: (_object, key) => (key === "measureText" ? () => ({ width: 100 }) : () => {}) }
  );
  const globals = {
    window: Object.assign(window, { devicePixelRatio: 1 }),
    document: { createElement: () => ({ style: {}, getContext: () => ctx, remove() {} }) },
    devicePixelRatio: 1,
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.elements = new Set();
        observers.push(this);
      }
      observe(element) {
        this.elements.add(element);
      }
      disconnect() {
        this.elements.clear();
      }
    },
    requestAnimationFrame: (callback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    MouseEvent: class {
      constructor(type, properties) {
        Object.assign(this, properties, { type });
      }
    }
  };
  const width = () => container.clientWidth - 65;
  const pixel = (index) => width() - 1 - (data.length - 1 + offset - index + 0.5) * spacing;
  const logical = (x) => data.length - 1 + offset + 0.5 - (width() - x - 1) / spacing;
  const scale = {
    width,
    height: () => 28,
    options: () => ({ barSpacing: spacing, minBarSpacing: 0.1, maxBarSpacing: 0 }),
    scrollPosition: () => offset,
    applyOptions(value) {
      if (value.barSpacing !== undefined) spacing = value.barSpacing;
      if (value.rightOffset !== undefined) offset = value.rightOffset;
    },
    logicalToCoordinate: pixel,
    coordinateToLogical: logical,
    getVisibleLogicalRange: () => ({ from: logical(0), to: logical(width()) }),
    getVisibleRange: () =>
      data.length ? { from: data[0].timestamp / 1000, to: data.at(-1).timestamp / 1000 } : null,
    setVisibleRange() {
      calls.push("fit");
    },
    setVisibleLogicalRange() {
      calls.push("logicalRange");
    },
    fitContent() {
      calls.push("fit");
    },
    subscribeVisibleLogicalRangeChange() {},
    subscribeSizeChange() {},
    scrollToPosition(value) {
      offset = value;
    }
  };
  function priceScale() {
    let autoScale = true,
      textColor,
      range = { from: 50, to: 150 };
    return {
      applyOptions(value) {
        if (value.autoScale !== undefined) autoScale = value.autoScale;
        if (value.textColor !== undefined) textColor = value.textColor;
      },
      options: () => ({ autoScale, textColor }),
      getVisibleRange: () => ({ ...range }),
      setVisibleRange: (value) => {
        range = { ...value };
      }
    };
  }
  const panes = [];
  function paneObject(id, height = 100) {
    const axes = new Map(),
      pane = {
        id,
        height,
        factor: height,
        series: [],
        indicators: new Map(),
        getHeight: () => pane.height,
        paneIndex: () => panes.indexOf(pane),
        setHeight(value) {
          pane.factor = value;
          pane.height = value;
        },
        setStretchFactor(value) {
          pane.factor = value;
          reflow();
        },
        getStretchFactor: () => pane.factor,
        getSeries: () => [...pane.series],
        setPreserveEmptyPane() {},
        moveTo(index) {
          panes.splice(panes.indexOf(pane), 1);
          panes.splice(index, 0, pane);
          reflow();
        },
        priceScale(id) {
          if (!axes.has(id)) axes.set(id, priceScale());
          return axes.get(id);
        },
        getHTMLElement: () => domFor(pane)
      };
    return pane;
  }
  panes.push(paneObject("candle_pane", 872));
  function reflow() {
    const total = container.clientHeight - 28 - Math.max(0, panes.length - 1);
    if (engine === "lightweight") {
      const factors = panes.reduce((sum, pane) => sum + pane.factor, 0);
      for (const pane of panes) pane.height = (total * pane.factor) / factors;
    } else panes[0].height = total - panes.slice(1).reduce((sum, pane) => sum + pane.height, 0);
  }
  function domFor(pane) {
    return {
      querySelectorAll: () => [],
      dispatchEvent() {},
      getBoundingClientRect: () => ({
        top:
          10 + panes.slice(0, panes.indexOf(pane)).reduce((sum, item) => sum + item.height + 1, 0),
        left: 5,
        height: pane.height,
        width: width()
      })
    };
  }
  function addSeries(definition, options = {}, index = 0) {
    const pane = panes[index],
      first = definition?.type === "Candlestick",
      seriesOptions = { ...options };
    const entry = {
      type: definition?.type,
      options: () => ({ ...seriesOptions }),
      data: [],
      pane,
      order: pane.series.length,
      labels: [],
      writes: 0,
      setData(next) {
        entry.data = plain(next);
        entry.writes++;
        if (first) {
          data = next;
          primaryWrites++;
        }
      },
      update(bar, historical = false) {
        const index = entry.data.findIndex((value) => value.time === bar.time);
        if (bar.time < (entry.data.at(-1)?.time ?? bar.time)) assert.equal(historical, true);
        if (index >= 0) entry.data[index] = plain(bar);
        else entry.data.push(plain(bar));
        if (first) data = entry.data;
      },
      applyOptions(value) {
        Object.assign(seriesOptions, value);
      },
      priceScale: () => entry.pane.priceScale(seriesOptions.priceScaleId ?? "right"),
      getPane: () => entry.pane,
      moveToPane(index) {
        entry.pane.series.splice(entry.pane.series.indexOf(entry), 1);
        entry.pane = panes[index];
        entry.pane.series.push(entry);
      },
      setSeriesOrder(index) {
        assert.ok(index >= 0 && index < entry.pane.series.length);
        entry.order = index;
      },
      createPriceLine(value) {
        const line = {
          options: { ...value },
          applyOptions(patch) {
            Object.assign(this.options, patch);
          }
        };
        entry.labels.push(line);
        return line;
      },
      removePriceLine(line) {
        entry.labels.splice(entry.labels.indexOf(line), 1);
      },
      attachPrimitive(value) {
        value.attached?.({ requestUpdate() {} });
      },
      detachPrimitive() {},
      priceToCoordinate(value) {
        const range = entry.priceScale().getVisibleRange();
        return ((range.to - value) / (range.to - range.from)) * entry.pane.height;
      },
      coordinateToPrice(y) {
        const range = entry.priceScale().getVisibleRange();
        return range.to - (y / entry.pane.height) * (range.to - range.from);
      }
    };
    pane.series.push(entry);
    allSeries.push(entry);
    return entry;
  }
  const actions = new Map();
  const native =
    engine === "lightweight"
      ? {
          addSeries,
          removeSeries(series) {
            series.pane.series.splice(series.pane.series.indexOf(series), 1);
            series.removed = true;
          },
          addPane() {
            const pane = paneObject(`pane-${panes.length}`);
            panes.push(pane);
            reflow();
            return pane;
          },
          removePane(index) {
            assert.ok(index > 0);
            assert.equal(panes[index].series.length, 0);
            panes.splice(index, 1);
            reflow();
          },
          panes: () => [...panes],
          paneSize: (index) => ({ width: width(), height: panes[index].height }),
          timeScale: () => scale,
          subscribeCrosshairMove() {},
          remove() {
            removed = true;
          }
        }
      : {
          getDom(id) {
            if (id === undefined) return { querySelectorAll: () => [] };
            if (id === "x_axis_pane")
              return {
                getBoundingClientRect: () => ({
                  top: 10 + container.clientHeight - 28,
                  width: width(),
                  height: 28
                })
              };
            const pane = panes.find((pane) => pane.id === id);
            return pane ? domFor(pane) : null;
          },
          getSize(id) {
            if (id === "x_axis_pane")
              return { width: width(), height: 28, top: container.clientHeight - 28 };
            const pane = panes.find((pane) => pane.id === (id ?? "candle_pane"));
            return pane
              ? {
                  width: width(),
                  height: pane.height,
                  top: domFor(pane).getBoundingClientRect().top - 10
                }
              : null;
          },
          setPaneOptions(value) {
            const pane = panes.find((pane) => pane.id === value.id);
            if (pane && value.height) {
              pane.height = Math.max(value.minHeight ?? 0, value.height);
              reflow();
            }
          },
          createIndicator(value, _stack, paneOptions) {
            const descriptor = typeof value === "string" ? { name: value } : value;
            let pane = panes.find((pane) => pane.id === paneOptions.id);
            if (!pane) {
              pane = paneObject(paneOptions.id, paneOptions.height ?? 95);
              panes.push(pane);
              reflow();
            }
            assert.equal(
              pane.indicators.has(descriptor.name),
              false,
              "two instances require distinct native names"
            );
            const entry = {
              ...(registry.get(descriptor.name) ?? {}),
              ...descriptor,
              paneId: pane.id,
              identity: Symbol(),
              result: []
            };
            pane.indicators.set(entry.name, entry);
            allIndicators.push(entry);
            recalculate(entry);
            return pane.id;
          },
          overrideIndicator(value, id) {
            const entry = panes.find((pane) => pane.id === id)?.indicators.get(value.name);
            if (entry) {
              Object.assign(entry, value);
              recalculate(entry);
            }
          },
          removeIndicator(id, name) {
            const pane = panes.find((pane) => pane.id === id);
            if (!pane) return;
            if (name) {
              const entry = pane.indicators.get(name);
              if (entry) entry.removed = true;
              pane.indicators.delete(name);
            } else pane.indicators.clear();
            if (id !== "candle_pane" && !pane.indicators.size) {
              panes.splice(panes.indexOf(pane), 1);
              reflow();
            }
          },
          setPriceVolumePrecision() {},
          setStyles() {},
          resize: reflow,
          subscribeAction(type, callback) {
            if (!actions.has(type)) actions.set(type, new Set());
            actions.get(type).add(callback);
          },
          unsubscribeAction(type, callback) {
            actions.get(type)?.delete(callback);
          },
          applyNewData(next) {
            data = [...next];
            offset = 8;
            primaryWrites++;
            for (const pane of panes)
              for (const entry of pane.indicators.values()) recalculate(entry);
            emit("ready");
          },
          updateData(bar) {
            assert.ok(bar.timestamp >= (data.at(-1)?.timestamp ?? bar.timestamp));
            const index = data.findIndex((item) => item.timestamp === bar.timestamp);
            if (index >= 0) data[index] = bar;
            else data.push(bar);
            for (const pane of panes)
              for (const entry of pane.indicators.values()) recalculate(entry);
            emit("ready");
          },
          getDataList: () => data,
          getVisibleRange: () => ({
            from: Math.max(0, logical(0)),
            to: Math.min(data.length, logical(width()) + 1),
            realFrom: logical(0),
            realTo: logical(width())
          }),
          setBarSpace(value) {
            spacing = value;
          },
          getBarSpace: () => spacing,
          getOffsetRightDistance: () => Math.max(0, offset * spacing),
          setOffsetRightDistance(value) {
            offset = value / spacing;
          },
          scrollByDistance(value) {
            offset -= value / spacing;
          },
          scrollToRealTime() {
            offset = 8;
            calls.push("fit");
          },
          convertToPixel(points) {
            const project = (point) => ({
              x: pixel(point.dataIndex),
              y: point.value === undefined ? 0 : ((150 - point.value) / 100) * panes[0].height
            });
            return Array.isArray(points) ? points.map(project) : project(points);
          },
          convertFromPixel(points) {
            return points.map((point) => ({
              dataIndex: logical(point.x ?? 0),
              value: 150 - ((point.y ?? 0) / panes[0].height) * 100
            }));
          }
        };
  function recalculate(entry) {
    const result = entry.calc?.(data, entry);
    if (result) {
      assert.ok(!result.then, "fixture expects synchronous common outputs");
      entry.result = result;
    }
  }
  function emit(type, value = {}) {
    for (const callback of actions.get(type) ?? []) callback(value);
  }
  const mtp = {
    activeMtpPeriods: (indicators) => (indicators.mtp160 ? [160] : []),
    lightweightMtp: () => ({ update() {}, destroy() {} }),
    MtpModel: class {
      bounds = [];
      reset(data) {
        this.bounds = data.map((bar) => ({ mtpLow: bar.low, mtpHigh: bar.high }));
      }
      update(data) {
        this.reset(data);
      }
      draw() {}
    }
  };
  const load = sources(
    {
      "lightweight-charts": {
        createChart() {
          creations++;
          return native;
        },
        ColorType: { Solid: "solid" },
        CrosshairMode: { Normal: 1, Hidden: 0 },
        CandlestickSeries: { type: "Candlestick" },
        HistogramSeries: { type: "Histogram" },
        LineSeries: { type: "Line" }
      },
      klinecharts: {
        init() {
          creations++;
          return native;
        },
        dispose() {
          removed = true;
        },
        registerIndicator: (descriptor) => registry.set(descriptor.name, descriptor),
        registerFigure() {},
        registerXAxis: (descriptor) => axisRegistry.push(descriptor),
        registerYAxis: (descriptor) => yAxisRegistry.push(descriptor),
        IndicatorSeries: { Normal: "normal", Price: "price" },
        DomPosition: { Main: "main", YAxis: "yAxis" },
        LineType: { Solid: "solid", Dashed: "dashed" },
        PolygonType: { Fill: "fill" },
        TooltipShowRule: { None: "none" },
        ActionType: {
          OnDataReady: "ready",
          OnPaneDrag: "paneDrag",
          OnVisibleRangeChange: "visible",
          OnZoom: "zoom",
          OnScroll: "scroll",
          OnCrosshairChange: "crosshair"
        }
      },
      "model/mtp.ts": mtp
    },
    globals
  );
  const options = {
    container,
    row: { symbol: "ONE", ticker: "ONE", uid: "uid-one", step: 0.01, currency: "rub" },
    timeframe: "1d",
    rangeDays: 365,
    indicators: {
      ma: false,
      ema: false,
      volume: false,
      mtp160: false,
      mtp440: false,
      mtp640: false
    },
    settings: {},
    paint() {},
    onNearStart() {},
    onCrosshair() {},
    technicalIndicators: initial,
    onTechnicalPaneLayout: (layout) => changes.push(plain(layout)),
    onTechnicalPaneMetrics: (metrics) => metricEvents.push(plain(metrics)),
    ...configuration
  };
  const adapter =
    engine === "lightweight"
      ? load("charts/lightweight.ts").makeLightweight(options)
      : load("charts/kline.ts").makeKline(options);
  function ready() {
    for (let round = 0; frames.size && round < 20; round++) {
      const batch = [...frames.values()];
      frames.clear();
      for (const callback of batch) callback();
    }
    assert.equal(frames.size, 0);
  }
  return {
    adapter,
    native,
    load,
    options,
    panes,
    allSeries,
    allIndicators,
    registry,
    axisRegistry,
    yAxisRegistry,
    container,
    window,
    changes,
    metricEvents,
    calls,
    ready,
    queueFrame: globals.requestAnimationFrame,
    primaryWrites: () => primaryWrites,
    creations: () => creations,
    removed: () => removed,
    camera: () => ({ spacing, offset }),
    resize: () => {
      reflow();
      for (const observer of observers) if (observer.elements.size) observer.callback([]);
      ready();
    },
    emit,
    activeSeries: () => allSeries.filter((series) => !series.removed),
    activeIndicators: () => allIndicators.filter((indicator) => !indicator.removed)
  };
}

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { nativeFixture } from "./native-technical-fixture.mjs";

const require = createRequire(import.meta.url);
const installed = readFileSync(
  join(dirname(require.resolve("klinecharts")), "index.esm.js"),
  "utf8"
);
export function installedMethod(owner, name, globals) {
  const marker = `${owner}.prototype.${name} = `,
    start = installed.indexOf(marker) + marker.length;
  if (start < marker.length) throw new Error(`Missing installed method ${name}`);
  return vm.runInNewContext(
    `(${installed.slice(start, installed.indexOf("\n    };", start) + 6)})`,
    globals
  );
}
const nativeMethod = (name, globals) => installedMethod("ChartImp", name, globals);

/** Installed create/set-options/measure/adjust methods, with controllable async calc and DOM paint. */
export function klineAsyncFixture() {
  const paints = [],
    coherence = [],
    mutations = [],
    pending = [];
  const f = nativeFixture("kline", [], {
    paint(_ctx, width, height) {
      paints.push({ width, height });
    }
  });
  f.ready();
  const native = f.native,
    original = { ...native },
    rendered = new Map(),
    wrappers = new Map();
  let timeHeight = 28;
  const wrap = (pane) => {
    if (!wrappers.has(pane))
      wrappers.set(pane, {
        getId: () => pane.id,
        getBounding: () => ({ height: pane.height, top: pane.top ?? 0 }),
        setBounding(value) {
          if (value.height !== undefined) pane.height = value.height;
          if (value.top !== undefined) pane.top = value.top;
        },
        getOptions: () => pane.options ?? { minHeight: 30 },
        setOptions(value) {
          pane.options = { ...pane.options, ...value };
        },
        getAxisComponent: () => ({ buildTicks: () => true })
      });
    return wrappers.get(pane);
  };
  const axis = {
    getId: () => "x_axis_pane",
    getOptions: () => ({ minHeight: 0 }),
    getAxisComponent: () => ({ getAutoSize: () => timeHeight, buildTicks: () => true }),
    setBounding(value) {
      Object.assign(this.bounds, value);
    },
    getBounding() {
      return this.bounds;
    },
    bounds: { height: timeHeight, top: f.container.clientHeight - timeHeight }
  };
  const globals = {
    PaneIdConstants: { CANDLE: "candle_pane", X_AXIS: "x_axis_pane", INDICATOR: "indicator" },
    isString: (value) => typeof value === "string",
    isNumber: (value) => typeof value === "number",
    isValid: (value) => value != null,
    getIndicatorClass: () => function Registered() {},
    createId: () => "generated",
    IndicatorPane: class {},
    PANE_DEFAULT_HEIGHT: 100
  };
  const facade = {
    _container: f.container,
    _xAxisPane: axis,
    _separatorPanes: new Map(),
    getDrawPaneById(id) {
      return id === "x_axis_pane"
        ? axis
        : f.panes.find((pane) => pane.id === id)
          ? wrap(f.panes.find((pane) => pane.id === id))
          : null;
    },
    _createPane(_class, id, options) {
      const pane = { id, height: options.height ?? 100, options, indicators: new Map() };
      f.panes.push(pane);
      return wrap(pane);
    },
    _measurePaneWidth() {},
    updatePane() {
      f.queueFrame(() => {
        for (const pane of f.panes)
          rendered.set(pane.id, { top: pane.top ?? 0, height: pane.height });
        rendered.set("x_axis_pane", { ...axis.bounds });
      });
    },
    _chartStore: {
      getStyles: () => ({ separator: { size: 1 } }),
      getIndicatorStore: () => ({
        async addInstance(value, id, stack) {
          original.createIndicator(value, stack, { id });
          await new Promise((resolve) => pending.push(resolve));
          return true;
        },
        async override(value, id) {
          original.overrideIndicator(value, id);
          await new Promise((resolve) => pending.push(resolve));
          return [true, true];
        }
      })
    }
  };
  Object.defineProperties(facade, {
    _drawPanes: { get: () => [...f.panes.map(wrap), axis] },
    _candlePane: { get: () => wrap(f.panes[0]) }
  });
  facade._measurePaneHeight = nativeMethod("_measurePaneHeight", globals);
  facade._setPaneOptions = nativeMethod("_setPaneOptions", globals);
  facade.adjustPaneViewport = function (...args) {
    this._separatorPanes = new Map(
      f.panes.slice(1).map((pane) => [wrap(pane), { setBounding() {} }])
    );
    nativeMethod("adjustPaneViewport", globals).apply(this, args);
  };
  const create = nativeMethod("createIndicator", globals),
    override = nativeMethod("overrideIndicator", globals);
  native.createIndicator = (value, stack, options, callback) => {
    mutations.push({ kind: "create", name: value.name, options: { ...options } });
    return create.call(facade, value, stack, options, callback);
  };
  native.overrideIndicator = (value, id, callback) => override.call(facade, value, id, callback);
  native.setPaneOptions = (options) => {
    mutations.push({ kind: "pane", options: { ...options } });
    facade._setPaneOptions(options, false);
  };
  native.removeIndicator = (id, name) => {
    original.removeIndicator(id, name);
    facade.adjustPaneViewport(true, true, true, true, true);
  };
  native.resize = () => facade.adjustPaneViewport(true, true, true, true, true);
  native.getDom = (id, position) => {
    if (id === undefined) return original.getDom();
    const dom = original.getDom(id, position);
    return dom
      ? {
          ...dom,
          getBoundingClientRect: () => {
            const bounds = rendered.get(id) ?? { top: 0, height: 0 };
            return {
              top: 10 + bounds.top,
              left: 5,
              width: f.container.clientWidth - 65,
              height: bounds.height
            };
          }
        }
      : null;
  };
  native.getSize = (id, position) =>
    id === "x_axis_pane"
      ? { width: f.container.clientWidth - 65, height: axis.bounds.height, top: axis.bounds.top }
      : original.getSize(id, position);
  const onMetrics = f.options.onTechnicalPaneMetrics;
  f.options.onTechnicalPaneMetrics = (metrics) => {
    coherence.push(
      metrics.every((metric) => {
        const id = metric.key === "price" ? "candle_pane" : `technical:${metric.key.slice(5)}`;
        return Math.abs(metric.height - (rendered.get(id)?.height ?? 0)) < 0.001;
      })
    );
    onMetrics(metrics);
  };
  facade.adjustPaneViewport(true, true, true, true, true);
  f.ready();
  async function settle() {
    for (let turn = 0; turn < 8; turn++) {
      for (const release of pending.splice(0)) release();
      await Promise.resolve();
      await Promise.resolve();
    }
    f.ready();
  }
  return {
    ...f,
    paints,
    coherence,
    mutations,
    pending,
    settle,
    setTimeHeight: (height) => {
      timeHeight = height;
    },
    rendered: (id) => rendered.get(id)
  };
}

import assert from "node:assert/strict";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

export const source = createSourceLoader();
export function plot(geometry, values, overrides = {}) {
  const columns = geometry.kind === "columns";
  const presentation = {
    id: "value",
    seriesKey: "value",
    geometry,
    color: { kind: "solid", color: "#2962ff" },
    width: 1,
    values,
    opacity: 1,
    lineStyle: "solid",
    visible: true,
    scale: "include-when-visible"
  };
  return {
    key: "owner/value",
    instanceId: "owner",
    outputId: "value",
    paneKey: "price",
    kind: columns ? "histogram" : "line",
    timestamps: values.map((_, i) => (i + 1) * 1000),
    values,
    order: 0,
    levels: [],
    style: { color: "#2962ff", width: 1, visible: true, opacity: 1, lineStyle: "solid" },
    presentation,
    ...overrides
  };
}
export function fill(output, from, to, overrides = {}) {
  return {
    key: "owner/fill/body",
    instanceId: "owner",
    paneKey: output.paneKey,
    order: 1,
    timestamps: output.timestamps,
    scalePlotKey: output.key,
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
    ...overrides
  };
}
export function canvas(horizontalPixelRatio = 1, verticalPixelRatio = horizontalPixelRatio) {
  const commands = [];
  const context = new Proxy(
    {},
    {
      get:
        (_object, name) =>
        (...args) =>
          commands.push([name, ...args]),
      set(_object, name, value) {
        commands.push([name, value]);
        return true;
      }
    }
  );
  return {
    commands,
    target: {
      useBitmapCoordinateSpace(callback) {
        callback({
          context,
          horizontalPixelRatio,
          verticalPixelRatio,
          bitmapSize: { width: 300 * horizontalPixelRatio, height: 200 * verticalPixelRatio }
        });
      }
    }
  };
}
export function fixture(initial) {
  let graph = initial,
    alive = true,
    visible = { from: 1, to: 100 },
    requests = 0;
  const allSeries = [],
    panes = [],
    removed = [],
    nativeCalls = [];
  const coordinateHoles = new Set();
  const pane = () => {
    const axisOptions = {};
    const p = {
      series: [],
      height: 200,
      paneIndex: () => panes.indexOf(p),
      getSeries: () => [...p.series],
      getHeight: () => p.height,
      priceScale: () => ({
        options: () => ({ ...axisOptions }),
        applyOptions: (value) => Object.assign(axisOptions, value)
      }),
      setStretchFactor(value) {
        p.height = value;
      },
      getHTMLElement: () => ({}),
      moveTo(index) {
        panes.splice(panes.indexOf(p), 1);
        panes.splice(index, 0, p);
      }
    };
    panes.push(p);
    return p;
  };
  const price = pane(),
    foreign = { foreign: true };
  price.series.push(foreign);
  const chart = {
    panes: () => [...panes],
    addPane: pane,
    removePane(index) {
      assert.ok(index > 0);
      assert.equal(panes[index].series.length, 0);
      panes.splice(index, 1);
    },
    timeScale: () => ({
      getVisibleRange: () => visible,
      timeToCoordinate: (time) => (coordinateHoles.has(time) ? null : time * 10),
      width: () => 300,
      height: () => 28
    }),
    addSeries(definition, options, index) {
      const s = {
        kind: definition.type,
        options: { ...options },
        data: [],
        primitives: new Set(),
        pane: panes[index],
        applyOptions(next) {
          Object.assign(s.options, next);
        },
        setData(values) {
          s.data = structuredClone(values);
        },
        getPane: () => s.pane,
        moveToPane(index) {
          s.pane.series.splice(s.pane.series.indexOf(s), 1);
          s.pane = panes[index];
          s.pane.series.push(s);
        },
        setSeriesOrder(index) {
          s.order = index;
        },
        createPriceLine(value) {
          return value;
        },
        removePriceLine() {},
        attachPrimitive(primitive) {
          s.primitives.add(primitive);
          primitive.attached?.({
            chart,
            series: s,
            requestUpdate() {
              requests++;
            }
          });
        },
        detachPrimitive(primitive) {
          assert.ok(s.primitives.delete(primitive));
          primitive.detached?.();
        },
        priceToCoordinate(value) {
          nativeCalls.push(["project", value]);
          // Mirrors the SDK firstValue guard: all-null/expired owner cannot project fake zero.
          return s.data.some((row) => Number.isFinite(row.value) && row.time >= visible.from)
            ? 100 - value
            : null;
        },
        range() {
          const original = () => {
            const values = s.data
              .filter(
                (row) =>
                  row.time >= visible.from && row.time <= visible.to && Number.isFinite(row.value)
              )
              .map((row) => row.value);
            if (!values.length) return null;
            if (s.kind === "Histogram") values.push(0);
            return { priceRange: { minValue: Math.min(...values), maxValue: Math.max(...values) } };
          };
          return s.options.visible
            ? (s.options.autoscaleInfoProvider?.(original) ??
                (s.options.autoscaleInfoProvider ? null : original()))
            : null;
        }
      };
      s.pane.series.push(s);
      allSeries.push(s);
      return s;
    },
    removeSeries(series) {
      assert.equal(series.primitives.size, 0);
      series.pane.series.splice(series.pane.series.indexOf(series), 1);
      removed.push(series);
    }
  };
  const load = createSourceLoader({
    "lightweight-charts": { LineSeries: { type: "Line" }, HistogramSeries: { type: "Histogram" } },
    "charts/technical-render-data.js": {
      TechnicalRenderData: class {
        compile() {
          return graph;
        }
        setData() {}
        dispose() {}
      }
    },
    "charts/technical-pane-events.js": {
      attachTechnicalPaneEvents: () => ({
        observe() {},
        cancel() {},
        schedule() {},
        dispose() {},
        dragging: () => false
      })
    }
  });
  const adapter = load("charts/lightweight-technical.js").lightweightTechnical(
    chart,
    { timeframe: "1d", settings: {}, container: { clientHeight: 428 } },
    () => alive
  );
  return {
    adapter,
    chart,
    allSeries,
    removed,
    panes,
    foreign,
    nativeCalls,
    series: () => allSeries.filter((s) => !removed.includes(s)),
    requests: () => requests,
    render(next = graph) {
      graph = next;
      adapter.update([], []);
    },
    visible(range) {
      visible = range;
    },
    hole(time) {
      coordinateHoles.add(time);
    },
    dead() {
      alive = false;
    },
    paint(background = false, h = 1, v = h) {
      const c = canvas(h, v);
      for (const s of allSeries.filter((s) => !removed.includes(s) && s.options.visible))
        for (const primitive of s.primitives)
          for (const view of primitive.paneViews()) {
            assert.equal(view.zOrder(), "normal");
            const renderer = view.renderer();
            (background ? renderer.drawBackground : renderer.draw)(c.target);
          }
      return c.commands;
    }
  };
}
export const graph = (outputs, fills = []) => ({
  outputs,
  fills,
  groups: [...new Set(outputs.map((p) => p.paneKey))].map((key) => ({
    key,
    pane: key === "price" ? { kind: "overlay" } : { kind: "pane", id: key.slice(5) },
    instances: [],
    preference: undefined
  }))
});

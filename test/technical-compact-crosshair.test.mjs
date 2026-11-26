import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";
import { klineFixture, output, compiled } from "./ta-render-kline-fixture.mjs";
import { nativeFixture } from "./native-technical-fixture.mjs";

const policy = createSourceLoader()("charts/technical-compact-crosshair.js");

for (const engine of ["lightweight", "kline"])
  test(`${engine}: manager forwards coherent live geometry through reconcile/settle and disposes its one policy owner`, () => {
    const f = nativeFixture(engine),
      events = [],
      helper = f.load("charts/technical-compact-crosshair.js");
    let owners = 0,
      closed = 0;
    helper[engine === "lightweight" ? "lightweightCompactCrosshair" : "klineCompactCrosshair"] =
      () => {
        owners++;
        return {
          refresh: (metrics) => events.push(structuredClone(metrics)),
          dispose: () => closed++
        };
      };
    const make = f.load("model/technical-indicators/instances.js").createTechnicalIndicatorInstance;
    const owner =
      engine === "lightweight"
        ? f
            .load("charts/lightweight-technical.js")
            .lightweightTechnical(f.native, f.options, () => true)
        : f.load("charts/kline-technical.js").klineTechnical(
            f.native,
            f.options,
            () => true,
            () => null
          );
    const i = make("rsi", "compact");
    try {
      const view = f.camera(),
        writes = f.primaryWrites();
      owner.update([i], [{ paneId: "compact", heightRatio: 0.2, collapsed: true }]);
      f.ready();
      assert.equal(owners, 1);
      assert.ok(events.some((m) => m.some((p) => p.key === "pane:compact" && p.height === 30)));
      owner.update([i], [{ paneId: "compact", heightRatio: 0.2, collapsed: false }]);
      f.ready();
      assert.ok(events.at(-1).find((p) => p.key === "pane:compact").height > 30);
      assert.deepEqual(f.camera(), view);
      assert.equal(f.primaryWrites(), writes);
      owner.dispose();
      const n = events.length;
      owner.update([i]);
      f.ready();
      assert.equal(events.length, n);
      assert.equal(closed, 1);
    } finally {
      f.adapter.destroy();
    }
  });
function sdk(file, hash, names) {
  const source = readFileSync(new URL("../node_modules/" + file, import.meta.url), "utf8");
  assert.equal(createHash("sha256").update(source).digest("hex"), hash);
  const scope = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    process: { env: { NODE_ENV: "test" } },
    document: {
      createElement: () => ({
        getContext: () => ({ scale() {}, measureText: (s) => ({ width: s.length * 7 }) })
      })
    }
  });
  vm.runInContext(
    source.replace(/^import .*;$/gm, "").replace(/^export \{[^\n]+\};$/gm, "") +
      `\nglobalThis.sdk={${names}}`,
    scope
  );
  return scope.sdk;
}
const lw = sdk(
  "lightweight-charts/dist/lightweight-charts.development.mjs",
  "dec157fcccf103e2d152cce52b29204a66ab3a7df713af4132e6bb70e22233b9",
  "CrosshairPriceAxisView,PriceAxisWidget,priceScaleCrosshairLabelVisible"
);
const k = sdk(
  "klinecharts/dist/index.esm.js",
  "313a26786af901e2b5b93c16ac002c6ceeebb54ecc9b6a55e386f1b31805ca5d",
  "CrosshairHorizontalLabelView,YAxisImp,ChartImp,ActionType,DomPosition"
);
const merge = (target, patch) => {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object") merge((target[key] ??= {}), value);
    else target[key] = value;
  }
};
function fixture(engine, initial = {}) {
  const listeners = new Set(),
    dom = new Map(),
    calls = [];
  let alive = true,
    last,
    reenter = false,
    reads = 0;
  let panes = [
    { key: "price", top: 0, height: 200, width: 300 },
    { key: "legacy:volume", top: 201, height: 95, width: 300 },
    { key: "pane:a", top: 297, height: 30, width: 300 },
    { key: "pane:b", top: 328, height: 150, width: 300 }
  ];
  const container = {
    getBoundingClientRect: () => ({ top: 20, left: 10 }),
    addEventListener(t, f) {
      (dom.get(t) ?? (dom.set(t, new Set()), dom.get(t))).add(f);
    },
    removeEventListener(t, f) {
      dom.get(t)?.delete(f);
    }
  };
  const options = {
    crosshair: {
      mode: 0,
      horzLine: { visible: true, labelVisible: true },
      vertLine: { visible: true, labelVisible: true }
    },
    leftPriceScale: { visible: true, minimumWidth: 10 },
    rightPriceScale: { visible: true, minimumWidth: 20 }
  };
  const styles = {
    crosshair: {
      show: true,
      horizontal: { show: true, line: { show: true }, text: { show: true } },
      vertical: { show: true, line: { show: true }, text: { show: true } }
    },
    yAxis: { size: "auto" }
  };
  merge(engine === "lw" ? options : styles, initial);
  const emit = (event) => {
    last = event;
    for (const f of [...listeners]) f(event);
  };
  const apply = (patch) => {
    calls.push(structuredClone(patch));
    merge(engine === "lw" ? options : styles, patch);
    if (reenter) emit(last);
  };
  const chart =
    engine === "lw"
      ? {
          options: () => options,
          applyOptions: apply,
          priceScale: (side) => ({
            width: () =>
              Math.max(
                options[side + "PriceScale"].minimumWidth,
                options.crosshair.horzLine.labelVisible ? 90 : 40
              )
          }),
          subscribeCrosshairMove: (f) => listeners.add(f),
          unsubscribeCrosshairMove: (f) => listeners.delete(f)
        }
      : {
          getStyles: () => styles,
          setStyles: apply,
          getSize: () => ({
            width:
              styles.yAxis.size === "auto"
                ? styles.crosshair.horizontal.text.show
                  ? 90
                  : 40
                : styles.yAxis.size
          }),
          subscribeAction: (action, f) => {
            assert.equal(action, k.ActionType.OnCrosshairChange);
            listeners.add(f);
          },
          unsubscribeAction: (action, f) => listeners.delete(f)
        };
  const metrics = () => {
    reads++;
    return panes;
  };
  const api =
    engine === "lw"
      ? policy.lightweightCompactCrosshair(
          chart,
          container,
          metrics,
          () => alive,
          (index) => panes[index]?.key
        )
      : policy.klineCompactCrosshair(
          chart,
          container,
          metrics,
          () => alive,
          k.ActionType.OnCrosshairChange,
          k.DomPosition.YAxis
        );
  const hover = (key, y = 15) => {
    const index = panes.findIndex((p) => p.key === key);
    emit(
      engine === "lw"
        ? { paneIndex: index < 0 ? undefined : index, point: { x: 50, y } }
        : {
            paneId: key?.startsWith("pane:")
              ? "technical:" + key.slice(5)
              : key === "price"
                ? "candle_pane"
                : key === "legacy:volume"
                  ? "volume_pane"
                  : undefined,
            y
          }
    );
  };
  const label = () =>
    engine === "lw"
      ? options.crosshair.horzLine.labelVisible
      : styles.crosshair.horizontal.text.show;
  return {
    api,
    chart,
    options,
    styles,
    calls,
    hover,
    label,
    listeners,
    dom,
    container,
    setReentry: () => (reenter = true),
    reads: () => reads,
    setDead: () => (alive = false),
    setPanes: (p) => (panes = p),
    panes: () => panes,
    pointer: (y) => {
      for (const f of dom.get("pointermove") ?? []) f({ clientX: 50, clientY: 20 + y });
    },
    leave: () => {
      for (const f of dom.get("pointerleave") ?? []) f();
    }
  };
}

for (const engine of ["lw", "kline"]) {
  test(`${engine}: real compact hover flags restore on main/legacy/expanded/leave; vertical/mode/line are unchanged and recursive events bounded`, () => {
    const f = fixture(engine),
      initial = structuredClone(engine === "lw" ? f.options : f.styles);
    f.setReentry();
    assert.equal(f.listeners.size, 1);
    for (const target of ["price", "legacy:volume", "pane:b", undefined]) {
      f.hover("pane:a");
      assert.equal(f.label(), false);
      const n = f.calls.length;
      f.hover("pane:a");
      assert.equal(f.calls.length, n);
      f.hover(target);
      assert.equal(f.label(), true);
    }
    f.hover("pane:a");
    f.leave();
    assert.equal(f.label(), true);
    assert.deepEqual(engine === "lw" ? f.options : f.styles, initial);
    assert.equal(f.calls.length, 10);
    f.api.dispose();
    assert.equal(f.listeners.size, 0);
    assert.ok([...f.dom.values()].every((s) => s.size === 0));
  });
  test(`${engine}: stationary physical pointer handles manual30/no collapsed preference, expand/remove/reorder without geometry or data writes`, () => {
    const f = fixture(engine);
    f.pointer(310);
    assert.equal(f.label(), false);
    f.setPanes(f.panes().map((p) => (p.key === "pane:a" ? { ...p, height: 80 } : p)));
    f.api.refresh();
    assert.equal(f.label(), true);
    f.setPanes([
      { key: "price", top: 0, height: 200, width: 300 },
      { key: "pane:b", top: 201, height: 30, width: 300 },
      { key: "pane:a", top: 232, height: 30, width: 300 }
    ]);
    f.api.refresh();
    assert.equal(f.label(), true);
    f.pointer(215);
    assert.equal(f.label(), false);
    f.setPanes([
      { key: "price", top: 0, height: 300, width: 300 },
      { key: "pane:a", top: 301, height: 30, width: 300 }
    ]);
    f.api.refresh();
    assert.equal(f.label(), true);
    f.pointer(310);
    assert.equal(f.label(), false);
    f.api.dispose();
    assert.equal(f.label(), true);
    const count = f.calls.length,
      reads = f.reads();
    f.hover("pane:a");
    f.api.refresh();
    assert.equal(f.calls.length, count);
    assert.equal(f.reads(), reads);
    for (const patch of f.calls)
      assert.ok(
        Object.keys(patch).every((key) =>
          ["crosshair", "leftPriceScale", "rightPriceScale", "yAxis"].includes(key)
        )
      );
  });
  test(`${engine}: original disabled label/hidden cursor mode survive restoration and late events after retirement cannot apply`, () => {
    const f = fixture(
      engine,
      engine === "lw"
        ? { crosshair: { mode: 2, horzLine: { labelVisible: false } } }
        : { crosshair: { show: false, horizontal: { text: { show: false } } } }
    );
    f.hover("pane:a");
    f.hover("price");
    assert.equal(f.label(), false);
    assert.equal(
      engine === "lw" ? f.options.crosshair.mode : f.styles.crosshair.show,
      engine === "lw" ? 2 : false
    );
    f.hover("pane:a");
    f.setDead();
    const n = f.calls.length;
    f.hover("price");
    f.api.dispose();
    f.api.refresh();
    assert.equal(f.calls.length, n);
  });
  test(`${engine}: width hold prevents reserve shrink and preserves newer external minima/size while hovered`, () => {
    const f = fixture(engine);
    const width = engine === "lw" ? f.chart.priceScale("right").width() : f.chart.getSize().width;
    f.hover("pane:a");
    assert.equal(
      engine === "lw" ? f.chart.priceScale("right").width() : f.chart.getSize().width,
      width
    );
    if (engine === "lw") f.options.rightPriceScale.minimumWidth = 123;
    else f.styles.yAxis.size = 123;
    f.hover("price");
    assert.equal(
      engine === "lw" ? f.options.rightPriceScale.minimumWidth : f.styles.yAxis.size,
      123
    );
    f.api.dispose();
  });
}

test("installed LW label renderer honors current public labelVisible and Hidden mode; native optimalWidth reserves crosshair width", () => {
  const options = {
      mode: 0,
      horzLine: { labelVisible: true, labelBackgroundColor: "#000", visible: true }
    },
    source = { _internal_options: () => options, _internal_visible: () => true };
  let providers = 0;
  const scale = {
    _internal_firstValue: () => 110,
    _internal_isEmpty: () => false,
    _internal_colorParser: () => ({
      _internal_generateContrastColors: () => ({
        _internal_background: "#000",
        _internal_foreground: "#fff"
      })
    }),
    _internal_fontSize: () => 12,
    _internal_formatPrice: String
  };
  const draw = () => {
    const axis = {},
      pane = {},
      common = {};
    lw.CrosshairPriceAxisView.prototype._internal__updateRendererData.call(
      {
        _private__source: source,
        _private__priceScale: scale,
        _private__valueProvider: () => {
          providers++;
          return { _internal_price: 110, _internal_coordinate: 15 };
        }
      },
      axis,
      pane,
      common
    );
    return axis._internal_visible;
  };
  assert.equal(draw(), true);
  options.horzLine.labelVisible = false;
  assert.equal(draw(), false);
  assert.equal(providers, 1);
  options.horzLine.labelVisible = true;
  options.mode = 2;
  assert.equal(draw(), false);
  // The installed width predicate used by PriceAxisWidget matches the flags controlled by our bridge.
  assert.equal(lw.priceScaleCrosshairLabelVisible(options), false);
  options.mode = 0;
  assert.equal(lw.priceScaleCrosshairLabelVisible(options), true);
  const ctx = { save() {}, restore() {} },
    widget = {
      _private__priceScale: {
        _internal_marks: () => [{ _internal_label: "110" }],
        _internal_firstValue: () => 110,
        _internal_coordinateToPrice: (y) => 110 - y / 1000,
        _internal_formatPrice: String
      },
      _internal_rendererOptions: () => ({
        _internal_borderSize: 1,
        _internal_tickLength: 4,
        _internal_paddingInner: 3,
        _internal_paddingOuter: 3
      }),
      _private__canvasBinding: { canvasElement: { getContext: () => ctx } },
      _private__pane: {
        _internal_chart: () => ({ _internal_options: () => ({ layout: { colorSpace: "srgb" } }) })
      },
      _private__baseFont: () => "",
      _private__widthCache: { _internal_measureText: (_, s) => s.length * 7 },
      _private__backLabels: () => [],
      _private__size: { height: 30 },
      _private__options: { crosshair: options }
    };
  const width = () => lw.PriceAxisWidget.prototype._internal_optimalWidth.call(widget),
    held = width();
  options.horzLine.labelVisible = false;
  assert.ok(width() < held);
  assert.equal(Math.max(held, width()), held);
});

test("actual app fixed KLine axis size is not written by compact suppression; current hidden cursor mode stays current", () => {
  const f = fixture("kline", { yAxis: { size: 80 } });
  f.hover("pane:a");
  assert.equal(f.chart.getSize().width, 80);
  assert.ok(f.calls.every((p) => !Object.hasOwn(p, "yAxis")));
  f.styles.crosshair.show = false;
  f.hover("price");
  assert.equal(f.styles.crosshair.show, false);
  assert.equal(f.styles.yAxis.size, 80);
  f.api.dispose();
  const g = fixture("lw");
  g.hover("pane:a");
  g.options.crosshair.mode = 2;
  g.hover("price");
  assert.equal(g.options.crosshair.mode, 2);
  g.api.dispose();
});

test("installed KLine actual label draw and auto axis reserve obey text.show; empty-strip label is native projection, not an inserted quote", async (t) => {
  const f = klineFixture(6);
  t.after(() => f.dispose());
  const p = output("hidden", [null, 110]);
  p.paneKey = "pane:empty";
  p.style.visible = false;
  p.presentation.visible = false;
  f.set(compiled([p]));
  await f.ready();
  const nativeRange = f.range("technical:empty"),
    texts = [],
    store = f.chart.getChartStore();
  const styles = {
    crosshair: {
      show: true,
      horizontal: {
        show: true,
        text: { show: true, size: 12, paddingLeft: 3, paddingRight: 3, borderSize: 0 }
      }
    },
    yAxis: {
      size: "auto",
      type: "normal",
      show: false,
      reverse: false,
      position: "right",
      inside: false
    }
  };
  const crosshair = { paneId: "technical:empty", y: 15 };
  const chart = { getStyles: () => styles, getChartStore: () => store };
  const pane = {
    getChart: () => chart,
    getId: () => crosshair.paneId,
    getYAxisWidget: () => ({ getBounding: () => ({ height: 30 }) })
  };
  const axis = new k.YAxisImp(pane);
  axis._range = nativeRange;
  store.getTooltipStore = () => ({ getCrosshair: () => crosshair });
  store.getStyles = () => styles;
  store.getCustomApi = () => ({});
  store.getThousandsSeparator = () => ",";
  store.getDecimalFoldThreshold = () => 3;
  const facade = {
    getWidget: () => ({
      getPane: () => ({ ...pane, getAxisComponent: () => axis }),
      getBounding: () => ({ width: 90, height: 30 })
    }),
    compare: k.CrosshairHorizontalLabelView.prototype.compare,
    getDirectionStyles: k.CrosshairHorizontalLabelView.prototype.getDirectionStyles,
    getText: k.CrosshairHorizontalLabelView.prototype.getText,
    getTextAttrs: k.CrosshairHorizontalLabelView.prototype.getTextAttrs,
    createFigure: (value) => ({ draw: () => texts.push(value.attrs.text) })
  };
  const ctx = { measureText: (s) => ({ width: s.length * 7 }) };
  k.CrosshairHorizontalLabelView.prototype.drawImp.call(facade, ctx);
  assert.equal(texts.length, 1);
  const autoWidth = axis.getAutoSize();
  assert.ok(autoWidth > 0);
  styles.yAxis.size = autoWidth;
  styles.crosshair.horizontal.text.show = false;
  k.CrosshairHorizontalLabelView.prototype.drawImp.call(facade, ctx);
  assert.equal(texts.length, 1);
  assert.equal(axis.getAutoSize(), autoWidth);
  assert.deepEqual(axis.getRange(), nativeRange);
  styles.yAxis.size = "auto";
  assert.equal(axis.getAutoSize(), 0);
});

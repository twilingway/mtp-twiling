import assert from "node:assert/strict";
import test from "node:test";
import { backup } from "./keltner-fixture.mjs";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const load = createSourceLoader();
const core = load("model/technical-indicators/index.js");
const catalog = load("model/technical-indicators/catalog.js");
const { TechnicalRenderData } = load("charts/technical-render-data.js");
const { assertReadableDrivePayload } = load("services/drive/reader-guard.js");

const candle = (timestamp, low, high, open = low, close = high) => ({
  timestamp,
  low,
  high,
  open,
  close,
  volume: null
});
const anchor = Array.from({ length: 13 }, (_, i) => candle((i + 1) * 1000, 10, 12));
const gapBars = [...anchor, candle(14000, 14, 16), candle(15000, 13, 16)];
const at = (iso) => Date.parse(iso);
const sessions = {
  session1Name: "Вечерняя сессия",
  session1Start: "22:00",
  session1End: "02:00",
  session1TimeZone: "",
  session2Enabled: false,
  session3Enabled: false,
  showOpenClose: true,
  showTickRange: true,
  showAverage: true
};

test("calendar studies are searchable and keep text inputs and per-region styles on Drive", () => {
  assert.equal(catalog.technicalDefinitionForCatalog("STD;Gaps"), "gaps");
  assert.equal(catalog.technicalDefinitionForCatalog("STD;Trading%1Sessions"), "trading-sessions");
  const visible = catalog.technicalCatalogEntries("ru").filter((item) => item.available);
  assert.ok(visible.some(({ id }) => id === "STD;Gaps"));
  assert.ok(visible.some(({ id }) => id === "STD;Trading%1Sessions"));
  const gap = core.createTechnicalIndicatorInstance("gaps", "gaps", {
    params: { closePartially: true }
  });
  const session = core.createTechnicalIndicatorInstance("trading-sessions", "session", {
    params: sessions,
    styles: { session1: { color: "#3f0078", opacity: 0.25, visible: true, width: 2 } }
  });
  assert.deepEqual(assertReadableDrivePayload(backup([gap, session])).layout.technicalIndicators, [
    gap,
    session
  ]);
  assert.equal(
    core.isTechnicalIndicatorInstance({ ...session, pane: { kind: "pane", id: "moved" } }),
    false
  );
  assert.equal(
    core.isTechnicalIndicatorInstance({
      ...session,
      params: { ...session.params, session1End: "24:00" }
    }),
    false
  );
  assert.equal(
    core.isTechnicalIndicatorInstance({
      ...session,
      params: { ...session.params, session1TimeZone: "Nowhere/Pine" }
    }),
    false
  );
});

test("Gaps compiles exactly the remaining rectangle and resolves per-instance region styles", () => {
  const instance = core.createTechnicalIndicatorInstance("gaps", "gaps", {
    params: { closePartially: true }
  });
  const regionStyle = {
    color: "#aa0033",
    width: 3,
    visible: true,
    opacity: 0.4,
    lineStyle: "dotted"
  };
  const adjusted = { ...instance, id: "gaps-two", styles: { upGap: regionStyle } };
  const render = new TechnicalRenderData();
  render.setData(gapBars);
  const compiled = render.compile([instance, adjusted]);
  assert.deepEqual(compiled.outputs, []);
  assert.deepEqual(compiled.fills, []);
  assert.deepEqual(
    compiled.priceRegions.map(({ startTimestamp, endTimestamp, high, low, color, opacity }) => [
      startTimestamp,
      endTimestamp,
      high,
      low,
      color,
      opacity
    ]),
    [
      [13000, 15000, 14, 12, "#168765", 0.24],
      [15000, null, 13, 12, "#168765", 0.24],
      [13000, 15000, 14, 12, "#aa0033", 0.4],
      [15000, null, 13, 12, "#aa0033", 0.4]
    ]
  );
  assert.equal(compiled.priceRegions[2].width, 3);
  assert.equal(compiled.priceRegions[2].lineStyle, "dotted");
  assert.deepEqual(render.compile([{ ...instance, visible: false }]).priceRegions, []);
  assert.deepEqual(
    render.compile([{ ...instance, styles: { upGap: { ...regionStyle, visible: false } } }])
      .priceRegions,
    []
  );
  render.setData(anchor);
  assert.deepEqual(render.compile([instance]).priceRegions, []);
});

test("Trading Sessions uses explicit candle timeframe, exchange zone and verified tick increment", () => {
  const instance = core.createTechnicalIndicatorInstance("trading-sessions", "s", {
    params: sessions
  });
  const bars = [
    candle(at("2025-04-01T20:00Z"), 98, 110, 104, 100),
    candle(at("2025-04-01T22:00Z"), 99, 104, 100, 103),
    candle(at("2025-04-02T01:00Z"), 100, 106, 103, 105),
    candle(at("2025-04-02T02:00Z"), 104, 120, 105, 109)
  ];
  const context = {
    historicalVolatilityPeriodsPerYear: 365,
    chartInterval: "1h",
    exchangeTimeZone: "UTC",
    priceStep: 0.25
  };
  const calculate = (next) => core.calculateTechnicalIndicator(instance, bars, next).priceRegions;
  assert.deepEqual(calculate({ ...context, chartInterval: "1d" }), []);
  assert.deepEqual(calculate({ ...context, exchangeTimeZone: undefined }), []);
  assert.deepEqual(calculate(context), [
    {
      styleId: "session1",
      startTimestamp: bars[1].timestamp,
      endTimestamp: bars[2].timestamp,
      startEdge: "left",
      endEdge: "right",
      high: 106,
      low: 99,
      guides: [
        { price: 100, kind: "dashed" },
        { price: 105, kind: "dashed" },
        { price: 104, kind: "dotted" }
      ],
      label: { name: sessions.session1Name, tickRange: 28, averagePrice: 104 }
    }
  ]);
  assert.deepEqual(calculate({ ...context, priceStep: undefined })[0].label, {
    name: sessions.session1Name,
    averagePrice: 104
  });
  const render = new TechnicalRenderData(context);
  render.setData([bars[1]]);
  const [one] = render.compile([instance]).priceRegions;
  assert.equal(one.startTimestamp, one.endTimestamp);
  assert.equal(one.startEdge, "left");
  assert.equal(one.endEdge, "right");
});

function canvas() {
  const fills = [];
  const texts = [];
  const strokes = [];
  return {
    fills,
    texts,
    strokes,
    ctx: {
      save() {},
      restore() {},
      beginPath() {},
      rect() {},
      clip() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      setLineDash() {},
      fillRect: (...args) => fills.push(args),
      fillText: (...args) => texts.push(args),
      strokeRect: (...args) => strokes.push(args)
    }
  };
}

test("native chart hooks paint through their price panes without adding any numeric series", () => {
  const outsideGap = {
    styleId: "upGap",
    startTimestamp: 13000,
    endTimestamp: null,
    startEdge: "center",
    endEdge: "center",
    low: 12,
    high: 14,
    color: "#f5051a",
    opacity: 0.2,
    width: 1,
    lineStyle: "solid"
  };
  const singleton = {
    ...outsideGap,
    styleId: "session1",
    startTimestamp: 14000,
    endTimestamp: 14000,
    startEdge: "left",
    endEdge: "right",
    label: { name: "Test market" }
  };
  const { lightweightCalendarRegions } = load("charts/lightweight-calendar-regions.js");
  let attached;
  const chart = {
    timeScale: () => ({
      getVisibleLogicalRange: () => ({ from: 0, to: 5 }),
      logicalToCoordinate: (index) => index * 10,
      timeToCoordinate: (seconds) => (seconds - 13) * 10 - 5
    })
  };
  const series = {
    attachPrimitive(value) {
      attached = value;
      value.attached({ requestUpdate() {} });
    },
    detachPrimitive(value) {
      assert.equal(attached, value);
      attached = undefined;
      value.detached();
    },
    priceToCoordinate: (price) => 100 - price,
    priceFormatter: () => ({ format: String })
  };
  const native = lightweightCalendarRegions(
    chart,
    { locale: "en" },
    () => true,
    () => series
  );
  native.update([outsideGap, singleton]);
  const lw = canvas();
  assert.equal(attached.autoscaleInfo(), null);
  attached
    .paneViews()[0]
    .renderer()
    .drawBackground({
      useMediaCoordinateSpace(fn) {
        fn({ context: lw.ctx, mediaSize: { width: 40, height: 100 } });
      }
    });
  assert.deepEqual(lw.fills, [
    [0, 86, 40, 2],
    [0, 86, 10, 2]
  ]);
  assert.equal(lw.texts[0][0], "Test market");
  assert.equal(lw.strokes.length, 1);
  native.dispose();
  assert.equal(attached, undefined);

  let template;
  let installed;
  const kLoad = createSourceLoader({
    klinecharts: {
      IndicatorSeries: { Normal: "normal" },
      registerIndicator(value) {
        template = value;
      }
    }
  });
  const { klineCalendarRegions } = kLoad("charts/kline-calendar-regions.js");
  const kChart = {
    getPriceVolumePrecision: () => ({ price: 2 }),
    createIndicator(value, stack, { id }) {
      assert.equal(stack, true);
      assert.equal(id, "candle_pane");
      installed = value;
      return id;
    },
    removeIndicator(id, name) {
      assert.equal(id, "candle_pane");
      assert.equal(installed.name, name);
      installed = undefined;
    }
  };
  const kNative = klineCalendarRegions(kChart, { locale: "en" }, () => true);
  kNative.update([outsideGap, singleton]);
  assert.equal(template.series, "normal");
  assert.deepEqual(template.figures, []);
  assert.deepEqual(template.calc(), []);
  const kline = canvas();
  template.draw({
    ctx: kline.ctx,
    bounding: { width: 40, height: 100 },
    barSpace: { bar: 10 },
    kLineDataList: gapBars,
    visibleRange: { from: 13, to: 15 },
    indicator: installed,
    xAxis: { convertToPixel: (index) => (index - 12) * 10 - 5 },
    yAxis: { convertToPixel: (price) => 100 - price }
  });
  assert.deepEqual(kline.fills, lw.fills);
  assert.deepEqual(kline.strokes, lw.strokes);
  assert.deepEqual(kline.texts, lw.texts);
  kNative.update([]);
  assert.equal(installed, undefined);
});

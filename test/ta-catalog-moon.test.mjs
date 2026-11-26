import assert from "node:assert/strict";
import test from "node:test";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const load = createSourceLoader();
const core = load("model/technical-indicators/index.js");
const catalog = load("model/technical-indicators/catalog.js");
const { lunarEphemeris, moonAttribution } = load(
  "model/technical-indicators/catalog-expansion/moon.js"
);
const { TechnicalRenderData } = load("charts/technical-render-data.js");
const at = (date) => Date.parse(date);
const datedBars = (dates) =>
  dates.map((date) => ({
    timestamp: at(date),
    open: 100,
    close: 106,
    low: 94,
    high: 108,
    volume: 4
  }));
const bars = datedBars(["2026-01-18", "2026-01-19", "2026-02-01", "2026-02-02"]);

test("the included ephemeris alternates over the declared century and matches control events", () => {
  const { startTimestamp, endTimestamp, phases } = lunarEphemeris();
  assert.equal(startTimestamp, at("2001-01-01"));
  assert.equal(endTimestamp, at("2101-01-01"));
  assert.ok(phases.length > 2470 && phases.length < 2480);
  assert.deepEqual(phases[0], { kind: "full", timestamp: at("2001-01-09T20:24Z") });
  const days = 86400000;
  for (let index = 1; index < phases.length; index++) {
    const previous = phases[index - 1];
    const current = phases[index];
    assert.notEqual(previous.kind, current.kind);
    assert.ok(current.timestamp - previous.timestamp > 12 * days);
    assert.ok(current.timestamp - previous.timestamp < 17 * days);
  }
  const check = [
    ["full", "2025-01-13T22:27Z"],
    ["new", "2026-01-18T19:52Z"],
    ["full", "2026-02-01T22:09Z"],
    ["full", "2026-11-24T14:53Z"],
    ["new", "2100-12-30T23:56Z"]
  ];
  for (const [kind, date] of check)
    assert.ok(phases.some((event) => event.kind === kind && event.timestamp === at(date)));
});

test("Moon Phases uses the next real candle and omits dates without known stages", () => {
  const entryId = "STD;Moon%1Phases";
  const id = "moon-phases";
  assert.equal(catalog.technicalDefinitionForCatalog(entryId), id);
  assert.ok(catalog.technicalCatalogEntries("ru").find(({ id }) => id === entryId).available);
  assert.deepEqual(core.getTechnicalIndicatorDefinition(id).attribution, moonAttribution);
  const instance = core.createTechnicalIndicatorInstance(id, "moon");
  const result = core.calculateTechnicalIndicator(instance, bars);
  assert.deepEqual(result.series, {});
  assert.deepEqual(result.priceRegions, [
    {
      kind: "candle-tint",
      styleId: "waning",
      startTimestamp: bars[0].timestamp,
      endTimestamp: bars[0].timestamp
    },
    {
      kind: "candle-tint",
      styleId: "waxing",
      startTimestamp: bars[1].timestamp,
      endTimestamp: bars[2].timestamp
    },
    {
      kind: "candle-tint",
      styleId: "waning",
      startTimestamp: bars[3].timestamp,
      endTimestamp: bars[3].timestamp
    },
    { kind: "price-circle", styleId: "newMoon", timestamp: bars[1].timestamp, price: bars[1].high },
    { kind: "price-circle", styleId: "fullMoon", timestamp: bars[3].timestamp, price: bars[3].high }
  ]);
  const outside = datedBars(["2000-12-31", "2001-01-01", "2101-01-01"]);
  assert.deepEqual(core.calculateTechnicalIndicator(instance, outside).priceRegions, []);
  const render = new TechnicalRenderData();
  render.setData(bars);
  const configured = {
    ...instance,
    styles: { waxing: { color: "#accf10", width: 2, visible: false } }
  };
  const painted = render.compile([configured]);
  assert.deepEqual(painted.outputs, []);
  assert.ok(painted.priceRegions.every((region) => region.styleId !== "waxing"));
  assert.equal(painted.priceRegions.filter((region) => region.kind === "price-circle").length, 2);
  assert.deepEqual(render.compile([{ ...instance, visible: false }]).priceRegions, []);
});

function canvas() {
  const fills = [];
  const arcs = [];
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    setLineDash() {},
    fill() {},
    stroke() {},
    fillRect(...args) {
      fills.push([this.fillStyle, ...args]);
    },
    arc(...args) {
      arcs.push(args);
    }
  };
  return { ctx, fills, arcs };
}

test("both native hooks paint candle interiors and circles while honoring hidden bodies", () => {
  const instance = core.createTechnicalIndicatorInstance("moon-phases", "moon");
  const render = new TechnicalRenderData();
  render.setData(bars);
  const regions = render.compile([instance]).priceRegions;
  const width = 120;
  const height = 90;
  const x = (index) => 10 + index * 20;
  const y = (price) => 160 - price;
  const { lightweightCalendarRegions } = load("charts/lightweight-calendar-regions.js");
  let primitive;
  const series = {
    attachPrimitive(value) {
      primitive = value;
      value.attached({ requestUpdate() {} });
    },
    detachPrimitive(value) {
      assert.equal(value, primitive);
      primitive = undefined;
      value.detached();
    },
    priceToCoordinate: y,
    dataByIndex(index) {
      const bar = bars[index];
      return bar ? { ...bar, time: bar.timestamp / 1000 } : null;
    }
  };
  const chart = {
    timeScale: () => ({
      getVisibleLogicalRange: () => ({ from: 0, to: bars.length - 1 }),
      logicalToCoordinate: x,
      timeToCoordinate: (second) =>
        x(bars.findIndex(({ timestamp }) => timestamp / 1000 === second))
    })
  };
  const lw = lightweightCalendarRegions(
    chart,
    {},
    () => true,
    () => series
  );
  lw.update(regions);
  const lightweight = canvas();
  primitive
    .paneViews()[1]
    .renderer()
    .draw({
      useMediaCoordinateSpace(draw) {
        draw({ context: lightweight.ctx, mediaSize: { width, height } });
      }
    });
  assert.equal(primitive.autoscaleInfo(), null);
  assert.equal(lightweight.fills.length, bars.length);
  assert.equal(lightweight.arcs.length, 2);
  assert.equal(lightweight.arcs[0][0], x(1));
  assert.equal(lightweight.arcs[1][0], x(3));
  lw.update([]);
  assert.equal(primitive, undefined);

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
  const native = klineCalendarRegions(kChart, { settings: { bodyVisible: false } }, () => true);
  native.update(regions);
  assert.equal(template.name, "PERSONAL_TA_MOON_PHASES");
  assert.equal(template.series, "normal");
  assert.deepEqual(template.figures, []);
  const kline = canvas();
  template.draw({
    ctx: kline.ctx,
    bounding: { width, height },
    barSpace: { gapBar: 18 },
    kLineDataList: bars,
    visibleRange: { from: 0, to: bars.length },
    indicator: installed,
    xAxis: { convertToPixel: x },
    yAxis: { convertToPixel: y }
  });
  assert.deepEqual(kline.fills, []);
  assert.deepEqual(kline.arcs, lightweight.arcs);
  native.dispose();
  assert.equal(installed, undefined);
});

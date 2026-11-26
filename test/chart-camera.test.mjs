import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { utils as klineFormat } from "../node_modules/klinecharts/dist/index.esm.js";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function sources(overrides = {}, globals = {}) {
  const context = vm.createContext({ console, Date, Math, Map, ...globals }),
    modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative).replace(/\.js$/, ".ts"),
      key = path.relative(root, file).replaceAll(path.sep, "/");
    if (key === "services/storage-v2.ts" && Object.hasOwn(overrides, "services/storage.ts")) return overrides["services/storage.ts"];
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${code}\n})`).runInContext(context)(
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

test("shared camera crosses symbols without old date anchors; same-symbol reload retains anchor", () => {
  const { chooseChartView, PendingChartView, signedRightOffset } =
      sources()("charts/view-camera.ts"),
    saved = {
      camera: { barSpace: 9, rightOffsetBars: -18 },
      anchor: { timestamp: 1000, xFraction: 0.2 }
    },
    shared = { symbol: "GAZP", camera: { barSpace: 12, rightOffsetBars: -41 } };
  assert.equal(chooseChartView("GAZP", saved, shared), saved);
  const switched = chooseChartView("RTSI", saved, shared);
  assert.equal(switched.camera.barSpace, 12);
  assert.equal(switched.camera.rightOffsetBars, -41);
  assert.equal(switched.anchor, undefined);
  const queue = new PendingChartView();
  queue.stage(switched);
  assert.equal(queue.take(false), null);
  assert.equal(queue.take(true), switched);
  assert.equal(queue.take(true), null);
  assert.equal(signedRightOffset(800, 1034, 12), -20);
});

test("camera persistence scopes owner/engine/timeframe and keeps signed historical offset", async () => {
  const db = new Map(),
    views = new Map();
  const load = sources({
    "services/storage-db.ts": {
      get: async (_store, key) => db.get(key),
      put: async (_store, record) => {
        db.set(record.id, record);
      }
    },
    "services/storage.ts": {
      saveView: async (owner, key, value) => {
        views.set(`${owner}:${key}`, value);
      },
      loadView: async (owner, key) => views.get(`${owner}:${key}`)
    }
  });
  const { saveChartView, loadChartView } = load("services/chart-camera.ts"),
    view = {
      camera: { barSpace: 13.5, rightOffsetBars: -123.25 },
      anchor: { timestamp: 2000, xFraction: 0.5 }
    };
  await saveChartView("owner1", "GAZP:1d:kline:365", view);
  const switched = await loadChartView("owner1", "RTSI:1d:kline:365");
  assert.equal(switched.camera.barSpace, 13.5);
  assert.equal(switched.camera.rightOffsetBars, -123.25);
  assert.equal(switched.anchor, undefined);
  assert.equal((await loadChartView("owner1", "GAZP:1d:kline:365")).anchor.timestamp, 2000);
  assert.equal(await loadChartView("owner2", "RTSI:1d:kline:365"), undefined);
  assert.equal(await loadChartView("owner1", "RTSI:1h:kline:365"), undefined);
  assert.equal(await loadChartView("owner1", "RTSI:1d:tradingview:365"), undefined);
  await saveChartView("owner1", "RUS:GAZP:1d:kline:365", view);
  assert.equal((await loadChartView("owner1", "RUS:GAZP:1d:kline:365")).anchor.timestamp, 2000);
  assert.equal((await loadChartView("owner1", "RUS:RTSI:1d:kline:365")).anchor, undefined);
});

function harness(engine, row = { symbol: "GAZP", step: 0.01 }) {
  let data = [],
    spacing = 8,
    offset = 8,
    dataWrites = 0,
    paneWrites = 0;
  const actions = new Map(),
    calls = [], priceFormats = [], formatRedraws = [],
    primitives = [],
    frames = new Map();
  let constructedOptions;
  const priceLabels = new Set();
  let frameId = 0,
    drawScheduled = false,
    nativeOperations = [],
    sizeChanged = () => {};
  const requestAnimationFrame = (callback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame = (id) => frames.delete(id),
    queueNative = (operation) => {
      nativeOperations.push(operation);
      if (drawScheduled) return;
      drawScheduled = true;
      requestAnimationFrame(() => {
        drawScheduled = false;
        const operations = nativeOperations;
        nativeOperations = [];
        for (const commit of operations) commit();
      });
    };
  const size = { width: 800, height: 500 },
    pixel = (index) =>
      size.width -
      (data.length - index + offset - 0.5) * spacing -
      (engine === "lightweight" ? 1 : 0);
  const model = {
    MtpModel: class {
      reset() {}
      update() {}
    },
    activeMtpPeriods: () => [],
    lightweightMtp: () => ({ update() {}, destroy() {} })
  };
  const options = {
    container: { clientWidth: 870, clientHeight: 528, parentElement: { append() {} } },
    row,
    timeframe: "1d",
    rangeDays: 365,
    settings: {},
    indicators: {},
    paint() {},
    onNearStart() {},
    onCrosshair() {}
  };
  let factory;
  if (engine === "lightweight") {
    const scale = {
      width: () => size.width,
      options: () => ({ barSpacing: spacing }),
      scrollPosition: () => offset,
      scrollToPosition(value) {
        queueNative(() => {
          offset = value;
          calls.push("restore");
        });
      },
      applyOptions(value) {
        queueNative(() => {
          if (value.barSpacing) spacing = value.barSpacing;
          if (value.rightOffset != null) offset = value.rightOffset;
          calls.push("restore");
        });
      },
      getVisibleLogicalRange: () =>
        data.length
          ? { from: data.length + offset - size.width / spacing, to: data.length - 1 + offset }
          : null,
      getVisibleRange: () =>
        data.length ? { from: data[0].timestamp / 1000, to: data.at(-1).timestamp / 1000 } : null,
      setVisibleRange() {
        assert.ok(data.length, "public visible range must never be requested before data");
        queueNative(() => {
          spacing = 2;
          offset = 8;
          calls.push("fit");
        });
      },
      logicalToCoordinate: pixel,
      subscribeVisibleLogicalRangeChange() {},
      subscribeSizeChange(callback) {
        sizeChanged = callback;
      }
    };
    let firstSeries = true;
    const chart = {
      timeScale: () => scale,
      subscribeCrosshairMove() {},
      addSeries: (_type, nativeOptions) => {
        const candles = firstSeries;
        firstSeries = false;
        if (candles) priceFormats.push(nativeOptions.priceFormat);
        return {
          applyOptions(patch) { if (candles && patch.priceFormat) priceFormats.push(patch.priceFormat); },
          setData(next) {
            if (candles) {
              dataWrites++;
              data = next;
              sizeChanged();
            }
          },
          setSeriesOrder() {},
          createPriceLine(options) {
            const line = { options: { ...options }, applyOptions(patch) {
              Object.assign(this.options, patch);
            } };
            priceLabels.add(line);
            return line;
          },
          removePriceLine(line) { priceLabels.delete(line); },
          attachPrimitive(primitive) {
            primitives.push(primitive);
          },
          priceToCoordinate: (value) => value,
          priceScale: () => ({ applyOptions() {} })
        };
      }
    };
    factory = sources(
      {
        "lightweight-charts": {
          createChart: (_container, options) => {
            constructedOptions = options;
            queueNative(() => {});
            return chart;
          },
          ColorType: { Solid: 1 },
          CrosshairMode: { Normal: 1 }
        },
        "model/mtp.ts": model,
        "model/history-codec.ts": { TIMEFRAMES: { "1d": { ms: 86400000 } } },
        "model/candle-palette.ts": { lineColor: (value) => value }
      },
      { requestAnimationFrame, cancelAnimationFrame }
    )("charts/lightweight.ts").makeLightweight;
  } else {
    const chart = {
      getDom: () => null,
      setPaneOptions(options) {
        paneWrites++;
        assert.equal(options.id, "x_axis_pane");
        assert.equal(typeof options.axisOptions.name, "string");
      },
      setPriceVolumePrecision(precision) { priceFormats.push({ precision }); },
      setStyles(patch) { formatRedraws.push(patch); },
      getSize: () => size,
      resize() {},
      subscribeAction: (name, callback) => actions.set(name, callback),
      applyNewData(next) {
        dataWrites++;
        data = next;
        offset = 8;
      },
      removeIndicator() {},
      createIndicator() {},
      overrideIndicator() {},
      getDataList: () => data,
      getVisibleRange() {
        const to = Math.round(data.length + offset + 0.5);
        return {
          from: Math.max(0, Math.round(to - size.width / spacing) - 1),
          to: Math.min(data.length, to),
          realFrom: to - size.width / spacing,
          realTo: to
        };
      },
      setBarSpace(value) {
        spacing = value;
        calls.push("spacing");
      },
      getBarSpace: () => spacing,
      scrollToRealTime() {
        offset = 8;
        calls.push("fit");
      },
      getOffsetRightDistance: () => Math.max(0, offset * spacing),
      setOffsetRightDistance(value) {
        offset = value / spacing;
        calls.push("restore");
      },
      scrollByDistance(value) {
        offset -= value / spacing;
      },
      convertToPixel: ([point]) => [{ x: pixel(point.dataIndex), y: 100 }],
      convertFromPixel: ([point]) => [
        {
          dataIndex: Math.max(
            0,
            Math.min(
              data.length - 1,
              Math.round(data.length + offset - (size.width - point.x) / spacing)
            )
          ),
          value: 100
        }
      ]
    };
    const ctx = { setTransform() {}, clearRect() {} };
    factory = sources(
      {
        klinecharts: {
          init: () => chart,
          registerIndicator() {},
          registerXAxis() {},
          ActionType: { OnDataReady: "ready" },
          DomPosition: { Main: "main" },
          IndicatorSeries: { Price: "price" },
          TooltipShowRule: { None: "none" }
        },
        "model/mtp.ts": model,
        "model/history-codec.ts": { TIMEFRAMES: { "1d": { ms: 86400000 } } },
        "model/candle-palette.ts": { lineColor: (value) => value }
      },
      {
        requestAnimationFrame,
        cancelAnimationFrame,
        ResizeObserver: class {
          observe() {}
        },
        devicePixelRatio: 1,
        document: { createElement: () => ({ style: {}, getContext: () => ctx }) }
      }
    )("charts/kline.ts").makeKline;
  }
  return {
    adapter: factory(options),
    ready: () => {
      actions.get("ready")?.();
      for (let round = 0; frames.size && round < 30; round++) {
        const pending = [...frames.entries()];
        frames.clear();
        for (const [, callback] of pending) callback();
      }
      assert.equal(frames.size, 0, "restoration frames must settle");
    },
    calls,
    priceFormats,
    formatRedraws,
    chartOptions: () => constructedOptions,
    primitives,
    priceLabels,
    nativeWrites: () => ({ dataWrites, paneWrites }),
    nativeLastPriceLabel: () => klineFormat.formatPrecision(data.at(-1)?.close, priceFormats.at(-1)?.precision),
    camera: () => ({ spacing, offset })
  };
}

for(const engine of ["lightweight","kline"]){
 test(`${engine} unknown tick uses actual quote precision before metadata, expands without jitter, and yields to a real step`,()=>{
  const f=harness(engine,{symbol:"TGKA",uid:"tgka",step:null,price:.004842});
  f.adapter.source={owner:"A",uid:"tgka",viewKey:`TGKA:1d:${engine}:365`};
  if(engine==="lightweight")assert.equal(f.priceFormats[0].formatter(.004842),"0.004842");
  else assert.equal(f.priceFormats[0].precision,6);
  f.adapter.setData(Array.from({length:1200},(_,i)=>({timestamp:Date.UTC(2022,0,1)+i*86400000,open:.0048,high:.0049,low:.0047,close:.004842,volume:1})),false);f.ready();
  f.adapter.setView({camera:{barSpace:1.0550660792951543,rightOffsetBars:-444.16359109010153}});f.ready();
  const before=f.camera();f.calls.length=0;
  f.adapter.updatePriceFormat({owner:"A",uid:"tgka",step:null,priceHint:.004842001});f.ready();
  if(engine==="lightweight")assert.equal(f.priceFormats.at(-1).formatter(.004842001),"0.004842001");
  else assert.equal(f.priceFormats.at(-1).precision,9);
  const expanded=f.priceFormats.length;
  f.adapter.updatePriceFormat({owner:"A",uid:"tgka",step:null,priceHint:.0048});assert.equal(f.priceFormats.length,expanded);
  f.adapter.updatePriceFormat({owner:"B",uid:"tgka",step:null,priceHint:.004842111});assert.equal(f.priceFormats.length,expanded);
  f.adapter.updatePriceFormat({owner:"A",uid:"tgka",step:.000002});f.ready();assert.equal(f.priceFormats.at(-1).precision,6);
  const resolved=f.priceFormats.length;
  f.adapter.updatePriceFormat({owner:"A",uid:"tgka",step:null,priceHint:.004842111});assert.equal(f.priceFormats.length,resolved);
  assert.deepEqual(f.camera(),before);assert.deepEqual(f.calls,[]);
 });
 test(`${engine} late price metadata updates precision without data, camera, canvas or label replacement`,()=>{
  const f=harness(engine,{symbol:"VTBR",uid:"vtbr",step:null});
  f.adapter.source={owner:"A",uid:"vtbr",viewKey:`VTBR:1d:${engine}:365`};
  const bars=Array.from({length:1200},(_,i)=>({timestamp:Date.UTC(2022,0,1)+i*86400000,open:57.35,high:57.38,low:57.33,close:57.365,volume:1}));
  f.adapter.setData(bars,false);f.ready();
  f.adapter.setView({camera:{barSpace:1.0550660792951543,rightOffsetBars:-444.16359109010153}});f.ready();
  const before=f.camera(),label=[...f.priceLabels][0],nativeBefore=f.nativeWrites();f.calls.length=0;
  f.adapter.updatePriceFormat({owner:"A",uid:"vtbr",step:.005,priceHint:57.365});f.ready();
  assert.equal(f.priceFormats.at(-1).precision,3);
  if (engine === "kline") {
    assert.equal(f.formatRedraws.length, 1, "precision invalidates native labels immediately");
    assert.deepEqual(Object.keys(f.formatRedraws[0]), ["yAxis"]);
    assert.deepEqual(Object.keys(f.formatRedraws[0].yAxis), ["size"]);
    assert.equal(f.formatRedraws[0].yAxis.size, 78, "reserve space for three fractional digits");
    assert.equal(f.nativeLastPriceLabel(), "57.365");
  }
  if(engine==="lightweight")assert.equal(f.priceFormats.at(-1).minMove,.005);
  assert.deepEqual(f.camera(),before);assert.deepEqual(f.calls,[]);
  assert.deepEqual(f.nativeWrites(), nativeBefore);
  if(engine==="lightweight"){assert.equal([...f.priceLabels][0],label);assert.equal(label.options.price,57.365);}
  const count=f.priceFormats.length;
  for(const metadata of [{owner:"B",uid:"vtbr",step:.000002},{owner:"A",uid:"other",step:.000002},
    ...[null,0,-1,NaN,Infinity].map(step=>({owner:"A",uid:"vtbr",step}))])f.adapter.updatePriceFormat(metadata);
  f.adapter.updatePriceFormat({owner:"A",uid:"vtbr",step:.005});assert.equal(f.priceFormats.length,count);
  if(engine==="kline")assert.equal(f.formatRedraws.length,1);
  f.adapter.retired=true;f.adapter.updatePriceFormat({owner:"A",uid:"vtbr",step:.000002});assert.equal(f.priceFormats.length,count);
  f.adapter.retired=false;f.adapter.updatePriceFormat({owner:"A",uid:"vtbr",step:.000002});f.ready();
  assert.equal(f.priceFormats.at(-1).precision,6);assert.deepEqual(f.camera(),before);assert.deepEqual(f.calls,[]);
  assert.deepEqual(f.nativeWrites(), nativeBefore);
  if (engine === "kline") assert.equal(f.nativeLastPriceLabel(), "57.365000");
 });
}

test("Lightweight binds real and visible future calendar grid to the bottom primitive without changing camera", () => {
  const f = harness("lightweight");
  const bars = Array.from({ length: 91 }, (_, index) => ({
    timestamp: Date.UTC(2024, 0, 1) + index * 86400000,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    volume: 1
  }));
  f.adapter.setData(bars, false);
  f.ready();
  assert.equal(f.chartOptions().grid.vertLines.visible, false);
  assert.equal(f.chartOptions().grid.horzLines.visible, true);
  const camera = f.camera();
  const starts = [];
  const context = {
    save() {},
    restore() {},
    scale() {},
    beginPath() {},
    setLineDash() {},
    stroke() {},
    moveTo: (x, y) => starts.push({ x, y }),
    lineTo() {}
  };
  const target = {
    useBitmapCoordinateSpace: (draw) =>
      draw({
        context,
        horizontalPixelRatio: 1,
        verticalPixelRatio: 1,
        bitmapSize: { width: 800, height: 500 }
      })
  };
  const views = f.primitives[0].paneViews();
  assert.equal(views[0].zOrder(), "bottom");
  views[0].renderer().draw(target);
  assert.equal(starts.length, 4);
  const future = f.adapter.pointToPixel({ timestamp: Date.UTC(2024, 3, 1), value: 11 });
  assert.equal(starts.at(-1).x, Math.round(future.x) + 0.5);
  views[1].renderer().draw(target);
  assert.equal(starts.length, 4, "front drawing layer cannot duplicate calendar grid lines");
  assert.deepEqual(f.camera(), camera);
  assert.equal(bars.length, 91);
});

test("last-price label contrasts with both directional fills and removes stale prices on empty data", () => {
  const f = harness("lightweight");
  const bar = { timestamp: Date.UTC(2026, 0, 1), open: 10, high: 12, low: 9, close: 11, volume: 1 };
  f.adapter.setData([bar], false);
  f.ready();
  assert.equal(f.priceLabels.size, 1);
  const label = [...f.priceLabels][0];
  assert.equal(label.options.price, 11);
  assert.equal(label.options.axisLabelTextColor, "#000000");
  f.adapter.setData([{ ...bar, close: 9.5 }], false);
  assert.equal(f.priceLabels.size, 1);
  assert.equal([...f.priceLabels][0], label);
  assert.equal(label.options.price, 9.5);
  assert.equal(label.options.axisLabelTextColor, "#000000");
  f.adapter.setData([], false);
  assert.equal(f.priceLabels.size, 0);
});

for (const engine of ["lightweight", "kline"])
  test(`${engine}: empty-chart restore waits until data and survives initial fit`, () => {
    const { adapter, ready, calls, camera } = harness(engine),
      view = { camera: { barSpace: 11, rightOffsetBars: -37 } },
      candles = Array.from({ length: 400 }, (_, index) => ({
        timestamp: Date.now() - (400 - index) * 86400000,
        open: 90,
        high: 95,
        low: 85,
        close: 92,
        volume: 100
      }));
    adapter.setView(view);
    assert.equal(calls.length, 0);
    adapter.setData(candles, true);
    ready();
    assert.equal(camera().spacing, 11);
    assert.equal(camera().offset, -37);
    assert.ok(calls.indexOf("restore") > calls.indexOf("fit"));
    const before = adapter.getView();
    assert.equal(before.camera.barSpace, 11);
    assert.equal(before.camera.rightOffsetBars, -37);
    if (engine === "kline") {
      assert.equal(before.from, candles[290].timestamp / 1000);
      assert.equal(before.to, candles[363].timestamp / 1000);
    }
    const prepend = candles
      .slice(0, 30)
      .map((bar) => ({ ...bar, timestamp: bar.timestamp - 30 * 86400000 }));
    adapter.setData([...prepend, ...candles], false);
    adapter.setView(before);
    ready();
    assert.equal(camera().spacing, 11);
    assert.ok(
      Math.abs(camera().offset + 37) < 1e-10,
      "prepending data retains the same date anchor and signed gap"
    );
  });

test("Lightweight repeated native reconfiguration restores the exact camera with queued public setters", () => {
  const candles = Array.from({ length: 2600 }, (_, index) => ({
    timestamp: 1500000000000 + index * 86400000,
    open: 90,
    high: 95,
    low: 85,
    close: 92,
    volume: 100
  }));
  let view = { camera: { barSpace: 1.0550660792951543, rightOffsetBars: -2 } };
  for (let cycle = 0; cycle < 6; cycle++) {
    const { adapter, ready, camera } = harness("lightweight");
    adapter.setView(view);
    adapter.setData(candles, true);
    assert.equal(adapter.getView(), null, "do not persist an unsettled camera");
    ready();
    assert.equal(camera().spacing, 1.0550660792951543);
    assert.ok(Math.abs(camera().offset + 2) < 1e-9, `cycle ${cycle} must retain the right gap`);
    view = adapter.getView();
  }
});

test("history rejects out-of-order symbol results and a changed UID before publishing candles", async () => {
  const requests = new Map();
  let state = {
    owner: "owner",
    preferences: {
      symbol: "GAZP",
      timeframe: "1d",
      engine: "kline",
      rangeDays: 365,
      indicators: {}
    },
    rows: [
      { symbol: "GAZP", uid: "uid-gazp" },
      { symbol: "RTSI", uid: "uid-rtsi" }
    ],
    loading: false,
    candles: []
  };
  const client = {
    candles(symbol) {
      return new Promise((resolve) => requests.set(symbol, resolve));
    }
  };
  const load = sources(
    {
      "services/storage.ts": { loadDrawings: async () => [], loadImages: async () => [] },
      "services/chart-camera.ts": { loadChartView: async () => undefined },
      "model/mtp.ts": { activeMtpPeriods: () => [] },
      "screens/terminal/controller-bridge.ts": {
        errorText: String,
        isAbort: () => false,
        viewKey: (p) => `${p.symbol}:${p.timeframe}:${p.engine}:${p.rangeDays}`
      }
    },
    { AbortController, setTimeout, clearTimeout, navigator: { onLine: true } }
  );
  const { TerminalHistory } = load("screens/terminal/controller-history.ts"),
    history = new TerminalHistory({
      getState: () => state,
      getClient: () => client,
      getChart: () => null,
      isAlive: () => true,
      notify() {},
      update: (patch) => {
        state = { ...state, ...patch };
      }
    });
  const first = history.load();
  await new Promise(setImmediate);
  history.reset();
  state = { ...state, loading: false, preferences: { ...state.preferences, symbol: "RTSI" } };
  const second = history.load();
  await new Promise(setImmediate);
  const result = (close) => ({ candles: [{ timestamp: 1700000000000, close }], requests: 1 });
  requests.get("RTSI")(result(1000));
  await second;
  requests.get("GAZP")(result(89));
  await first;
  assert.equal(state.preferences.symbol, "RTSI");
  assert.equal(state.candles[0].close, 1000);
  const changedUid = history.load();
  await new Promise(setImmediate);
  state = {
    ...state,
    rows: state.rows.map((row) => (row.symbol === "RTSI" ? { ...row, uid: "replacement" } : row))
  };
  requests.get("RTSI")(result(1234));
  await changedUid;
  assert.equal(state.candles[0].close, 1000);
});

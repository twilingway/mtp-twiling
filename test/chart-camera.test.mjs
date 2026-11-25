import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function sources(overrides = {}, globals = {}) {
  const context = vm.createContext({ console, Date, Math, Map, ...globals }),
    modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative).replace(/\.js$/, ".ts"),
      key = path.relative(root, file).replaceAll(path.sep, "/");
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

function harness(engine) {
  let data = [],
    spacing = 8,
    offset = 8;
  const actions = new Map(),
    calls = [],
    frames = new Map();
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
    row: { symbol: "GAZP", step: 0.01 },
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
      addSeries: () => {
        const candles = firstSeries;
        firstSeries = false;
        return {
          setData(next) {
            if (candles) {
              data = next;
              sizeChanged();
            }
          },
          setSeriesOrder() {},
          attachPrimitive() {},
          priceScale: () => ({ applyOptions() {} })
        };
      }
    };
    factory = sources(
      {
        "lightweight-charts": {
          createChart: () => {
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
      setPriceVolumePrecision() {},
      getSize: () => size,
      resize() {},
      subscribeAction: (name, callback) => actions.set(name, callback),
      applyNewData(next) {
        data = next;
        offset = 8;
      },
      removeIndicator() {},
      createIndicator() {},
      getDataList: () => data,
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
    camera: () => ({ spacing, offset })
  };
}

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
      "model/mtp.ts": { activeMtpPeriods: () => [] },
      "model/history-codec.ts": { TIMEFRAMES: { "1d": { ms: 86400000 } } },
      "screens/terminal/controller-bridge.ts": { errorText: String, isAbort: () => false }
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

import test from "node:test";
import assert from "node:assert/strict";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";
import {
  captureIntent,
  controller,
  panes,
  preferences,
  metrics,
  tick
} from "./technical-pane-capture-order-fixture.mjs";

for (const engine of ["kline", "tradingview"])
  test(`${engine}: actual chart lifecycle forwards resize context into queued writer and retains retired guard`, async () => {
    const ids = ["size1", "size2", "size3", "size4"],
      layout = preferences(ids),
      c = controller(panes(), layout, engine),
      effects = [],
      cleanups = [];
    c.update({
      authenticated: true,
      rows: [{ symbol: "ONE", uid: "uid", step: 0.01 }],
      candles: [],
      drawings: [],
      preferences: {
        ...c.getSnapshot().preferences,
        rangeDays: 365,
        chartSettings: {},
        indicators: {
          ma: false,
          ema: false,
          volume: false,
          mtp160: false,
          mtp440: false,
          mtp640: false,
          mtpAll: false
        }
      }
    });
    c.chart = null;
    c.notify = (message) => assert.fail(message);
    let options;
    const factory = (value) => {
      options = value;
      return {
        destroy() {},
        updateTechnicalIndicators() {},
        updatePriceFormat() {},
        getView: () => null,
        setView() {},
        setData() {},
        redrawDrawings() {}
      };
    };
    const load = createSourceLoader({
      react: {
        useRef: (value) => ({ current: value }),
        useMemo: (factory) => factory(),
        useEffect: (action) => effects.push(action)
      },
      "screens/terminal/context.js": {
        useTerminal: () => ({ controller: c, state: c.getSnapshot() })
      },
      "charts/kline.js": { makeKline: factory },
      "charts/lightweight.js": { makeLightweight: factory },
      "services/chart-camera.js": {
        loadChartView: async () => undefined,
        saveAdapterView: async () => {},
        saveChartView: async () => {}
      },
      "screens/terminal/controller-camera-sync.js": { cameraCallbacks: () => ({}) },
      "screens/terminal/chart-price-metadata.js": { watchChartPriceMetadata: () => () => {} },
      "model/drawing-model.js": { paintDrawings() {} }
    });
    load("screens/terminal/chart-lifecycle.js").useChartCanvas({ current: {} }, () => []);
    for (const effect of effects) {
      const cleanup = effect();
      if (cleanup) cleanups.push(cleanup);
    }
    await tick();
    assert.ok(options);
    const snapshot = captureIntent(
      layout,
      metrics(ids, [165, 166, 165, 166]),
      metrics(ids, [165, 222, 109, 166])
    );
    let release;
    c.gate = new Promise((resolve) => {
      release = resolve;
    });
    const earlier = load("screens/terminal/technical-indicator-actions.js").changeTechnicalPane(
      c,
      "size1",
      true
    );
    await tick();
    options.onTechnicalPaneLayout(snapshot.layout, snapshot.context);
    release();
    await earlier;
    await tick();
    assert.equal(c.writes.length, 2);
    assert.equal(
      c.getSnapshot().preferences.technicalPaneLayout.find((p) => p.paneId === "size1").collapsed,
      true
    );
    c.chart.retired = true;
    options.onTechnicalPaneLayout(snapshot.layout, snapshot.context);
    await tick();
    assert.equal(c.writes.length, 2);
    for (const cleanup of cleanups.reverse()) cleanup();
    assert.equal(c.listeners.size, 0);
  });

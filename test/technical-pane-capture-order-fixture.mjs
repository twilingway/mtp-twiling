import assert from "node:assert/strict";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";
export const load = createSourceLoader();
export const { createTechnicalIndicatorInstance: make } = load(
  "model/technical-indicators/instances.js"
);
export const actions = load("screens/terminal/technical-indicator-actions.js");
export const model = load("model/technical-indicator-layout.js");
export const {
  capturedTechnicalLayout: capture,
  captureTechnicalPaneLayout: captureIntent,
  technicalPaneGeometry: geometry
} = load("charts/technical-pane-geometry.js");
export const panes = (ids = ["size1", "size2", "size3", "size4"]) =>
  ids.map((id, order) => make("rsi", id, { order }));
export const preferences = (ids, ratio = 0.18) =>
  ids.map((paneId) => ({ paneId, heightRatio: ratio, collapsed: false }));
export function metrics(ids, heights, price = 258) {
  let top = price + 1;
  return [
    { key: "price", top: 0, height: price, width: 900 },
    ...ids.map((id, index) => {
      const value = { key: `pane:${id}`, top, height: heights[index], width: 900 };
      top += value.height + 1;
      return value;
    })
  ];
}
export function controller(instances = panes(), layout = [], engine = "kline") {
  let state = {
    owner: "one",
    chartRevision: 1,
    preferences: {
      symbol: "ONE",
      instrumentUid: "uid",
      timeframe: "1d",
      engine,
      technicalIndicators: instances,
      technicalPaneLayout: layout
    }
  };
  const listeners = new Set(),
    writes = [],
    session = {};
  const result = {
    getSnapshot: () => state,
    sessionKey: () => session,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(patch) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
    async setPreferences(patch, reload, valid) {
      assert.equal(reload, false);
      await result.gate;
      if (!valid()) return;
      result.update({ preferences: { ...state.preferences, ...patch } });
      writes.push(structuredClone(patch));
    },
    gate: Promise.resolve(),
    listeners,
    writes
  };
  return result;
}
export const tick = () => new Promise((resolve) => setImmediate(resolve));

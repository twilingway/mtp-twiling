import assert from "node:assert/strict";
import * as jsx from "react/jsx-runtime";
import { createSourceLoader, core } from "./technical-state-oscillator-fixture.mjs";

export function walk(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => walk(child, predicate));
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...walk(node.props?.children, predicate)];
}
export function text(node) {
  if (Array.isArray(node)) return node.map(text).join("");
  if (node && typeof node === "object") return text(node.props?.children);
  return node == null ? "" : String(node);
}
export function settings(id, locale = "ru") {
  const instance = core.createTechnicalIndicatorInstance(id, id);
  let state = {
    owner: "profile",
    chartRevision: 1,
    dialog: "technical-settings",
    preferences: {
      locale,
      symbol: "SBER",
      instrumentUid: "uid",
      timeframe: "1d",
      engine: "kline",
      technicalIndicators: [instance],
      technicalPaneLayout: []
    }
  };
  const slots = [],
    tasks = [],
    listeners = new Set(),
    writes = [],
    session = {};
  let cursor = 0;
  const controller = {
    getSnapshot: () => state,
    sessionKey: () => session,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async setPreferences(patch, reload, valid) {
      assert.equal(reload, false);
      if (!valid()) return;
      state = { ...state, preferences: { ...state.preferences, ...patch } };
      writes.push(patch);
      listeners.forEach((listener) => listener());
    },
    setDialog(dialog) {
      state = { ...state, dialog };
    }
  };
  const load = createSourceLoader({
    react: {
      useRef(value) {
        const index = cursor++;
        return (slots[index] ??= { current: value });
      },
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [
          slots[index],
          (value) => {
            slots[index] = typeof value === "function" ? value(slots[index]) : value;
          }
        ];
      }
    },
    "react/jsx-runtime": jsx,
    "screens/terminal/context.js": { useTerminal: () => ({ controller, state }) },
    "screens/terminal/Modal.js": { Modal: () => null },
    "screens/terminal/useIndicatorMenuAction.js": {
      useIndicatorMenuAction: () => ({
        pending: false,
        run(action) {
          const promise = action();
          tasks.push(promise);
          return promise;
        }
      })
    }
  });
  const { TechnicalIndicatorSettings } = load("screens/terminal/TechnicalIndicatorSettings.js");
  const render = () => {
    cursor = 0;
    return TechnicalIndicatorSettings({ instance });
  };
  const control = (tree, label) => {
    const wrapper = walk(
      tree,
      (node) =>
        node.type === "label" &&
        node.props.children?.[0]?.type === "span" &&
        text(node.props.children[0]) === label
    )[0];
    assert.ok(wrapper, label);
    return walk(wrapper, (node) => node.type === "input" || node.type === "select")[0];
  };
  const submit = async (tree) => {
    walk(tree, (node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
    await Promise.all(tasks);
  };
  return { render, control, submit, writes, controller };
}

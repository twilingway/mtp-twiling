import test from "node:test";
import assert from "node:assert/strict";
import * as react from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

function component(state, calls = []) {
  let index = 0;
  const hooks = {
    ...react,
    useState: (value) => [
      index++ === 0 ? { available: true, invalid: false, copied: false, history: 1 } : value,
      () => {}
    ],
    useEffect: () => {}
  };
  const load = sourceModules({
    react: hooks,
    "react/jsx-runtime": jsx,
    "screens/terminal/context.tsx": {
      useTerminal: () => ({ controller: { sessionKey: () => null }, state })
    },
    "screens/terminal/legacy-guest-recovery.ts": {
      downloadLegacyGuestWorkspace: async (_controller, history, download) => {
        calls.push({ history, download });
      }
    },
    "services/storage-guest-recovery.ts": {
      inspectLegacyGuestWorkspace: async () => ({ available: true })
    }
  });
  return load("screens/terminal/LegacyGuestRecovery.js").LegacyGuestRecovery;
}
function nodes(element) {
  if (!element || typeof element !== "object") return [];
  return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
}
test("offline recovery exposes working download and warning, and stays absent for bank owners", () => {
  const calls = [],
    state = { owner: "public", authenticated: false, marketReady: false },
    element = component(state, calls)({ includeHistory: true, active: true }),
    list = nodes(element),
    button = list.find((node) => node.type === "button");
  assert.equal(button.props.disabled, false, "quote network readiness must not block local export");
  button.props.onClick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].history, true);
  assert.equal(typeof calls[0].download, "function");
  const html = renderToStaticMarkup(element);
  assert.match(html, /export-legacy-guest/);
  assert.match(html, /Экспорт/);
  assert.match(html, /импорт/i);
  assert.equal(
    component({ ...state, owner: "bank-A", authenticated: true })({
      includeHistory: false,
      active: true
    }),
    null
  );
  assert.equal(component(state)({ includeHistory: false, active: false }), null);
});
test("all recovery messages have Russian and English wording", () => {
  const { guestRecoveryText } = sourceModules()("i18n/messages-guest-recovery.js");
  for (const key of [
    "title",
    "found",
    "copied",
    "warning",
    "export",
    "busy",
    "failed",
    "invalid",
    "offline"
  ])
    assert.notEqual(guestRecoveryText(key, "ru"), guestRecoveryText(key, "en"));
});

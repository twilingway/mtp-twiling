import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

function nullContainer() {
  class Element {}
  const view = { HTMLElement: Element, HTMLIFrameElement: class extends Element {} };
  const document = {
    nodeType: 9,
    addEventListener() {},
    removeEventListener() {},
    activeElement: null,
    defaultView: view
  };
  return {
    nodeType: 1,
    tagName: "DIV",
    nodeName: "DIV",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: document,
    addEventListener() {},
    removeEventListener() {}
  };
}
function provider(id) {
  const listeners = new Set();
  let status = {
    provider: id,
    enabled: true,
    configured: false,
    prepared: true,
    preparing: false,
    connected: true,
    automatic: false,
    phase: "idle",
    pendingChanges: false,
    authorizationStored: false,
    credentialSaveError: false,
    mode: "test",
    uploadProbeBytes: 0
  };
  return {
    id,
    getSnapshot: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    prepare: async () => {},
    update(patch) {
      status = { ...status, ...patch };
      listeners.forEach((listener) => listener());
    }
  };
}

test("cloud hooks ignore quote/candle commits while blockers, language and provider progress stay live", async (t) => {
  const savedWindow = globalThis.window;
  globalThis.window = { event: undefined, HTMLIFrameElement: class {} };
  const google = provider("google-drive"),
    yandex = provider("yandex-disk");
  const load = sourceModules({
    react: React,
    "react/jsx-runtime": jsx,
    "screens/terminal/controller-cloud-sync.ts": {
      CLOUD_PROVIDERS: [google.id, yandex.id],
      terminalCloudSync: (_controller, id) => (id === google.id ? google : yandex)
    },
    "screens/terminal/controller-drive.ts": { terminalGoogleRetention: () => google }
  });
  const { TerminalContext } = load("screens/terminal/context.tsx"),
    { CloudSyncSettings } = load("screens/terminal/CloudSyncSettings.tsx"),
    { CloudProviderSettings } = load("screens/terminal/CloudProviderSettings.tsx"),
    { CloudPauseBanner } = load("screens/terminal/CloudPauseBanner.tsx"),
    { GoogleDriveSettings } = load("screens/terminal/GoogleDriveSettings.tsx"),
    display = load("i18n/preferences.ts");
  display.setDisplayPreferences({ locale: "ru" });
  let state = {
    owner: "device",
    ready: true,
    preferences: { locale: "ru" },
    rows: [{ uid: "one", symbol: "ONE", price: 10 }],
    candles: [{ timestamp: 1, close: 10 }]
  };
  const listeners = new Set(),
    counts = {},
    latest = {};
  const controller = {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(patch) {
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener());
    }
  };
  // Execute actual component hooks; discard markup instead of fabricating DOM/layout results.
  function SettingsReader() {
    latest.settings = CloudSyncSettings();
    return null;
  }
  function CardReader() {
    latest.card = CloudProviderSettings({ provider: google });
    return null;
  }
  function BannerReader() {
    const banner = CloudPauseBanner().props.children[0];
    latest.banner = banner.type(banner.props);
    return null;
  }
  function NativeWrapperReader() {
    latest.native = GoogleDriveSettings();
    return null;
  }
  function RetentionReader() {
    const detail = GoogleDriveSettings();
    latest.retention = detail.type(detail.props);
    return null;
  }
  const tracked = (id, Component) =>
    React.createElement(
      React.Profiler,
      {
        id,
        key: id,
        onRender: () => {
          counts[id] = (counts[id] ?? 0) + 1;
        }
      },
      React.createElement(Component)
    );
  const root = createRoot(nullContainer());
  try {
    flushSync(() =>
      root.render(
        React.createElement(TerminalContext, { value: controller }, [
          tracked("settings", SettingsReader),
          tracked("card", CardReader),
          tracked("banner", BannerReader),
          tracked("native", NativeWrapperReader),
          tracked("retention", RetentionReader)
        ])
      )
    );
    const initial = { ...counts };
    for (let price = 11; price < 31; price++)
      flushSync(() =>
        controller.update({
          rows: [{ ...state.rows[0], price }],
          candles: [{ timestamp: price, close: price }],
          updatedAt: price,
          preferences: { ...state.preferences }
        })
      );
    const commits = Object.fromEntries(
      Object.keys(counts).map((id) => [id, counts[id] - initial[id]])
    );
    assert.deepEqual(commits, { settings: 0, card: 0, banner: 0, native: 0, retention: 0 });
    t.diagnostic(JSON.stringify({ quoteCandleUpdates: 20, commits }));

    for (const field of [
      "profileTransition",
      "backupBusy",
      "importRecoveryRequired",
      "workspaceMigrationIncomplete",
      "loading",
      "ready",
      "preview",
      "activeTool"
    ]) {
      const before = counts.card;
      const value =
        field === "ready"
          ? false
          : field === "preview"
            ? {}
            : field === "activeTool"
              ? "line"
              : true;
      flushSync(() => controller.update({ [field]: value }));
      assert.equal(counts.card, before + 1, field);
      flushSync(() => controller.update({ [field]: field === "ready" ? true : undefined }));
      assert.equal(counts.card, before + 2, field);
    }
    const beforeLocale = { ...counts };
    display.setDisplayPreferences({ locale: "en" });
    flushSync(() => controller.update({ preferences: { ...state.preferences, locale: "en" } }));
    for (const id of ["settings", "card", "banner", "retention"])
      assert.equal(counts[id], beforeLocale[id] + 1, `locale ${id}`);
    assert.equal(counts.native, beforeLocale.native);
    assert.match(renderToStaticMarkup(latest.card), /Enable sync/);

    const beforeProgress = { ...counts };
    flushSync(() =>
      google.update({
        phase: "syncing",
        progress: { stage: "verify", completedBytes: 40, totalBytes: 100 }
      })
    );
    assert.equal(counts.card, beforeProgress.card + 1);
    assert.equal(counts.banner, beforeProgress.banner + 1);
    assert.equal(counts.retention, beforeProgress.retention + 1);
    assert.equal(counts.settings, beforeProgress.settings);
    assert.equal(counts.native, beforeProgress.native);
    assert.match(renderToStaticMarkup(latest.card), /Verifying saved data/);
    assert.match(renderToStaticMarkup(latest.card), /value="40" max="100"/);
    flushSync(() => google.update({ enabled: false, phase: "disabled", error: "network" }));
    assert.equal(latest.banner, null);
    assert.doesNotMatch(renderToStaticMarkup(latest.card), /Verifying saved data|role="alert"/);
  } finally {
    flushSync(() => root.unmount());
    await new Promise(setImmediate);
    if (savedWindow === undefined) delete globalThis.window;
    else globalThis.window = savedWindow;
  }
});

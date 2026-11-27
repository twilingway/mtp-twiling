import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

function fixture(patch = {}, locale = "en", id = "google-drive") {
  const calls = [],
    listeners = new Set(),
    stateListeners = new Set();
  let status = {
    provider: id,
    enabled: true,
    configured: true,
    prepared: true,
    preparing: false,
    connected: true,
    automatic: false,
    phase: "idle",
    pendingChanges: false,
    authorizationStored: false,
    credentialSaveError: false,
    mode: "normal",
    uploadProbeBytes: 0,
    ...patch
  };
  let state = { owner: "device", ready: true, preferences: { locale }, rows: [], candles: [] };
  const google = {
    id,
    getSnapshot: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    prepare: async () => {},
    runUploadProbe: async () => {
      calls.push(["probe"]);
    },
    setEnabled: async (enabled) => {
      calls.push(["enabled", enabled]);
      update({ enabled, phase: enabled ? "idle" : "disabled" });
    },
    disconnect: async () => {
      calls.push(["disconnect"]);
      update({ connected: false, enabled: false, phase: "disabled" });
    }
  };
  function update(patch) {
    status = { ...status, ...patch };
    listeners.forEach((listener) => listener());
  }
  const controller = {
    getSnapshot: () => state,
    subscribe: (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    notify: (message) => calls.push(["notice", message])
  };
  const load = sourceModules({
    react: React,
    "react/jsx-runtime": jsx,
    "screens/terminal/controller-drive.ts": { terminalGoogleRetention: () => google }
  });
  const { TerminalContext } = load("screens/terminal/context.tsx"),
    { GoogleDriveSettings } = load("screens/terminal/GoogleDriveSettings.tsx"),
    { CloudProviderSettings } = load("screens/terminal/CloudProviderSettings.tsx");
  load("i18n/preferences.ts").setDisplayPreferences({ locale });
  const wrap = (child) => React.createElement(TerminalContext, { value: controller }, child);
  return {
    calls,
    google,
    load,
    wrap,
    update,
    GoogleDriveSettings,
    CloudProviderSettings,
    render: () =>
      renderToStaticMarkup(
        wrap(
          React.createElement(
            CloudProviderSettings,
            { provider: google },
            React.createElement(GoogleDriveSettings)
          )
        )
      ),
    quote(price) {
      state = {
        ...state,
        rows: [{ uid: "one", price }],
        candles: [{ timestamp: price, close: price }]
      };
      stateListeners.forEach((listener) => listener());
    }
  };
}

test("GoogleDriveSettings normal flow has no required probe or expanded diagnostic, even without a saved proof", () => {
  for (const locale of ["ru", "en"]) {
    const f = fixture({}, locale),
      html = f.render();
    assert.match(html, /<details class="cloud-google-details">/);
    assert.match(html, /<details class="cloud-google-diagnostics">/);
    const normal = html.replace(
      /<details class="cloud-google-diagnostics">[\s\S]*?<\/details>/,
      ""
    );
    assert.doesNotMatch(
      normal,
      /Check the connection again|Повторить проверку подключения|Перед отправкой нужно|Загрузка ещё не проверена|0 bytes/
    );
    assert.match(html, locale === "en" ? /Google diagnostics/ : /Диагностика Google/);
    assert.deepEqual(f.calls, []);
  }
});

test("GoogleDriveSettings migration, archive readback, previous restore and Testing controls remain available", () => {
  const f = fixture({
    migrationRequired: true,
    archive: { count: 2, bytes: 500, verified: true },
    previousVersions: [{ id: "previous", size: 200 }]
  });
  const html = f.render();
  assert.match(html, /class="cloud-google-details" open=""/);
  assert.match(html, /type="file"[^>]*accept=".mtp-drive-archive,application\/octet-stream"/);
  assert.match(html, /Download legacy archive/);
  assert.match(html, /Restore previous version/);
  assert.match(html, /value="normal"/);
  assert.match(html, /value="test"/);
  assert.match(html, /<details class="cloud-google-diagnostics">/);
});

test("GoogleDriveSettings automatic connection check shows progress without workspace success or byte-budget labels", () => {
  const f = fixture({
    phase: "syncing",
    progress: { stage: "upload", completedBytes: 12345, totalBytes: 345678 },
    lastSyncedAt: "2026-11-27T10:00:00Z",
    choiceAction: { state: "confirmed", selection: { kind: "local" } },
    writeCapability: {
      phase: "checking",
      verifiedBytes: 0,
      requiredBytes: 345678,
      cleanupPending: 0
    }
  });
  const html = f.render();
  assert.match(html, /Checking connection/);
  assert.match(html, /<progress aria-label="Checking connection…"><\/progress>/);
  assert.doesNotMatch(
    html,
    /Operation confirmed|This device&#x27;s version was sent|Sending data|345678|12345/
  );
  assert.doesNotMatch(html.match(/<input[^>]*id="google-drive-enabled"[^>]*>/)[0], /disabled/);
  assert.match(html, /id="google-drive-disconnect" type="button">/);
  assert.deepEqual(f.calls, []);
});

test("GoogleDriveSettings cleanup notice stays outside collapsed details and does not claim workspace synchronization", () => {
  const f = fixture({
    writeCapability: {
      phase: "cleanup-pending",
      verifiedBytes: 500,
      requiredBytes: 500,
      cleanupPending: 1
    }
  });
  const html = f.render();
  assert.match(html, /data-google-write-capability="cleanup-pending"/);
  assert.ok(
    html.indexOf("temporary connection-check data") < html.indexOf('class="cloud-google-details"')
  );
  assert.doesNotMatch(html, /Operation confirmed|This device&#x27;s version was sent/);
});

function nullContainer() {
  class Element {}
  const view = { HTMLElement: Element, HTMLIFrameElement: class extends Element {} };
  const doc = {
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
    ownerDocument: doc,
    addEventListener() {},
    removeEventListener() {}
  };
}
function find(element, predicate) {
  if (!React.isValidElement(element)) return undefined;
  if (predicate(element)) return element;
  for (const child of React.Children.toArray(element.props.children)) {
    const result = find(child, predicate);
    if (result) return result;
  }
}

test("GoogleDriveSettings checking is cancellable, independent and has zero quote/candle commits or automatic view probes", async (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = { event: undefined, HTMLIFrameElement: class {} };
  const f = fixture(),
    counts = { native: 0, card: 0 },
    latest = {};
  const yandex = fixture({}, "en", "yandex-disk");
  function NativeReader() {
    const detail = f.GoogleDriveSettings();
    latest.native = detail.type(detail.props);
    return null;
  }
  function CardReader() {
    latest.card = f.CloudProviderSettings({ provider: f.google });
    return null;
  }
  function YandexReader() {
    latest.yandex = yandex.CloudProviderSettings({ provider: yandex.google });
    return null;
  }
  const root = createRoot(nullContainer());
  const track = (id, Component) =>
    React.createElement(
      React.Profiler,
      { id, key: id, onRender: () => counts[id]++ },
      React.createElement(Component)
    );
  try {
    flushSync(() =>
      root.render(
        f.wrap([
          track("native", NativeReader),
          track("card", CardReader),
          React.cloneElement(yandex.wrap(React.createElement(YandexReader)), { key: "yandex" })
        ])
      )
    );
    flushSync(() =>
      f.update({
        phase: "syncing",
        progress: { stage: "upload" },
        writeCapability: {
          phase: "checking",
          verifiedBytes: 0,
          requiredBytes: 500,
          cleanupPending: 0
        }
      })
    );
    const before = { ...counts };
    for (let price = 1; price <= 20; price++) flushSync(() => f.quote(price));
    assert.deepEqual(counts, before);
    t.diagnostic(JSON.stringify({ quoteCandleUpdates: 20, commits: { native: 0, card: 0 } }));
    const toggle = find(latest.card, (element) => element.props.id === "google-drive-enabled");
    assert.equal(toggle.props.disabled, undefined);
    flushSync(() => toggle.props.onChange({ target: { checked: false } }));
    await new Promise(setImmediate);
    assert.deepEqual(f.calls, [["enabled", false]]);
    assert.equal(f.google.getSnapshot().enabled, false);
    assert.equal(latest.native, null);
    assert.doesNotMatch(
      renderToStaticMarkup(latest.card),
      /Checking connection|Google diagnostics|temporary connection-check data/
    );
    assert.equal(yandex.google.getSnapshot().enabled, true);
    assert.equal(yandex.google.getSnapshot().connected, true);
    assert.deepEqual(yandex.calls, []);
  } finally {
    flushSync(() => root.unmount());
    await new Promise(setImmediate);
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

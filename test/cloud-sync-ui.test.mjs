import test from "node:test";
import assert from "node:assert/strict";
import * as react from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceModules } from "./helpers/watchlist-sections.mjs";
function provider(id, patch = {}) {
  const snapshot = {
    provider: id,
    enabled: false,
    configured: true,
    prepared: true,
    preparing: false,
    connected: false,
    automatic: true,
    phase: "disabled",
    pendingChanges: false,
    authorizationStored: false,
    credentialSaveError: false,
    ...patch
  };
  return {
    id,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    prepare: async () => {},
    setEnabled: async () => {},
    setAutomatic: async () => {},
    disconnect: async () => {},
    connectFromUserGesture: async () => {},
    sync: async () => {},
    choose: async () => {}
  };
}
function modules(providers = new Map()) {
  const state = { owner: "device", ready: true, preferences: { locale: "en" } };
  const controller = { getSnapshot: () => state, subscribe: () => () => {}, setDialog() {} };
  const load = sourceModules({
    react,
    "react/jsx-runtime": jsx,
    "screens/terminal/context.tsx": { useTerminal: () => ({ state, controller }) },
    "screens/terminal/controller-cloud-sync.ts": {
      CLOUD_PROVIDERS: ["google-drive", "yandex-disk"],
      terminalCloudSync: (_controller, id) => providers.get(id)
    }
  });
  load("i18n/preferences.ts").setDisplayPreferences({ locale: "en" });
  return load;
}

test("disabled provider hides retained conflicts and errors and never mounts native detail", () => {
  const load = modules(),
    { CloudProviderSettings } = load("screens/terminal/CloudProviderSettings.tsx");
  let rendered = false;
  const Native = () => {
    rendered = true;
    return jsx.jsx("p", { children: "native-detail" });
  };
  const html = renderToStaticMarkup(
    jsx.jsx(CloudProviderSettings, {
      provider: provider("google-drive", {
        error: "unsupported-format",
        phase: "error",
        conflict: { local: { instruments: 1, drawings: 1, images: 1 }, remotes: [] }
      }),
      children: jsx.jsx(Native, {})
    })
  );
  assert.equal(rendered, false);
  assert.match(html, /Sync is disabled/);
  assert.doesNotMatch(html, /role="alert"|Choose a version|native-detail/);
  assert.match(html, /data-phase="disabled"/);
});

test("missing Yandex config is explicit and a pending readback never renders a success receipt", () => {
  const load = modules(),
    { CloudProviderSettings } = load("screens/terminal/CloudProviderSettings.tsx");
  const missing = renderToStaticMarkup(
    jsx.jsx(CloudProviderSettings, {
      provider: provider("yandex-disk", {
        enabled: true,
        configured: false,
        prepared: false,
        phase: "error",
        error: "configuration-required"
      })
    })
  );
  assert.equal((missing.match(/Application OAuth configuration is required/g) ?? []).length, 1);
  assert.match(missing, /disabled=""[^>]*>Connect/);
  const pending = renderToStaticMarkup(
    jsx.jsx(CloudProviderSettings, {
      provider: provider("yandex-disk", {
        enabled: true,
        connected: true,
        phase: "syncing",
        lastSyncedAt: "2026-11-27T10:00:00Z",
        progress: { stage: "verify", completedBytes: 40, totalBytes: 100 }
      })
    })
  );
  assert.match(pending, /Verifying saved data/);
  assert.match(pending, /value="40" max="100"/);
  assert.doesNotMatch(pending, /Operation confirmed/);
  assert.match(pending, /Waiting for cloud verification/);
});

test("each conflict offers explicit receive/send choices and retains device data warning", () => {
  const load = modules(),
    { CloudProviderSettings } = load("screens/terminal/CloudProviderSettings.tsx");
  const html = renderToStaticMarkup(
    jsx.jsx(CloudProviderSettings, {
      provider: provider("yandex-disk", {
        enabled: true,
        connected: true,
        phase: "conflict",
        conflict: {
          local: { instruments: 3, drawings: 2, images: 1 },
          remotes: [{ id: "other-account-branch", instruments: 4, drawings: 1, images: 0 }]
        }
      })
    })
  );
  assert.match(html, /Receive this version/);
  assert.match(html, /Send this device/);
  assert.match(html, /Receiving replaces supported settings/);
  assert.match(html, /Cloud snapshots are retained/);
});

test("disabled Google renders no banner while independently enabled Yandex conflict remains visible", () => {
  const providers = new Map([
    ["google-drive", provider("google-drive", { phase: "auth-required", error: "auth-required" })],
    [
      "yandex-disk",
      provider("yandex-disk", { enabled: true, phase: "conflict", pendingChanges: true })
    ]
  ]);
  const load = modules(providers),
    { CloudPauseBanner } = load("screens/terminal/CloudPauseBanner.tsx");
  const html = renderToStaticMarkup(jsx.jsx(CloudPauseBanner, {}));
  assert.doesNotMatch(html, /data-provider="google-drive"/);
  assert.match(html, /data-provider="yandex-disk"/);
  assert.match(html, /Choose a version/);
  assert.doesNotMatch(html, /Sign in again/);
});

test("failed local credential cleanup stays visible and retryable after disabling", () => {
  const load = modules(),
    { CloudProviderSettings } = load("screens/terminal/CloudProviderSettings.tsx");
  const html = renderToStaticMarkup(
    jsx.jsx(CloudProviderSettings, {
      provider: provider("google-drive", { credentialSaveError: true })
    })
  );
  assert.match(html, /Could not save or remove sign-in/);
  assert.match(html, /Retry removing saved sign-in/);
  assert.doesNotMatch(html, /Operation confirmed/);
});

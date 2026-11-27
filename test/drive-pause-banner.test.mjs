import assert from "node:assert/strict";
import test from "node:test";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

function fixture() {
  const status = { provider: "google-drive", enabled: false, configured: true, prepared: false, preparing: false, connected: false, phase: "disabled", automatic: true, pendingChanges: false, authorizationStored: false, credentialSaveError: false };
  const state = { preferences: { locale: "en" }, name: "", marketReady: true };
  const controller = { subscribe: () => () => {}, getSnapshot: () => state,
    setDialog(dialog, initialAccountSection) { Object.assign(state, { dialog, initialAccountSection }); }
  };
  const drive = { subscribe: () => () => {}, getSnapshot: () => status };
  const yandex = { subscribe: () => () => {}, getSnapshot: () => ({ enabled: false }) };
  const load = sourceModules({
    react: {
      useEffect: () => {}, useState: (initial) => [initial, () => {}],
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
    }, "react/jsx-runtime": jsx,
    "screens/terminal/context.tsx": {
      useTerminal: (select) => ({ controller, state: select ? select(state) : state }),
      useTerminalController: () => controller,
      useTerminalState: (_controller, select) => select(state)
    },
    "screens/terminal/controller-cloud-sync.ts": { CLOUD_PROVIDERS: ["google-drive", "yandex-disk"], terminalCloudSync: (_controller, id) => id === "google-drive" ? drive : yandex },
    "screens/terminal/CloudSyncSettings.tsx": { CloudSyncSettings: () => null },
    "screens/terminal/BackupTransferSettings.tsx": { BackupTransferSettings: () => null },
    "screens/terminal/StoragePanel.tsx": { StoragePanel: () => null },
    "screens/terminal/ApplicationInfo.tsx": { ApplicationInfo: () => null },
    "screens/terminal/LegacyGuestRecovery.tsx": { LegacyGuestRecovery: () => null },
    "screens/terminal/Modal.tsx": { Modal: ({ children }) => children }
  });
  load("i18n/preferences.ts").setDisplayPreferences({ locale: "en" });
  return { status, state, render: load("screens/terminal/DrivePauseBanner.js").DrivePauseBanner,
    account: () => renderToStaticMarkup(load("screens/terminal/AccountDialog.js").AccountDialog()),
    locale(value) { state.preferences.locale = value; load("i18n/preferences.ts").setDisplayPreferences({ locale: value }); }
  };
}

test("cloud banner remains absent while disabled and opens the shared cloud tab when action is required", () => {
  const f = fixture(), markup = () => renderToStaticMarkup(f.render());
  assert.match(f.account(), /id="account-section-cloud" hidden=""/);
  assert.equal(markup(), "");
  Object.assign(f.status, { phase: "auth-required", pauseReason: "auth-required", pendingChanges: true, lastSyncedAt: "2026-11-26T08:00:00Z" });
  assert.equal(markup(), "");
  f.status.enabled = true;
  assert.match(markup(), /role="status"/); assert.match(markup(), /Sign in again/);
  assert.match(markup(), /class="drive-pause-pending"/);
  const providerElement = f.render().props.children[0];
  const action = providerElement.type(providerElement.props).props.children;
  action.props.onClick();
  assert.equal(f.state.dialog, "account"); assert.equal(f.state.initialAccountSection, "cloud");
  assert.match(f.account(), /id="account-section-cloud">/);
  f.state.initialAccountSection = "drive";
  assert.match(f.account(), /id="account-section-cloud">/);
  f.status.pendingChanges = false;
  assert.doesNotMatch(markup(), /class="drive-pause-pending"/);
  f.locale("ru");
  assert.doesNotMatch(markup(), /Sign in again/);
  Object.assign(f.status, { enabled: false, automatic: false });
  assert.equal(markup(), "");
});

test("enabled cloud banners distinguish offline, conflicts and unsupported format without stale pause during a retry", () => {
  const f = fixture(), markup = () => renderToStaticMarkup(f.render());
  Object.assign(f.status, { enabled: true, phase: "error", connected: true, pauseReason: "offline" });
  assert.match(markup(), /Offline/);
  f.status.phase = "syncing";
  assert.equal(markup(), "");
  Object.assign(f.status, { phase: "error", pauseReason: "network" });
  assert.match(markup(), /Cannot reach cloud storage/);
  Object.assign(f.status, { phase: "conflict", pauseReason: undefined, automatic: false });
  assert.match(markup(), /Choose a version/);
  Object.assign(f.status, { phase: "error", error: "unsupported-format" });
  assert.match(markup(), /Update the app/);
  f.status.enabled = false;
  assert.equal(markup(), "");
});

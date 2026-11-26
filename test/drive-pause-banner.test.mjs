import assert from "node:assert/strict";
import test from "node:test";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

function fixture() {
  const status = { phase: "disconnected", automatic: true, pendingChanges: false };
  const state = { preferences: { locale: "ru" }, name: "", marketReady: true };
  let online = true;
  const controller = {
    subscribe: () => () => {},
    getSnapshot: () => state,
    setDialog(dialog, initialAccountSection) {
      Object.assign(state, { dialog, initialAccountSection });
    }
  };
  const drive = { subscribe: () => () => {}, getSnapshot: () => status };
  const load = sourceModules({
    react: {
      memo: (render) => render,
      useContext: () => controller,
      useEffect: () => {},
      useRef: (current) => ({ current }),
      useState: (initial) => [initial, () => {}],
      useSyncExternalStore: (subscribe, getSnapshot) =>
        subscribe === drive.subscribe || subscribe === controller.subscribe ? getSnapshot() : online
    },
    "react/jsx-runtime": jsx,
    "screens/terminal/context.tsx": {
      TerminalContext: {},
      useTerminal: () => ({ controller, state })
    },
    "screens/terminal/controller-drive.ts": { terminalDrive: () => drive },
    "screens/terminal/GoogleDriveSettings.tsx": { GoogleDriveSettings: () => null },
    "screens/terminal/StoragePanel.tsx": { StoragePanel: () => null },
    "screens/terminal/ApplicationInfo.tsx": { ApplicationInfo: () => null },
    "screens/terminal/LegacyGuestRecovery.tsx": { LegacyGuestRecovery: () => null },
    "screens/terminal/Modal.tsx": { Modal: ({ children }) => children }
  });
  return {
    status,
    state,
    setOnline: (value) => {
      online = value;
    },
    render: load("screens/terminal/DrivePauseBanner.js").DrivePauseBanner,
    account: () => renderToStaticMarkup(load("screens/terminal/AccountDialog.js").AccountDialog())
  };
}

test("Drive banner waits for a linked automatic profile and opens its existing settings tab", () => {
  const f = fixture();
  const markup = () => renderToStaticMarkup(f.render());
  const hidden = () => assert.match(markup(), /data-active="false"/);
  assert.match(f.account(), /id="account-section-drive" hidden=""/);
  hidden();
  Object.assign(f.status, { pauseReason: "auth-required", pendingChanges: true });
  hidden();
  Object.assign(f.status, { lastSyncedAt: "2026-11-26T08:00:00Z", automatic: false });
  hidden();
  f.status.automatic = true;
  assert.match(markup(), /role="status" aria-atomic="true"/);
  assert.match(markup(), /data-reason="auth"/);
  assert.match(markup(), /Войдите в Google повторно/);
  assert.match(markup(), /Изменения ещё не синхронизированы/);
  const action = f.render().props.children[1];
  assert.equal(action.props["aria-describedby"], "drive-pause-description");
  assert.deepEqual(
    action.props.children.slice(0, 3).map(({ props }) => props.children),
    ["Google Диск", "Нужен вход", "Не отправлено"]
  );
  action.props.onClick();
  assert.equal(f.state.dialog, "account");
  assert.match(f.account(), /id="account-section-drive">/);

  f.state.preferences.locale = "en";
  f.status.pendingChanges = false;
  assert.match(markup(), /Sign in to Google again/);
  assert.doesNotMatch(markup(), /Changes haven.t synced yet/);
  assert.doesNotMatch(markup(), /class="drive-pause-pending"/);
  f.status.pauseReason = undefined;
  hidden();
});

test("Drive banner distinguishes offline, remote failure, conflicts and forced format pause", () => {
  const f = fixture();
  const markup = () => renderToStaticMarkup(f.render());
  Object.assign(f.status, { phase: "idle", connected: true, connectedThisSession: true });
  f.setOnline(false);
  assert.match(markup(), /Нет интернета/);
  f.setOnline(true);
  Object.assign(f.status, { phase: "syncing", pauseReason: "offline" });
  assert.match(markup(), /Связь восстановлена/);
  Object.assign(f.status, { phase: "syncing", pauseReason: "network" });
  assert.match(markup(), /Нет связи с Google Диском/);
  Object.assign(f.status, { phase: "conflict", pauseReason: undefined });
  assert.match(markup(), /data-reason="conflict"/);
  assert.match(markup(), /class="drive-pause-reason">Конфликт версий/);
  assert.match(markup(), /выберите версию рабочего пространства/);
  f.status.legacyAvailable = true;
  assert.match(markup(), /data-reason="legacy"/);
  assert.match(markup(), /class="drive-pause-reason">Старые версии/);
  assert.match(markup(), /проверьте снимки старого формата/);
  Object.assign(f.status, { phase: "error", error: "unsupported-format", automatic: false });
  assert.match(markup(), /data-active="false"/);
  f.status.automaticBlockedByFormat = true;
  assert.match(markup(), /data-reason="format"/);
  assert.match(markup(), /Обновите приложение/);
  assert.doesNotMatch(markup(), /Изменения ещё не синхронизированы/);
});

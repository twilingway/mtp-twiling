import assert from "node:assert/strict";
import test from "node:test";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

function fixture() {
  const calls = [];
  const local = { instruments: 3, drawings: 2, images: 1, date: "2026-11-26T08:21:00.000Z" };
  const remote = { ...local, date: "2026-11-25T08:00:00.000Z", nodeId: "remote-1" };
  const status = {
    phase: "conflict",
    prepared: true,
    connected: true,
    conflict: { local, remotes: [remote, { ...remote, nodeId: "remote-2" }] }
  };
  const state = { owner: "profile", marketReady: true, backupBusy: false };
  const load = sourceModules({
    react: {
      useEffect() {},
      useState: (value) => [value, () => {}],
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
    },
    "react/jsx-runtime": jsx,
    "screens/terminal/context.tsx": { useTerminal: () => ({ controller: {}, state }) },
    "screens/terminal/controller-drive.ts": {
      terminalDrive: () => ({
        getSnapshot: () => status,
        choose: async (choice) => calls.push(choice)
      })
    }
  });
  const { GoogleDriveSettings } = load("screens/terminal/GoogleDriveSettings.js");
  const { setDisplayPreferences } = load("i18n/preferences.js");
  const page = () => GoogleDriveSettings();
  const section = (id) => page().props.children.find((node) => node?.props?.id === id);
  const conflict = () => section("google-drive-conflict");
  const buttons = (node) =>
    node.props.children
      .flat()
      .filter((child) => child?.type === "div")
      .map((child) => child.props.children.find(({ type }) => type === "button"));
  return {
    calls,
    local,
    remote,
    status,
    state,
    setDisplayPreferences,
    page,
    section,
    conflict,
    buttons
  };
}

test("Drive choice shows cloud first and keeps visible arrows wired to the correct versions", () => {
  const f = fixture();
  for (const [locale, download, upload, cloudTitle, localTitle, created, checked] of [
    [
      "ru",
      "Получить из Google Диска",
      "Отправить на Google Диск",
      "Версия на Google Диске",
      "Версия на этом устройстве",
      "Снимок создан",
      "Версия проверена"
    ],
    [
      "en",
      "Get from Google Drive",
      "Send to Google Drive",
      "Google Drive version",
      "Version on this device",
      "Snapshot created",
      "Version checked"
    ]
  ]) {
    f.setDisplayPreferences({ locale });
    const markup = renderToStaticMarkup(f.conflict());
    assert.ok(markup.includes(`<h5>${cloudTitle} 1</h5>`));
    assert.ok(markup.includes(`<h5>${cloudTitle} 2</h5>`));
    assert.ok(markup.includes(`<h5>${localTitle}</h5>`));
    assert.ok(markup.includes(`</span> ${download}`));
    assert.ok(markup.includes(`</span> ${upload}`));
    assert.ok(markup.includes(`${created}: <time dateTime="${f.remote.date}">`));
    assert.ok(markup.includes(`${checked}: <time dateTime="${f.local.date}">`));
  }
  const buttons = f.buttons(f.conflict());
  assert.deepEqual(
    buttons.map(({ props }) => props["data-drive-remote"]),
    [0, 1, undefined]
  );
  assert.deepEqual(
    buttons.map(({ props }) => props["aria-describedby"]),
    ["google-drive-receive-effect", "google-drive-receive-effect", "google-drive-send-effect"]
  );
  assert.equal(buttons.at(-1).props.id, "google-drive-choose-local");
  assert.deepEqual(
    buttons.map(({ props }) => props.children[0].props.children),
    ["↓", "↓", "↑"]
  );
  for (const { props } of buttons) props.onClick();
  assert.deepEqual(f.calls, ["remote-1", "remote-2", "local"]);

  f.state.backupBusy = true;
  assert.ok(f.buttons(f.conflict()).every(({ props }) => props.disabled));
});

test("empty Drive choice offers only upload and omits absent preview timestamps", () => {
  const f = fixture();
  f.status.conflict = { local: { ...f.local, date: undefined }, remotes: [] };
  const conflict = f.conflict();
  const markup = renderToStaticMarkup(conflict);
  assert.match(markup, /пока нет снимков этого профиля/);
  assert.doesNotMatch(markup, /<time|google-drive-receive-effect|data-drive-remote/);
  const [send] = f.buttons(conflict);
  assert.equal(f.buttons(conflict).length, 1);
  assert.equal(send.props.id, "google-drive-choose-local");
  send.props.onClick();
  assert.deepEqual(f.calls, ["local"]);
});

test("only the selected Drive button shows progress and the confirmed result replaces the choice", () => {
  const f = fixture();
  f.setDisplayPreferences({ locale: "ru" });
  for (const [nodeId, index, progress, result] of [
    ["local", 2, "Отправляем…", "Версия устройства отправлена на Google Диск."],
    ["remote-2", 1, "Получаем…", "Версия с Google Диска применена на устройстве."]
  ]) {
    f.status.phase = "syncing";
    f.status.choiceAction = { nodeId, state: "running" };
    const buttons = f.buttons(f.conflict());
    assert.ok(buttons.every(({ props }) => props.disabled));
    assert.deepEqual(
      buttons.map(({ props }) => props["aria-busy"]),
      buttons.map((_, position) => position === index)
    );
    assert.ok(renderToStaticMarkup(buttons[index]).includes(progress));
    assert.equal(f.section("google-drive-choice-result").props.role, "status");
    assert.doesNotMatch(
      renderToStaticMarkup(f.page()),
      /применена на устройстве|отправлена на Google Диск/u
    );

    const previous = f.status.conflict;
    f.status.conflict = undefined;
    f.status.phase = "idle";
    f.status.choiceAction = { nodeId, state: "confirmed" };
    assert.equal(f.conflict(), undefined);
    assert.equal(f.section("google-drive-choice-result").props.children, result);
    f.status.conflict = previous;
  }
});

test("Drive feedback explains review, blocked work, failures and retry in Russian and English", () => {
  const f = fixture();
  f.setDisplayPreferences({ locale: "ru" });
  f.status.choiceAction = { nodeId: "local", state: "review" };
  assert.match(renderToStaticMarkup(f.page()), /Сравните их и повторите выбор/u);
  f.state.loading = true;
  f.status.choiceAction.state = "blocked";
  assert.match(renderToStaticMarkup(f.page()), /Дождитесь загрузки графика/u);
  f.state.loading = false;
  f.status.choiceAction.state = "unconfirmed";
  f.status.conflict = undefined;
  f.status.phase = "error";
  f.status.error = "quota";
  const markup = renderToStaticMarkup(f.page());
  assert.match(markup, /Отправка на Google Диск не подтверждена/u);
  assert.match(markup, /Google временно ограничил запросы/u);
  assert.match(markup, /Повторить синхронизацию/u);
  f.status.error = "local-save";
  const checkpoint = renderToStaticMarkup(f.page());
  assert.match(checkpoint, /Не удалось сохранить отметку синхронизации на этом устройстве/u);
  assert.doesNotMatch(checkpoint, /Нет связи с Google/u);

  f.setDisplayPreferences({ locale: "en" });
  const english = renderToStaticMarkup(f.page());
  assert.match(english, /Sending to Google Drive was not confirmed/);
  assert.match(english, /Retry sync/);
});

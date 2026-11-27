import assert from "node:assert/strict";
import test from "node:test";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceModules } from "./helpers/watchlist-sections.mjs";
function walk(node, predicate, result = []) {
  if (Array.isArray(node)) node.forEach((item) => walk(item, predicate, result));
  else if (node?.props) { if (predicate(node)) result.push(node); walk(node.props.children, predicate, result); }
  return result;
}
function fixture() {
  const calls = [], local = { instruments: 3, drawings: 2, images: 1, date: "2026-11-26T08:21:00.000Z" };
  const remote = { ...local, date: "2026-11-25T08:00:00.000Z", id: "remote-1" };
  const status = { provider: "google-drive", enabled: true, configured: true, phase: "conflict", prepared: true, connected: true,
    automatic: false, conflict: { local, remotes: [remote, { ...remote, id: "remote-2" }] } };
  const state = { owner: "device", ready: true, marketReady: true, backupBusy: false };
  const provider = { id: "google-drive", getSnapshot: () => status, subscribe: () => () => {}, choose: async (choice) => { calls.push(choice); } };
  const load = sourceModules({ react: { useEffect() {}, useState: (value) => [value, () => {}], useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot() },
    "react/jsx-runtime": jsx, "screens/terminal/context.tsx": { useTerminal: () => ({ controller: {}, state }) } });
  const { CloudProviderSettings } = load("screens/terminal/CloudProviderSettings.js");
  const { setDisplayPreferences } = load("i18n/preferences.js");
  const page = () => CloudProviderSettings({ provider });
  const section = (id) => walk(page(), (node) => node.props.id === id)[0];
  return { calls, local, remote, status, state, setDisplayPreferences, page, section,
    conflict: () => section("google-drive-conflict"), buttons: (node) => walk(node, (child) => child.type === "button") };
}

test("shared cloud choice keeps both locales and arrows wired to exact remote/local selections", () => {
  const f = fixture();
  for (const [locale, download, upload, remoteTitle, localTitle, created, checked] of [
    ["en", "Receive this version", "Send this device&#x27;s version", "Cloud version", "Device version", "Snapshot created", "Version checked"],
    ["ru", "Получить эту версию", "Отправить версию устройства", "Версия в облаке", "Версия устройства", "Снимок создан", "Версия проверена"]
  ]) {
    f.setDisplayPreferences({ locale });
    const markup = renderToStaticMarkup(f.conflict());
    assert.ok(markup.includes(`<h5>${remoteTitle} 1</h5>`)); assert.ok(markup.includes(`<h5>${remoteTitle} 2</h5>`));
    assert.ok(markup.includes(`<h5>${localTitle}</h5>`));
    assert.ok(markup.includes(download)); assert.ok(markup.includes(upload));
    assert.ok(markup.includes(created)); assert.ok(markup.includes(checked));
    assert.ok(markup.includes(f.remote.date)); assert.ok(markup.includes(f.local.date));
  }
  const buttons = f.buttons(f.conflict());
  assert.deepEqual(buttons.map(({ props }) => props["data-cloud-remote"]), [0, 1, undefined]);
  assert.deepEqual(buttons.map(({ props }) => props["aria-describedby"]), ["google-drive-receive-effect", "google-drive-receive-effect", "google-drive-send-effect"]);
  assert.equal(buttons.at(-1).props.id, "google-drive-choose-local");
  assert.deepEqual(buttons.map(({ props }) => props.children[0].props.children), ["↓", "↓", "↑"]);
  buttons.forEach(({ props }) => props.onClick());
  assert.deepEqual(f.calls, [{ kind: "remote", id: "remote-1" }, { kind: "remote", id: "remote-2" }, { kind: "local" }]);
  f.state.backupBusy = true; assert.ok(f.buttons(f.conflict()).every(({ props }) => props.disabled));
});

test("empty cloud history offers only explicit send and omits absent preview timestamps", () => {
  const f = fixture(); f.setDisplayPreferences({ locale: "en" });
  f.status.conflict = { local: { ...f.local, date: undefined }, remotes: [] };
  const conflict = f.conflict(), markup = renderToStaticMarkup(conflict);
  assert.match(markup, /No snapshots are available/); assert.doesNotMatch(markup, /<time|google-drive-receive-effect|data-cloud-remote/);
  const [send] = f.buttons(conflict); assert.equal(f.buttons(conflict).length, 1);
  send.props.onClick(); assert.deepEqual(f.calls, [{ kind: "local" }]);
});

test("only the selected direction reports busy progress and success is shown only after confirmation", () => {
  const f = fixture(); f.setDisplayPreferences({ locale: "en" });
  for (const [selection, index, progress, result] of [
    [{ kind: "local" }, 2, "Sending", "The device version was sent to cloud storage."],
    [{ kind: "remote", id: "remote-2" }, 1, "Getting", "The cloud version was applied on this device."]
  ]) {
    f.status.phase = "syncing"; f.status.choiceAction = { selection, state: "running" };
    const buttons = f.buttons(f.conflict()); assert.ok(buttons.every(({ props }) => props.disabled));
    assert.deepEqual(buttons.map(({ props }) => props["aria-busy"]), buttons.map((_, position) => position === index));
    assert.ok(renderToStaticMarkup(buttons[index]).includes(progress));
    assert.doesNotMatch(renderToStaticMarkup(f.page()), /was applied on this device|was sent to cloud storage/);
    const previous = f.status.conflict; f.status.conflict = undefined; f.status.phase = "idle"; f.status.choiceAction = { selection, state: "confirmed" };
    assert.equal(f.conflict(), undefined); assert.equal(f.section("google-drive-choice-result").props.children, result);
    f.status.conflict = previous;
  }
});

test("review, blocked work, quota and local-save remain explicit and retryable", () => {
  const f = fixture(); f.setDisplayPreferences({ locale: "en" });
  f.status.choiceAction = { selection: { kind: "local" }, state: "review" };
  assert.match(renderToStaticMarkup(f.page()), /Versions changed/);
  f.state.loading = true; f.status.choiceAction.state = "blocked";
  assert.match(renderToStaticMarkup(f.page()), /Wait for the chart/);
  f.state.loading = false; f.status.choiceAction.state = "unconfirmed"; f.status.conflict = undefined; f.status.phase = "error"; f.status.error = "quota";
  const quota = renderToStaticMarkup(f.page()); assert.match(quota, /Sending to cloud storage is unconfirmed/); assert.match(quota, /quota exceeded/); assert.match(quota, /Retry sync/);
  f.status.error = "local-save"; const saved = renderToStaticMarkup(f.page());
  assert.match(saved, /Could not save the result on this device/); assert.doesNotMatch(saved, /Cannot reach cloud/);
});

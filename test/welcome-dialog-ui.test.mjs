import assert from "node:assert/strict";
import test from "node:test";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) return node.map((child) => find(child, predicate)).find(Boolean) ?? null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}

function fixture() {
  const state = { authenticated: false, dialog: "welcome" };
  const status = { ready: true, hidden: false, saving: false };
  const dialogs = [];
  const savedChoices = [];
  let choice = null;
  let saved = true;
  let focused = 0;
  const details = { open: false, querySelector: () => ({ focus: () => focused++ }) };
  const jsx = (type, props) => ({ type, props });
  const load = createSourceLoader({
    react: {
      useEffect() {},
      useRef: () => ({ current: details }),
      useSyncExternalStore: () => status,
      useState: (initial) =>
        typeof initial === "function"
          ? [initial(), () => {}]
          : [
              choice,
              (next) => {
                choice = next;
              }
            ]
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "i18n/messages.js": { t: (text) => text },
    "services/welcome-preferences.js": {
      loadWelcomeHidden: async () => false,
      saveWelcomeHidden: async () => {}
    },
    "screens/terminal/context.js": {
      useTerminal: () => ({ state, controller: { setDialog: (dialog) => dialogs.push(dialog) } })
    },
    "screens/terminal/Modal.js": { Modal: () => null }
  });
  const { WelcomeGate } = load("screens/terminal/WelcomeDialog.js");
  const { ServiceLinks } = load("screens/terminal/ServiceLinks.js");
  const model = {
    finish: async (hide) => {
      savedChoices.push(hide);
      return saved;
    }
  };
  return {
    state,
    status,
    dialogs,
    savedChoices,
    details,
    ServiceLinks,
    render() {
      const dialog = WelcomeGate({ startupSettled: true });
      return dialog.type({ model });
    },
    saveSucceeds: (value) => {
      saved = value;
    },
    focused: () => focused
  };
}

const byId = (tree, id) => find(tree, (node) => node.props?.id === id);
const tick = () => new Promise(setImmediate);

test("welcome presents charts as primary, keeps bank connection secondary, and hides optional detail initially", async () => {
  const f = fixture();
  const tree = f.render();
  assert.equal(tree.props.title, "MTP Twiling");
  const primary = byId(tree, "welcome-continue");
  assert.equal(primary.props.className, "primary-button");
  assert.equal(primary.props.children, "Открыть графики");
  assert.equal(byId(tree, "welcome-connect").props.className, undefined);
  const detail = find(tree, (node) => node.type === "details");
  assert.equal(detail.props.open, undefined);
  assert.ok(
    find(
      detail,
      (node) => node.props?.href === "https://developer.tbank.ru/invest/intro/intro/token"
    )
  );
  assert.ok(find(detail, (node) => node.props?.href === "https://www.tbank.ru/invest/settings/"));
  const links = find(tree, (node) => node.type === f.ServiceLinks);
  links.props.onHelp();
  assert.equal(f.details.open, true);
  assert.equal(f.focused(), 1);
  primary.props.onClick();
  await tick();
  assert.deepEqual(f.savedChoices, [false]);
  assert.deepEqual(f.dialogs, [null]);
});

test("device-level hide choice reaches both actions and Modal close; connected users keep charts without bank setup", async () => {
  const f = fixture();
  byId(f.render(), "welcome-do-not-show").props.onChange({ target: { checked: true } });
  byId(f.render(), "welcome-connect").props.onClick();
  await tick();
  assert.deepEqual(f.savedChoices, [true]);
  assert.deepEqual(f.dialogs, ["account"]);
  f.render().props.onClose();
  await tick();
  assert.deepEqual(f.savedChoices, [true, true]);
  assert.deepEqual(f.dialogs, ["account", null]);
  f.state.authenticated = true;
  const connected = f.render();
  assert.equal(byId(connected, "welcome-connect"), null);
  assert.equal(
    find(
      connected,
      (node) => node.props?.href === "https://developer.tbank.ru/invest/intro/intro/token"
    ),
    null
  );
  assert.equal(byId(connected, "welcome-continue").props.className, "primary-button");
});

test("saving and load readiness disable choice/actions; save errors preserve retry and explicit continue fallback", async () => {
  const f = fixture();
  for (const patch of [
    { ready: false, saving: false },
    { ready: true, saving: true }
  ]) {
    Object.assign(f.status, patch);
    const tree = f.render();
    for (const id of ["welcome-continue", "welcome-connect", "welcome-do-not-show"])
      assert.equal(byId(tree, id).props.disabled, true);
  }
  Object.assign(f.status, { ready: true, saving: false, error: "save" });
  f.saveSucceeds(false);
  const tree = f.render();
  assert.equal(byId(tree, "welcome-storage-error").props.role, "alert");
  byId(tree, "welcome-continue").props.onClick();
  await tick();
  assert.deepEqual(f.dialogs, []);
  f.saveSucceeds(true);
  byId(f.render(), "welcome-continue").props.onClick();
  await tick();
  assert.deepEqual(f.dialogs, [null]);
  const fallback = find(
    tree,
    (node) => node.type === "button" && node.props.children === "Продолжить без сохранения"
  );
  fallback.props.onClick();
  assert.deepEqual(f.dialogs, [null, null]);
});

test("shared service links provide exactly one help action and safe public code/privacy links", () => {
  const f = fixture();
  let helped = 0;
  const links = f.ServiceLinks({ onHelp: () => helped++ });
  assert.equal(links.type, "nav");
  const help = find(links, (node) => node.type === "button");
  help.props.onClick();
  assert.equal(helped, 1);
  assert.equal(help.props.children, "Помощь");
  for (const href of ["https://github.com/twilingway/mtp-twiling", "./privacy.html"]) {
    const link = find(links, (node) => node.props?.href === href);
    assert.equal(link.props.target, "_blank");
    assert.equal(link.props.rel, "noopener noreferrer");
    if (href === "./privacy.html") {
      assert.equal(link.props.children, "Приватность");
      assert.equal(link.props["aria-label"], "Политика конфиденциальности");
    }
  }
  assert.equal(
    find(f.ServiceLinks({}), (node) => node.type === "button"),
    null
  );
});

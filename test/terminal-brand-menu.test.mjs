import assert from "node:assert/strict";
import test from "node:test";
import { find } from "./controller-preference-routing-fixture.mjs";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

function fixture() {
  let requested = false;
  let focused = 0;
  let ref = 0;
  let accountState = {
    owner: "profile",
    ready: true,
    rows: [],
    preferences: {
      locale: "en",
      engine: "lightweight",
      timeframe: "1d",
      chartSettings: { theme: "dark", background: "#123456" }
    }
  };
  const accountActions = [];
  const editorActions = [];
  const controller = {
    setDialog: (dialog) => editorActions.push(dialog)
  };
  const account = {
    getSnapshot: () => accountState,
    setPreferences: async (patch) => accountActions.push(patch),
    setDialog: (dialog) => accountActions.push(dialog)
  };
  const jsx = (type, props) => ({ type, props });
  const noop = () => null;
  const load = createSourceLoader({
    react: {
      useState: () => [
        requested,
        (next) => {
          requested = typeof next === "function" ? next(requested) : next;
        }
      ],
      useRef: () => ({
        current: ref++ === 1 ? { focus: () => focused++ } : null
      }),
      useId: () => "brand-menu",
      useEffect: () => {}
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("fragment") },
    "screens/terminal/context.js": {
      useTerminal: () => ({
        controller,
        state: {
          ...accountState,
          preferences: { ...accountState.preferences, symbol: "BTCUSDT", instrumentUid: "btc" },
          rows: [{ symbol: "BTCUSDT", uid: "btc", ticker: "BTCUSDT" }]
        }
      })
    },
    "screens/terminal/ChartEngineSelect.js": { ChartEngineSelect: noop },
    "screens/terminal/NativeChartTypeMenu.js": { NativeChartTypeMenu: noop },
    "screens/terminal/ChartLayoutPicker.js": { ChartLayoutPicker: noop },
    "screens/terminal/workspace-sync-controller.js": { publishWorkspaceTimeframe: noop },
    "screens/terminal/TerminalFullscreenControl.js": { TerminalFullscreenControl: noop },
    "screens/terminal/TerminalIndicatorControls.js": { TerminalIndicatorControls: noop },
    "screens/terminal/MobileChartTools.js": { MobileChartTools: noop },
    "screens/terminal/intervals/TimeframeMenu.js": { TimeframeMenu: noop }
  });
  load("i18n/preferences.js").setDisplayPreferences({ locale: "en" });
  const { TerminalBrandMenu } = load("screens/terminal/TerminalBrandMenu.js");
  const { Toolbar } = load("screens/terminal/Toolbar.js");
  return {
    TerminalBrandMenu,
    menu() {
      ref = 0;
      return TerminalBrandMenu({ editor: controller, account, accountState });
    },
    toolbar: () => Toolbar({ accountController: account }),
    setAccountState: (patch) => {
      accountState = { ...accountState, ...patch };
    },
    account,
    controller,
    accountActions,
    editorActions,
    focusCount: () => focused
  };
}

const trigger = (tree) => find(tree, (node) => node.props.className === "brand");
const dialog = (tree) => find(tree, (node) => node.props.role === "dialog");
const button = (tree, name) =>
  find(tree, (node) => node.type === "button" && node.props.children === name);

test("logo opens MTP Twiling, focuses back on Escape and scopes settings actions", () => {
  const f = fixture();
  assert.equal(trigger(f.menu()).props["aria-expanded"], false);
  trigger(f.menu()).props.onClick();
  const menu = f.menu();
  assert.equal(dialog(menu).props.hidden, false);
  assert.equal(dialog(menu).props.id, trigger(menu).props["aria-controls"]);
  assert.equal(find(menu, (node) => node.type === "h2").props.children, "MTP Twiling");
  const theme = find(menu, (node) => node.type === "select" && node.props.value === "dark");
  const language = find(menu, (node) => node.type === "select" && node.props.value === "en");
  theme.props.onChange({ currentTarget: { value: "light" } });
  language.props.onChange({ currentTarget: { value: "ru" } });
  assert.deepEqual(f.accountActions, [
    { chartSettings: { theme: "light", background: "#123456" } },
    { locale: "ru" }
  ]);
  assert.deepEqual(f.editorActions, []);
  let stopped = false;
  menu.props.onKeyDown({
    key: "Escape",
    preventDefault() {},
    stopPropagation: () => {
      stopped = true;
    }
  });
  assert.equal(stopped, true);
  assert.equal(f.focusCount(), 1);
  assert.equal(trigger(f.menu()).props["aria-expanded"], false);
  trigger(f.menu()).props.onClick();
  button(f.menu(), "Chart settings").props.onClick();
  trigger(f.menu()).props.onClick();
  button(f.menu(), "Help and getting started").props.onClick();
  assert.deepEqual(f.editorActions, ["chart-settings"]);
  assert.equal(f.accountActions.at(-1), "welcome");
});

test("stale or blocked logo controls cannot change the active profile", () => {
  const f = fixture();
  trigger(f.menu()).props.onClick();
  const previous = f.menu();
  f.setAccountState({ owner: "another" });
  button(previous, "Chart settings").props.onClick();
  assert.deepEqual(f.editorActions, []);
  f.setAccountState({ importingBackup: true });
  assert.equal(trigger(f.menu()).props.disabled, true);
  assert.equal(dialog(f.menu()).props.hidden, true);
});

test("toolbar keeps the active-chart ticker search without a magnifier and routes the logo explicitly", () => {
  const f = fixture();
  const toolbar = f.toolbar();
  const logo = find(toolbar, (node) => node.type === f.TerminalBrandMenu);
  assert.equal(logo.props.account, f.account);
  assert.equal(logo.props.editor, f.controller);
  const ticker = find(toolbar, (node) => node.props.id === "symbol-button");
  assert.equal(ticker.props["aria-label"], "BTCUSDT · Find symbol");
  assert.equal(ticker.props.children.props.children, "BTCUSDT");
  ticker.props.onClick();
  assert.deepEqual(f.editorActions, ["instruments"]);
  assert.deepEqual(f.accountActions, []);
});

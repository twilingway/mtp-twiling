import assert from "node:assert/strict";
import test from "node:test";
import { find } from "./controller-preference-routing-fixture.mjs";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

function fixture({ mobile = false } = {}) {
  let requested = false;
  let focused = 0;
  let ref = 0;
  let effects = [];
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
    panel: { closeMobile: () => accountActions.push("chart") },
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
      useEffect: (effect) => effects.push(effect)
    },
    "react-dom": { createPortal: (node) => node },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("fragment") },
    "screens/terminal/context.js": {
      useTerminalState: (target, select) => select(target.getSnapshot()),
      useTerminal: (select = (state) => state) => ({
        controller,
        state: select({
          ...accountState,
          preferences: { ...accountState.preferences, symbol: "BTCUSDT", instrumentUid: "btc" },
          rows: [{ symbol: "BTCUSDT", uid: "btc", ticker: "BTCUSDT" }]
        })
      })
    },
    "screens/terminal/ChartEngineSelect.js": { ChartEngineSelect: noop },
    "screens/terminal/NativeChartTypeMenu.js": { NativeChartTypeMenu: noop },
    "screens/terminal/ChartLayoutPicker.js": { ChartLayoutPicker: noop },
    "screens/terminal/workspace-sync-controller.js": { publishWorkspaceTimeframe: noop },
    "screens/terminal/TerminalFullscreenControl.js": { TerminalFullscreenControl: noop },
    "screens/terminal/TerminalIndicatorControls.js": { TerminalIndicatorControls: noop },
    "screens/terminal/MobileChartTools.js": { MobileChartTools: noop },
    "screens/terminal/use-mobile-layout.js": { useMobileLayout: () => mobile },
    "screens/terminal/ClockZoneControl.js": { ClockZoneControl: noop },
    "screens/terminal/intervals/ChartRangeControl.js": { ChartRangeControl: noop },
    "screens/terminal/intervals/TimeframeMenu.js": { TimeframeMenu: noop }
  });
  load("i18n/preferences.js").setDisplayPreferences({ locale: "en" });
  const { TerminalBrandMenu } = load("screens/terminal/TerminalBrandMenu.js");
  const { Toolbar } = load("screens/terminal/Toolbar.js");
  return {
    TerminalBrandMenu,
    menu() {
      ref = 0;
      effects = [];
      return TerminalBrandMenu({ editor: controller, account, accountState });
    },
    listenOutside: () => effects.at(-1)(),
    setMobile: (next) => {
      mobile = next;
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

const trigger = (tree) => find(tree, (node) => node.props.id === "account-button");
const dialog = (tree) => find(tree, (node) => node.props.role === "dialog");
const button = (tree, name) =>
  find(
    tree,
    (node) =>
      node.type === "button" &&
      (node.props.children === name ||
        [node.props.children]
          .flat(Infinity)
          .some((child) => child === name || child?.props?.children === name))
  );

test("avatar opens the merged account menu, focuses back on Escape and scopes settings actions", () => {
  const f = fixture();
  assert.equal(trigger(f.menu()).props["aria-expanded"], false);
  trigger(f.menu()).props.onClick();
  const menu = f.menu();
  assert.equal(dialog(menu).props.hidden, false);
  assert.equal(dialog(menu).props.id, trigger(menu).props["aria-controls"]);
  assert.equal(find(menu, (node) => node.type === "h2").props.children, "МТП Twiling");
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

test("stale or blocked account controls cannot change the active profile", () => {
  const f = fixture();
  trigger(f.menu()).props.onClick();
  const previous = f.menu();
  f.setAccountState({ owner: "another" });
  button(previous, "Chart settings").props.onClick();
  assert.deepEqual(f.editorActions, []);
  f.setAccountState({ importingBackup: true });
  assert.equal(trigger(f.menu()).props.disabled, undefined);
  const blocked = f.menu();
  assert.equal(button(blocked, "Chart settings").props.disabled, true);
  button(blocked, "Account and sources").props.onClick();
  assert.deepEqual(f.accountActions, ["account"]);
});

test("toolbar keeps ticker search and installation inside the single account menu", () => {
  const f = fixture();
  const toolbar = f.toolbar();
  const logo = find(toolbar, (node) => node.type === f.TerminalBrandMenu);
  assert.equal(logo.props.account, f.account);
  assert.equal(logo.props.editor, f.controller);
  for (const open of [false, true]) {
    const content = logo.props.children(() => {}, open);
    assert.equal(
      find(content, (node) => node.props.id === "install-actions").props.id,
      "install-actions"
    );
  }
  assert.equal(
    find(toolbar, (node) => node.props.id === "engine"),
    null
  );
  assert.equal(
    find(toolbar, (node) => node.props.id === "account-button"),
    null
  );
  const ticker = find(toolbar, (node) => node.props.id === "symbol-button");
  assert.equal(ticker.props["aria-label"], "BTCUSDT · Find symbol");
  assert.equal(ticker.props.children.props.children, "BTCUSDT");
  ticker.props.onClick();
  assert.deepEqual(f.editorActions, ["instruments"]);
  assert.deepEqual(f.accountActions, []);
});

test("menu dismisses on outside pointer and keyboard focus leaving its dialog", () => {
  const previousNode = globalThis.Node;
  const previousDocument = globalThis.document;
  globalThis.Node = class {};
  const listeners = new Map();
  globalThis.document = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name)
  };
  try {
    const f = fixture();
    trigger(f.menu()).props.onClick();
    f.menu();
    const cleanup = f.listenOutside();
    listeners.get("pointerdown")({ target: new Node() });
    assert.equal(trigger(f.menu()).props["aria-expanded"], false);
    cleanup();
    assert.equal(listeners.size, 0);
    trigger(f.menu()).props.onClick();
    f.menu().props.onBlur({ relatedTarget: new Node(), currentTarget: { contains: () => false } });
    assert.equal(trigger(f.menu()).props["aria-expanded"], false);
  } finally {
    if (previousNode === undefined) delete globalThis.Node;
    else globalThis.Node = previousNode;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("mobile menu returns to the chart without changing saved panel preferences", () => {
  const f = fixture({ mobile: true });
  f.setAccountState({ mobilePanelOpen: true });
  trigger(f.menu()).props.onClick();
  button(f.menu(), "Return to chart").props.onClick();
  assert.deepEqual(f.accountActions, ["chart"]);
  assert.equal(trigger(f.menu()).props["aria-expanded"], false);
});

test("menu updates its navigation mode when the subscribed mobile layout changes", () => {
  const f = fixture();
  f.setAccountState({ mobilePanelOpen: true });
  trigger(f.menu()).props.onClick();
  const destination = (tree) =>
    find(tree, (node) => node.props.onAction && node.props.controller === f.account);
  assert.equal(destination(f.menu()).props.mobile, false);
  assert.equal(button(f.menu(), "Return to chart"), null);
  f.setMobile(true);
  assert.equal(destination(f.menu()).props.mobile, true);
  assert.ok(button(f.menu(), "Return to chart"));
  f.setMobile(false);
  assert.equal(destination(f.menu()).props.mobile, false);
  assert.equal(button(f.menu(), "Return to chart"), null);
});

test("Escape first closes an open timezone picker, then closes the avatar menu", () => {
  const states = [];
  let hook = 0,
    ref = 0,
    clockFocused = 0;
  const jsx = (type, props) => ({ type, props });
  const load = createSourceLoader({
    react: {
      useState: (initial) => {
        const index = hook++;
        if (!(index in states)) states[index] = initial;
        return [
          states[index],
          (next) => {
            states[index] = next;
          }
        ];
      },
      useRef: () => ({ current: ref++ === 1 ? { focus: () => clockFocused++ } : null }),
      useMemo: (calculate) => calculate(),
      useEffect() {},
      useId: () => "timezone"
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "screens/terminal/context.js": { useTerminal() {} }
  });
  const { TimeZonePicker } = load("screens/terminal/ClockZoneControl.js");
  const picker = () => {
    hook = ref = 0;
    return TimeZonePicker({ value: "Europe/Moscow", locale: "en", now: 0, onChange() {} });
  };
  const f = fixture();
  trigger(f.menu()).props.onClick();
  const escape = (tree) => {
    let stopped = false;
    const event = {
      key: "Escape",
      preventDefault() {},
      stopPropagation: () => {
        stopped = true;
      }
    };
    tree.props.onKeyDown(event);
    if (!stopped) f.menu().props.onKeyDown(event);
  };
  escape(picker());
  assert.equal(trigger(f.menu()).props["aria-expanded"], false);
  assert.equal(f.focusCount(), 1);
  assert.equal(clockFocused, 0);
  trigger(f.menu()).props.onClick();
  find(picker(), (node) => node.type === "button").props.onClick();
  escape(picker());
  assert.equal(trigger(f.menu()).props["aria-expanded"], true);
  assert.equal(clockFocused, 1);
  escape(picker());
  assert.equal(trigger(f.menu()).props["aria-expanded"], false);
  assert.equal(f.focusCount(), 2);
});

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) return node.map((child) => find(child, predicate)).find(Boolean) ?? null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}

function fixture() {
  const effects = [];
  const refs = [];
  const states = [];
  let hook = 0;
  let ref = 0;
  const focused = [];
  class Element {
    inert = false;
    isConnected = true;
    dataset = {};
    focus() {
      document.activeElement = this;
      focused.push(this);
    }
    querySelector() {
      return null;
    }
    querySelectorAll() {
      return [];
    }
    closest() {
      return this;
    }
    hasAttribute() {
      return false;
    }
  }
  const document = {
    body: { style: { overflow: "auto" }, children: [] },
    documentElement: { style: { overflow: "clip" } },
    activeElement: null
  };
  const overlay = new Element();
  const sheet = new Element();
  const app = new Element();
  const alreadyInert = new Element();
  alreadyInert.inert = true;
  document.body.children = [app, alreadyInert, overlay];
  const jsx = (type, props) => ({ type, props });
  const overrides = {
    react: {
      useLayoutEffect: (effect) => effects.push(effect),
      useRef: () => {
        const index = ref++;
        return refs[index] ?? (refs[index] = { current: index === 0 ? overlay : sheet });
      },
      useState: (initial) => {
        const index = hook++;
        if (!(index in states)) states[index] = initial;
        return [
          states[index],
          (next) => {
            states[index] = typeof next === "function" ? next(states[index]) : next;
          }
        ];
      }
    },
    "react-dom": { createPortal: (tree) => tree },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "i18n/messages.js": { t: (text) => text },
    "screens/terminal/DrawingToolIcon.js": { DrawingToolIcon: () => null },
    "screens/terminal/drawings/controls/ChevronIcon.js": { ChevronIcon: () => null }
  };
  const context = vm.createContext({ document, HTMLElement: Element });
  const cache = new Map();
  const root = new URL("../src/", import.meta.url);
  function load(relative) {
    if (overrides[relative]) return overrides[relative];
    if (cache.has(relative)) return cache.get(relative);
    const candidate = new URL(relative.replace(/\.js$/, ".ts"), root);
    const filename = existsSync(candidate) ? candidate : new URL(candidate.href + "x");
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS
      }
    }).outputText;
    const module = { exports: {} };
    new vm.Script(`(function(require,module,exports){${output}\n})`).runInContext(context)(
      (specifier) =>
        load(
          specifier.startsWith(".")
            ? path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier))
            : specifier
        ),
      module,
      module.exports
    );
    cache.set(relative, module.exports);
    return module.exports;
  }
  const { DrawingToolbarSplit, DrawingToolbarMenu } = load(
    "screens/terminal/DrawingToolbarMenu.js"
  );
  const { DrawingToolSheet } = load("screens/terminal/DrawingToolSheet.js");
  const { magnetMenuSections } = load("screens/terminal/drawing-toolbar-magnet-menu.js");
  const closes = [];
  const actions = [];
  const anchor = new Element();
  const props = {
    id: "drawing-toolbar-menu",
    title: "Tools",
    anchor,
    onClose: (restore) => closes.push(restore),
    sections: [
      {
        title: null,
        items: [
          {
            id: "selected",
            label: "Selected",
            checked: true,
            kind: "radio",
            icon: "trend",
            onFavorite: () => actions.push("favorite"),
            action: () => actions.push("selected")
          },
          {
            id: "disabled",
            label: "Unavailable",
            disabled: true,
            action: () => actions.push("disabled")
          },
          {
            id: "hold",
            label: "Values on hold",
            kind: "checkbox",
            checked: true,
            action: () => actions.push("hold")
          }
        ]
      }
    ]
  };
  return {
    DrawingToolbarSplit,
    DrawingToolbarMenu,
    DrawingToolSheet,
    magnetMenuSections,
    props,
    closes,
    actions,
    document,
    app,
    alreadyInert,
    overlay,
    sheet,
    anchor,
    focused,
    Element,
    render() {
      hook = 0;
      ref = 0;
      effects.length = 0;
      return DrawingToolSheet(props);
    },
    mount() {
      return effects.map((effect) => effect()).filter(Boolean);
    }
  };
}

const action = (tree, id) => find(tree, (node) => node.props?.["data-menu-item"] === id);
const event = (extra = {}) => ({ preventDefault() {}, stopPropagation() {}, ...extra });

test("mobile group icon opens its sheet with unavailable remembered tool; desktop keeps split behavior", () => {
  const f = fixture();
  let chosen = 0;
  const opened = [];
  const props = {
    id: "lines",
    toolId: "missing",
    label: "Lines: missing",
    menuLabel: "Lines",
    icon: "trend",
    active: false,
    disabled: true,
    expanded: true,
    onChoose: () => chosen++,
    onMenu: (anchor) => opened.push(anchor)
  };
  const mobile = f.DrawingToolbarSplit({ ...props, mobileMenu: true });
  const button = find(mobile, (node) => node.props?.className === "tool drawing-tool-main");
  assert.equal(button.props.disabled, false);
  assert.equal(button.props["aria-haspopup"], "dialog");
  assert.equal(button.props["aria-expanded"], true);
  assert.equal(
    find(mobile, (node) => node.props?.className === "drawing-tool-arrow"),
    null
  );
  button.props.onClick({ currentTarget: f.anchor });
  assert.equal(opened[0], f.anchor);
  assert.equal(chosen, 0);
  const desktop = f.DrawingToolbarSplit({ ...props, disabled: false });
  find(desktop, (node) => node.props?.className === "tool drawing-tool-main").props.onClick({});
  assert.equal(chosen, 1);
  assert.ok(find(desktop, (node) => node.props?.className === "drawing-tool-arrow"));
  assert.equal(f.DrawingToolbarMenu({ ...f.props, mobile: true }).type, f.DrawingToolSheet);
  assert.notEqual(f.DrawingToolbarMenu(f.props).type, f.DrawingToolSheet);
});

test("choosing selected tool closes; unavailable rows, favorites and hold-values setting retain their behavior", () => {
  const f = fixture();
  const tree = f.render();
  const dialog = find(tree, (node) => node.props?.role === "dialog");
  assert.equal(dialog.props["aria-modal"], "true");
  assert.equal(
    find(tree, (node) => node.props?.className === "drawing-menu-close"),
    null
  );
  action(tree, "disabled").props.onClick();
  assert.deepEqual(f.closes, []);
  assert.deepEqual(f.actions, []);
  find(tree, (node) => node.props?.["data-favorite"] !== undefined).props.onClick();
  action(tree, "hold").props.onClick();
  assert.deepEqual(f.actions, ["favorite", "hold"]);
  assert.deepEqual(f.closes, []);
  action(tree, "selected").props.onClick();
  assert.deepEqual(f.closes, [true]);
  assert.deepEqual(f.actions, ["favorite", "hold", "selected"]);
});

test("mobile magnet sheet keeps an explicit off action while desktop keeps its two strength choices", () => {
  const f = fixture();
  const chosen = [];
  let toggled = 0;
  const settings = { magnet: "off", snapIndicators: false };
  const mobile = f.magnetMenuSections(
    settings,
    true,
    (mode) => chosen.push(mode),
    () => toggled++
  );
  assert.deepEqual(
    Array.from(mobile[0].items, (item) => item.id),
    ["noMagnet", "weakMagnet", "strongMagnet"]
  );
  assert.equal(mobile[0].items[0].checked, true);
  for (const item of mobile[0].items) item.action();
  assert.deepEqual(chosen, ["off", "weak", "strong"]);
  assert.equal(mobile[1].items[0].disabled, true);
  const enabled = f.magnetMenuSections(
    { ...settings, magnet: "weak" },
    true,
    () => {},
    () => toggled++
  );
  assert.equal(enabled[1].items[0].disabled, false);
  enabled[1].items[0].action();
  assert.equal(toggled, 1);
  const desktop = f.magnetMenuSections(
    settings,
    false,
    () => {},
    () => {}
  );
  assert.deepEqual(
    Array.from(desktop[0].items, (item) => item.id),
    ["weakMagnet", "strongMagnet"]
  );
});

test("modal locks background, contains touch/click events, traps Tab, closes on Escape/outside and restores focus", () => {
  const f = fixture();
  const first = new f.Element();
  const last = new f.Element();
  f.sheet.querySelectorAll = () => [first, last];
  f.sheet.querySelector = () => first;
  const tree = f.render();
  const cleanups = f.mount();
  assert.equal(f.document.body.style.overflow, "hidden");
  assert.equal(f.document.documentElement.style.overflow, "hidden");
  assert.equal(f.app.inert, true);
  assert.equal(f.overlay.inert, false);
  assert.equal(f.focused.at(-1), first);
  f.document.activeElement = last;
  tree.props.onKeyDown(event({ key: "Tab" }));
  assert.equal(f.focused.at(-1), first);
  tree.props.onKeyDown(event({ key: "Tab", shiftKey: true }));
  assert.equal(f.focused.at(-1), last);
  let stopped = 0;
  for (const name of ["onPointerDown", "onPointerUp", "onTouchStart", "onTouchMove", "onTouchEnd"])
    tree.props[name](event({ stopPropagation: () => stopped++ }));
  assert.equal(stopped, 5);
  assert.deepEqual(f.closes, []);
  tree.props.onClick(event({ target: f.sheet, currentTarget: f.overlay }));
  assert.deepEqual(f.closes, []);
  tree.props.onClick(event({ target: f.overlay, currentTarget: f.overlay }));
  tree.props.onKeyDown(event({ key: "Escape" }));
  assert.deepEqual(f.closes, [true, true]);
  cleanups.forEach((cleanup) => cleanup());
  assert.equal(f.document.body.style.overflow, "auto");
  assert.equal(f.document.documentElement.style.overflow, "clip");
  assert.equal(f.app.inert, false);
  assert.equal(f.alreadyInert.inert, true);
  assert.equal(f.focused.at(-1), f.anchor);
});

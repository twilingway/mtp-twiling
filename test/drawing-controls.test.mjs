import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const nodeRequire = createRequire(import.meta.url);

// Run the real component handlers and effects with isolated hooks, without chart/storage access.
function fixture(initial = "solid", inDialog = true) {
  const slots = [],
    effects = [],
    listeners = new Map(),
    changes = [];
  const dialog = {},
    body = {},
    trigger = {
      closest: () => (inDialog ? dialog : null),
      focus: () => {
        focused = true;
      },
      getBoundingClientRect: () => ({ left: 980, top: 700, bottom: 732 })
    };
  const popup = { getBoundingClientRect: () => ({ width: 300, height: 120 }) };
  let cursor = 0,
    dirty = false,
    tree,
    focused = false;
  const eventTarget = {
    addEventListener: (type, listener, capture = false) => {
      const key = `${type}:${capture}`;
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(listener);
    },
    removeEventListener: (type, listener, capture = false) =>
      listeners.get(`${type}:${capture}`)?.delete(listener)
  };
  const hooks = {
    useId: () => "style-test",
    useRef: (value) => {
      const index = cursor++;
      return (slots[index] ??= { current: value });
    },
    useState: (initialValue) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initialValue;
      return [
        slots[index],
        (value) => {
          const next = typeof value === "function" ? value(slots[index]) : value;
          if (!Object.is(next, slots[index])) {
            slots[index] = next;
            dirty = true;
          }
        }
      ];
    },
    useLayoutEffect: (effect, deps) => {
      const index = cursor++;
      const previous = slots[index];
      if (previous && deps.every((dep, i) => Object.is(previous.deps[i], dep))) return;
      effects.push(() => {
        previous?.cleanup?.();
        slots[index] = { deps, cleanup: effect() };
      });
    }
  };
  const context = vm.createContext({
    document: { ...eventTarget, body },
    window: { ...eventTarget, innerWidth: 1024, innerHeight: 768 }
  });
  const modules = new Map();
  function load(relative) {
    let filename = path.resolve(sourceRoot, relative).replace(/\.js$/, ".ts");
    if (!existsSync(filename)) filename += "x";
    assert.ok(filename.startsWith(sourceRoot));
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${output}\n})`, { filename }).runInContext(
      context
    )(
      (specifier) => {
        if (specifier === "react") return hooks;
        if (specifier === "react-dom")
          return {
            createPortal: (children, target) => ({ type: "portal", props: { children, target } })
          };
        if (specifier.endsWith("i18n/messages.js")) return { t: (text) => text };
        return specifier.startsWith(".")
          ? load(path.relative(sourceRoot, path.resolve(path.dirname(filename), specifier)))
          : nodeRequire(specifier);
      },
      module,
      module.exports
    );
    return module.exports;
  }
  const { LineStylePicker } = load("screens/terminal/drawings/controls/LineStylePicker.tsx");
  let props = {
    value: initial,
    label: "Стиль линии",
    color: "#ff9800",
    opacity: 0.4,
    width: 3,
    onChange: (value) => changes.push(value)
  };
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap((item) => nodes(item));
    return [node, ...nodes(node.props?.children)];
  }
  const find = (predicate) => nodes(tree).find(predicate);
  function render() {
    for (let pass = 0; pass < 10; pass++) {
      cursor = 0;
      dirty = false;
      tree = LineStylePicker(props);
      for (const node of nodes(tree)) {
        if (node.props?.ref) node.props.ref.current = node.type === "button" ? trigger : popup;
      }
      effects.splice(0).forEach((effect) => effect());
      if (!dirty) return;
    }
    assert.fail("component did not settle");
  }
  render();
  const button = () => find((node) => node.props?.role === "combobox");
  const key = (key) => {
    const event = {
      key,
      prevented: false,
      stopped: false,
      preventDefault() {
        this.prevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
      stopImmediatePropagation() {
        this.stopped = true;
      }
    };
    for (const listener of listeners.get("keydown:true") ?? []) listener(event);
    if (!event.stopped) button().props.onKeyDown(event);
    render();
    return event;
  };
  return {
    load,
    nodes: () => nodes(tree),
    find,
    button,
    key,
    changes,
    dialog,
    body,
    listeners,
    focused: () => focused,
    click: () => {
      button().props.onClick();
      render();
    },
    act: (action) => {
      action();
      render();
    },
    update: (patch) => {
      props = { ...props, ...patch };
      render();
    }
  };
}

test("all line previews show actual dash patterns and the selected paint without mutating it", () => {
  const f = fixture();
  const { LineStylePreview } = f.load("screens/terminal/drawings/controls/LineStylePreview.tsx");
  const options = ["solid", "dashed", "dotted"].map((value) =>
    renderToStaticMarkup(
      createElement(LineStylePreview, {
        value,
        color: "#ff9800",
        opacity: 0.4,
        width: 3
      })
    )
  );
  assert.doesNotMatch(options[0], /stroke-dasharray/);
  assert.match(options[1], /stroke-dasharray="6 4"/);
  assert.match(options[2], /stroke-dasharray="2 3"/);
  for (const markup of options) {
    assert.match(markup, /stroke="#ff9800"/);
    assert.match(markup, /stroke-opacity="0.4"/);
    assert.match(markup, /stroke-width="3"/);
    assert.match(markup, /aria-hidden="true"/);
  }
});

test("keyboard explores options without committing; Enter commits the existing style value", () => {
  const f = fixture("dashed");
  assert.match(f.button().props["aria-label"], /Штриховой/);
  f.key("ArrowDown");
  assert.equal(f.button().props["aria-activedescendant"], "style-test-dashed");
  f.key("ArrowDown");
  assert.equal(f.button().props["aria-activedescendant"], "style-test-dotted");
  f.key("ArrowDown");
  assert.equal(f.button().props["aria-activedescendant"], "style-test-solid");
  f.key("ArrowUp");
  assert.deepEqual(f.changes, []);
  const commit = f.key("Enter");
  assert.ok(commit.prevented && commit.stopped);
  assert.deepEqual(f.changes, ["dotted"]);
  assert.equal(f.button().props["aria-expanded"], false);
  f.update({ value: "dotted" });
  assert.match(f.button().props["aria-label"], /Точечный/);
});

test("Home/End navigate; Escape consumes modal cancellation and Tab preserves ordinary focus movement", () => {
  const f = fixture();
  f.key("End");
  assert.equal(f.button().props["aria-activedescendant"], "style-test-dotted");
  const escape = f.key("Escape");
  assert.ok(escape.prevented && escape.stopped && f.focused());
  assert.equal(f.button().props["aria-expanded"], false);
  assert.deepEqual(f.changes, []);
  assert.equal(f.listeners.get("keydown:true").size, 0);
  f.key("Home");
  assert.equal(f.button().props["aria-activedescendant"], "style-test-solid");
  const tab = f.key("Tab");
  assert.equal(tab.prevented, false);
  assert.equal(tab.stopped, false);
  assert.equal(f.button().props["aria-expanded"], false);
  assert.deepEqual(f.changes, []);
});

test("popup belongs to native modal top layer and stays within viewport; standalone uses body", () => {
  for (const inDialog of [true, false]) {
    const f = fixture("solid", inDialog);
    f.click();
    const portal = f.find((node) => node.type === "portal");
    assert.equal(portal.props.target, inDialog ? f.dialog : f.body);
    const list = f.find((node) => node.props?.role === "listbox");
    assert.ok(list.props.style.left >= 8 && list.props.style.left + 300 <= 1016);
    assert.ok(list.props.style.top >= 8 && list.props.style.top + 120 <= 760);
    const options = f.nodes().filter((node) => node.props?.role === "option");
    assert.equal(options.length, 3);
    assert.deepEqual(
      options.map((option) => option.props["aria-selected"]),
      [true, false, false]
    );
  }
});

test("outside shield consumes chart gesture; clicking an option applies once and closes", () => {
  const f = fixture();
  f.click();
  let prevented = false,
    stopped = false;
  const shield = f.find((node) => node.props?.className === "drawing-line-picker-layer");
  shield.props.onPointerDown({
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {
      stopped = true;
    }
  });
  assert.ok(prevented && stopped);
  f.act(() =>
    shield.props.onClick({ target: shield, currentTarget: shield, stopPropagation() {} })
  );
  assert.equal(f.button().props["aria-expanded"], false);
  assert.deepEqual(f.changes, []);
  f.click();
  f.act(() => f.find((node) => node.props?.id === "style-test-dashed").props.onClick());
  assert.deepEqual(f.changes, ["dashed"]);
  assert.equal(f.button().props["aria-expanded"], false);
});

test("shared chevrons render as a symmetric 16px SVG without font glyphs", () => {
  const { ChevronIcon } = fixture().load("screens/terminal/drawings/controls/ChevronIcon.tsx");
  for (const direction of ["down", "right", "left"]) {
    const markup = renderToStaticMarkup(createElement(ChevronIcon, { direction }));
    assert.match(markup, /width="16" height="16"/);
    assert.match(markup, /stroke-width="1.5"/);
    assert.match(markup, /<path/);
    assert.doesNotMatch(markup, /[⌄▾›]/);
  }
});

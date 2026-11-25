import test from "node:test";
import assert from "node:assert/strict";
import * as jsx from "react/jsx-runtime";
import * as react from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceModules, row, header } from "./helpers/watchlist-sections.mjs";

const base = sourceModules(),
  model = base("model/watchlist-sections.js");
const rows = [row("SAME", "one"), row("SAME", "two"), row("THREE")],
  refs = model.watchlistReferences(rows);
const sections = { version: 1, entries: [refs[1], header("hidden"), refs[0], header("empty")] };
sections.entries[1].collapsed = true;
const state = {
  owner: "A",
  chartRevision: 0,
  rows,
  preferences: {
    symbol: "SAME",
    instrumentUid: "two",
    watchlistSections: sections
  },
  pricesDirection: new Map()
};
const controller = {
  sessionKey: () => null,
  getSnapshot: () => state,
  subscribe: () => () => {},
  setContext: () => {},
  notify: () => {}
};
function loader(hooks = react) {
  return sourceModules({
    react: hooks,
    "react/jsx-runtime": jsx,
    "react-dom": { createPortal: (value) => value },
    "screens/terminal/context.tsx": { useTerminal: () => ({ controller, state }) }
  });
}
function descendants(element) {
  if (!element || typeof element !== "object") return [];
  const children = element.props?.children;
  return [
    element,
    ...(Array.isArray(children) ? children.flat(Infinity) : [children]).flatMap(descendants)
  ];
}
const hooks = {
  ...react,
  useState: (value) => [value, () => {}],
  useRef: (value) => ({ current: value }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useCallback: (fn) => fn,
  memo: (fn) => fn
};

test("actual table markup separates section headers from quote rows, renders empty sections and hides collapsed members", () => {
  const { WatchlistSectionsTable } = loader()("screens/terminal/WatchlistSectionsTable.js");
  const html = renderToStaticMarkup(
    jsx.jsx(WatchlistSectionsTable, {
      query: "",
      sort: null,
      direction: -1,
      onSort: () => {},
      onManualOrder: () => {}
    })
  );
  assert.equal((html.match(/data-section-id=/g) ?? []).length, 2);
  assert.equal((html.match(/data-watchlist-index=/g) ?? []).length, 2);
  assert.match(html, /data-watchlist-index="1"/);
  assert.match(html, /data-watchlist-index="2"/);
  assert.doesNotMatch(html, /data-watchlist-index="0"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /data-section-id="section-empty"/);
  assert.match(html, /watchlist-section-handle/);
  assert.doesNotMatch(html, /data-symbol="section-/);
});

test("section header toggles, rename submit and keyboard move call only section actions", () => {
  const { WatchlistSectionHeader } = loader(hooks)("screens/terminal/WatchlistSectionHeader.js"),
    calls = [];
  const props = {
    section: header("one"),
    count: 3,
    disabled: false,
    dragClass: "",
    editing: false,
    onEdit: (value) => calls.push(["edit", value]),
    onToggle: () => calls.push("toggle"),
    onRename: (title) => calls.push(["rename", title]),
    onMove: (direction) => calls.push(["move", direction]),
    onContext: () => {},
    onDragStart: () => {},
    onDragOver: () => {},
    onDrop: () => {},
    onDragEnd: () => {}
  };
  const element = WatchlistSectionHeader(props),
    nodes = descendants(element);
  nodes.find((node) => node.props?.className === "watchlist-section-toggle").props.onClick();
  nodes.find((node) => node.props?.className === "watchlist-section-rename").props.onClick();
  const event = {
    key: "ArrowUp",
    altKey: true,
    preventDefault() {},
    target: null,
    currentTarget: null
  };
  element.props.onKeyDown(event);
  const form = descendants(WatchlistSectionHeader({ ...props, editing: true })).find(
    (node) => node.type === "form"
  );
  form.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(calls, [
    "toggle",
    ["edit", true],
    ["move", -1],
    ["rename", "one"],
    ["edit", false]
  ]);
});

test("row keyboard move does not select/delete/flag; ordinary Enter still selects exact UID", () => {
  const { QuoteRow } = loader(hooks)("screens/terminal/WatchlistQuoteRow.js"),
    calls = [];
  const element = QuoteRow({
    row: rows[1],
    selected: true,
    direction: "",
    position: { index: 1, uid: "two", symbol: "SAME" },
    dragClass: "",
    onSelect: (...args) => calls.push(["select", ...args]),
    onRemove: () => calls.push("remove"),
    onContext: () => {},
    onFlag: () => {},
    onStep: (direction) => calls.push(["step", direction]),
    onDragStart: () => {},
    onDragOver: () => {},
    onDrop: () => {},
    onDragEnd: () => {}
  });
  let prevented = 0,
    stopped = 0;
  element.props.onKeyDown({
    key: "ArrowDown",
    altKey: true,
    preventDefault() {
      prevented++;
    },
    stopPropagation() {
      stopped++;
    }
  });
  assert.deepEqual(calls, [["step", 1]]);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  element.props.onKeyDown({ key: "Enter", preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(calls[1], ["select", "SAME", "two"]);
});

test("row context menu exposes real add/move and mobile section destination actions", () => {
  const previousWindow = globalThis.window;
  globalThis.window = { innerWidth: 390, innerHeight: 844 };
  try {
    const { WatchlistMenu } = loader(hooks)("screens/terminal/WatchlistMenu.js"),
      calls = [];
    const element = WatchlistMenu({
      row: rows[1],
      x: 10,
      y: 10,
      sections: [header("one")],
      canUp: true,
      canDown: true,
      onClose: () => calls.push("close"),
      onAddSection: () => calls.push("add"),
      onStep: (value) => calls.push(["step", value]),
      onAssign: (value) => calls.push(["assign", value])
    });
    const nodes = descendants(element),
      menuButtons = nodes.filter(
        (node) => node.type === "button" && node.props.role === "menuitem"
      );
    menuButtons[0].props.onClick();
    menuButtons[1].props.onClick();
    const select = nodes.find((node) => node.type === "select");
    select.props.onChange({ target: { value: "section-one" } });
    select.props.onChange({ target: { value: "top" } });
    assert.deepEqual(calls, [
      "close",
      "add",
      "close",
      ["step", -1],
      "close",
      ["assign", "section-one"],
      "close",
      ["assign", null]
    ]);
    assert.ok(nodes.some((node) => node.type === "option" && node.props.value === "top"));
    assert.ok(nodes.some((node) => node.type === "option" && node.props.value === "section-one"));
  } finally {
    globalThis.window = previousWindow;
  }
});

test("Russian and English section labels cover working actions", () => {
  const { sectionText } = base("i18n/messages-watchlist-sections.js");
  for (const key of [
    "add",
    "rename",
    "delete",
    "collapse",
    "expand",
    "up",
    "down",
    "move",
    "top",
    "save",
    "cancel"
  ])
    assert.notEqual(sectionText(key, "ru"), sectionText(key, "en"));
});

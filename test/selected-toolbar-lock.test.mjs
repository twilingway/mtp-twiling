import assert from "node:assert/strict";
import test from "node:test";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

function find(node, predicate) {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) return node.map((child) => find(child, predicate)).find(Boolean);
  return predicate(node) ? node : find(node.props?.children, predicate);
}

function fixture() {
  let state;
  const writes = [];
  const jsx = (type, props) => ({ type, props });
  const controller = {
    getSnapshot: () => state,
    notify: (error) => assert.fail(error),
    setChartSettings: async (patch) => {
      state = {
        ...state,
        preferences: {
          ...state.preferences,
          chartSettings: { ...state.preferences.chartSettings, ...patch }
        }
      };
    },
    editing: {
      cancelGesture() {},
      change: async (patch) => {
        writes.push(patch);
        state = { ...state, ...patch };
      }
    },
    updateDrawing: (drawing) =>
      controller.editing.change({
        drawings: state.drawings.map((item) => (item.id === drawing.id ? drawing : item))
      }),
    saveImage: (image) =>
      controller.editing.change({
        images: state.images.map((item) => (item.id === image.id ? image : item))
      })
  };
  const load = sourceModules({
    react: {
      useState: (initial) => [initial, () => {}],
      useRef: () => ({ current: null }),
      useEffect() {},
      useLayoutEffect() {}
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-dom": { createPortal: (tree) => tree },
    "screens/terminal/TechnicalIndicatorPanels.tsx": { TechnicalObjectTree() {} },
    "screens/terminal/context.tsx": {
      useTerminal: (selector) => ({
        controller,
        state: selector ? selector(state) : state
      })
    }
  });
  state = {
    owner: "alice",
    selectedObject: "drawing",
    objectPanel: true,
    rows: [],
    preferences: load("screens/terminal/controller-bridge.js").defaultPreferences(),
    drawings: [{ id: "drawing", name: "segment", lock: false, points: [] }],
    images: [{ id: "image", name: "Image", lock: false, blob: new Blob() }]
  };
  const { TerminalDrawingTools } = load("screens/terminal/controller-drawing-tools.js");
  controller.tools = new TerminalDrawingTools(controller);
  const { ObjectTree } = load("screens/terminal/drawings/ObjectTree.js");
  const lockUi = load("screens/terminal/drawing-toolbar-lock.js");
  const { selectDrawingToolbarState } = load("screens/terminal/terminal-state-selection.js");
  const lockStatus = () => lockUi.selectedToolbarLock(selectDrawingToolbarState(state));
  const { DrawingToolbarSplit } = load("screens/terminal/DrawingToolbarMenu.js");
  const treeButton = (kind) =>
    find(
      find(
        ObjectTree(),
        (node) => node.props?.[kind === "drawing" ? "data-object" : "data-image"] === kind
      ),
      (node) => node.props?.["data-object-action"] === "lock"
    );
  const props = (mobile = false, onMenu = () => {}) =>
    lockUi.DrawingToolbarLock({
      status: lockStatus(),
      mobile,
      expanded: false,
      onChoose: () => lockUi.toggleToolbarLock(controller),
      onMenu
    }).props;
  return {
    controller,
    writes,
    load,
    treeButton,
    props,
    lockUi,
    lockStatus,
    DrawingToolbarSplit,
    state: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    }
  };
}

test("object tree and left lock share individual drawing/image flags in both directions", async () => {
  for (const kind of ["drawing", "image"]) {
    const f = fixture();
    f.update({ selectedObject: kind });
    const originalSettings = f.state().preferences.chartSettings;
    f.treeButton(kind).props.onClick();
    assert.equal(f.props().active, true);
    assert.equal(f.props().icon, "lock");
    assert.equal(f.props().label, "Разблокировать объект");
    await f.props().onChoose();
    assert.equal(f.treeButton(kind).props["aria-pressed"], false);
    assert.equal(f.props().active, false);
    assert.equal(f.props().icon, "unlock");
    await f.props().onChoose();
    assert.equal(f.treeButton(kind).props["aria-pressed"], true);
    assert.equal(f.state().preferences.chartSettings, originalSettings);
    const untouched = kind === "drawing" ? f.state().images[0] : f.state().drawings[0];
    assert.equal(untouched.lock, false);
  }
});

test("deselect or change of selection/scope cancels stale individual commands", async () => {
  for (const patch of [
    { selectedObject: null },
    { selectedObject: "image" },
    { owner: "bob" },
    { preferences: { symbol: "DIFFERENT", chartSettings: {} } }
  ]) {
    const f = fixture();
    const pending = f.props().onChoose();
    f.update(patch);
    await pending;
    assert.equal(f.writes.length, 0);
  }
  const f = fixture();
  await f.props().onChoose();
  const staleButton = f.props();
  f.update({ selectedObject: null });
  assert.equal(f.props().active, false);
  assert.equal(f.props().disabled, true);
  assert.equal(f.props().label, "Выберите объект для блокировки");
  await staleButton.onChoose();
  assert.equal(f.state().drawings[0].lock, true);
  assert.equal(f.writes.length, 1);
});

test("explicit global unlock preserves individual flags and indicator locks with or without selection", async () => {
  for (const selectedObject of ["drawing", null]) {
    const f = fixture();
    f.state().drawings[0].lock = true;
    f.update({
      selectedObject,
      preferences: {
        ...f.state().preferences,
        chartSettings: { drawingTools: { drawingsLocked: true, indicatorsLocked: true } }
      }
    });
    assert.equal(f.props().active, true);
    assert.equal(f.props().disabled, false);
    assert.equal(f.props().label, "Разблокировать объекты рисования");
    await f.props().onChoose();
    assert.equal(f.writes.length, 0);
    assert.equal(f.state().preferences.chartSettings.drawingTools.drawingsLocked, false);
    assert.equal(f.state().preferences.chartSettings.drawingTools.indicatorsLocked, true);
    assert.equal(f.state().drawings[0].lock, true);
    assert.equal(
      f.props().label,
      selectedObject ? "Разблокировать объект" : "Выберите объект для блокировки"
    );
    assert.equal(f.props().disabled, selectedObject === null);
  }
});

test("mobile lock always opens global menu; selected action alone can be unavailable", () => {
  for (const global of [false, true]) {
    const f = fixture();
    f.update({
      selectedObject: global ? "drawing" : null,
      preferences: {
        ...f.state().preferences,
        chartSettings: { drawingTools: { drawingsLocked: global } }
      }
    });
    let opened = 0;
    const split = f.DrawingToolbarSplit(f.props(true, () => opened++));
    const main = find(split, (node) => node.props?.className === "tool drawing-tool-main");
    assert.equal(main.props.disabled, false);
    main.props.onClick({ currentTarget: {} });
    assert.equal(opened, 1);
    assert.equal(f.writes.length, 0);
    const globals = [{ id: "lock-all", label: "Разблокировать всё", checked: true }];
    const sections = f.lockUi.toolbarLockSections(f.lockStatus(), globals, () => {});
    assert.equal(sections[0].items[0].disabled, !global);
    assert.equal(sections[1].items, globals);
    assert.equal(sections[1].items[0].checked, true);
    const desktop = f.DrawingToolbarSplit(f.props());
    assert.equal(
      find(desktop, (node) => node.props?.className === "tool drawing-tool-main").props.disabled,
      !global
    );
    assert.ok(find(desktop, (node) => node.props?.className === "drawing-tool-arrow"));
  }
});

test("lock menu unpins the selected tree object and keeps global locking separate", async () => {
  for (const kind of ["drawing", "image"]) {
    const f = fixture();
    f.update({ selectedObject: kind });
    f.treeButton(kind).props.onClick();
    const globals = [{ id: "lock-drawings", label: "Закрепить объекты рисования", checked: false }];
    const sections = () =>
      f.lockUi.toolbarLockSections(f.lockStatus(), globals, () =>
        f.lockUi.toggleToolbarLock(f.controller)
      );
    const selected = sections()[0];
    assert.equal(selected.title, "Выделенный объект");
    assert.equal(selected.items[0].label, "Разблокировать объект");
    assert.equal(selected.items[0].checked, true);
    assert.equal(selected.items[0].disabled, false);
    assert.equal(sections()[1].items, globals);
    await selected.items[0].action();
    assert.equal(f.treeButton(kind).props["aria-pressed"], false);
    assert.equal(sections()[0].items[0].label, "Заблокировать объект");
    assert.equal(sections()[0].items[0].checked, false);
    assert.equal(globals[0].checked, false);
    f.update({ selectedObject: null });
    assert.equal(sections()[0].items[0].disabled, true);
    assert.equal(sections()[0].items[0].checked, false);
  }
});

test("selected drawing exposes visible unlock text and a checked global action", async () => {
  const f = fixture();
  const { SelectedDrawingLock } = f.load("screens/terminal/SelectedDrawingLock.js");
  f.update({
    preferences: {
      ...f.state().preferences,
      chartSettings: { drawingTools: { drawingsLocked: true, indicatorsLocked: true } }
    }
  });
  const button = SelectedDrawingLock();
  assert.equal(button.props.disabled, false);
  assert.equal(button.props["aria-pressed"], true);
  assert.equal(
    find(button, (node) => node.type === "span").props.children,
    "Разблокировать объекты рисования"
  );
  assert.ok(find(button, (node) => node.props?.name === "check"));
  button.props.onClick();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.state().preferences.chartSettings.drawingTools.drawingsLocked, false);
  assert.equal(f.state().preferences.chartSettings.drawingTools.indicatorsLocked, true);
  assert.equal(f.state().drawings[0].lock, false);
  const unlocked = SelectedDrawingLock();
  assert.equal(
    find(unlocked, (node) => node.type === "span").props.children,
    "Заблокировать объект"
  );
  assert.equal(unlocked.props["aria-pressed"], false);
});

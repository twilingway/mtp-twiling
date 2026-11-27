import assert from "node:assert/strict";
import test from "node:test";
import * as jsx from "react/jsx-runtime";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

// Runs the actual component handlers and effect cleanup against element refs. The
// integration browser smoke covers native pointer capture and rendered geometry.
function fixture(t, initial = {}) {
  const originals = ["window", "getComputedStyle"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key)
  ]);
  const log = [],
    writes = [],
    storage = new Map(),
    hooks = [];
  let cursor = 0,
    pending = [],
    props = { count: 6, owner: "owner-one", ...initial };
  let handles = [],
    renders = 0;
  const listeners = new Set();
  const media = {
    matches: false,
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener)
  };
  const style = (label) => {
    const values = new Map();
    return {
      setProperty(key, value) {
        log.push(["write", label, key, value]);
        values.set(key, value);
      },
      removeProperty(key) {
        log.push(["remove", label, key]);
        values.delete(key);
      },
      getPropertyValue: (key) => values.get(key) ?? "",
      set translate(value) {
        this.setProperty("translate", value);
      },
      get translate() {
        return values.get("translate") ?? "";
      }
    };
  };
  const grid = { style: style("grid") };
  const layer = { parentElement: grid, children: [] };
  globalThis.window = { matchMedia: () => media };
  globalThis.getComputedStyle = (node) => {
    assert.equal(node, grid);
    log.push(["read", "grid"]);
    const definition = props.definition ?? model.defaultChartLayout(props.count);
    const columns = media.matches ? [1200] : Array(definition.columns).fill(100);
    const rows = Array(media.matches ? props.count : definition.rows).fill(400);
    const resolve = (key, defaults) => {
      const saved = grid.style.getPropertyValue(key);
      if (!saved) return defaults.map((value) => `${value}px`).join(" ");
      return saved.replaceAll(/minmax\(0, ([\d.e+-]+)fr\)/g, "$1px");
    };
    return {
      gridTemplateColumns: resolve("--chart-grid-columns", columns),
      gridTemplateRows: resolve(
        media.matches ? "--chart-grid-stacked-rows" : "--chart-grid-rows",
        rows
      )
    };
  };
  const changed = (old, next) => !old || next.some((value, index) => value !== old[index]);
  const react = {
    useRef(value) {
      const index = cursor++;
      return (hooks[index] ??= { current: value });
    },
    useMemo(make, deps) {
      const index = cursor++;
      if (changed(hooks[index]?.deps, deps)) hooks[index] = { deps, value: make() };
      return hooks[index].value;
    },
    useLayoutEffect(make, deps) {
      const index = cursor++;
      if (changed(hooks[index]?.deps, deps))
        pending.push(() => {
          hooks[index]?.cleanup?.();
          hooks[index] = { deps, cleanup: make() };
        });
    },
    useSyncExternalStore(subscribe, snapshot) {
      const index = cursor++;
      hooks[index] ??= { cleanup: subscribe(() => render()) };
      return snapshot();
    }
  };
  const load = createSourceLoader({
    react,
    "react/jsx-runtime": jsx,
    "i18n/messages.js": { t: (value) => value },
    "services/workspace-identity-local.js": {
      readWorkspaceLocal: (key) => storage.get(key) ?? null,
      writeWorkspaceLocal(key, value) {
        storage.set(key, value);
        writes.push([key, JSON.parse(value)]);
      }
    }
  });
  const model = load("model/chart-workspace-layout.js");
  const { WorkspaceGridDividers } = load("screens/terminal/WorkspaceGridDividers.js");
  function render(next = props) {
    props = next;
    cursor = 0;
    pending = [];
    renders++;
    const element = WorkspaceGridDividers(props);
    const previous = new Map(handles.map((node) => [node.key, node]));
    handles = element.props.children.map((child) => {
      const node = previous.get(child.key) ?? {
        key: child.key,
        style: style(child.key),
        dataset: {},
        attributes: new Map(),
        capture: null,
        setAttribute(key, value) {
          this.attributes.set(key, value);
        },
        getAttribute(key) {
          return this.attributes.get(key) ?? null;
        },
        focus() {
          log.push(["focus", this.key]);
        },
        setPointerCapture(id) {
          this.capture = id;
          log.push(["capture", this.key]);
        },
        hasPointerCapture(id) {
          return this.capture === id;
        },
        releasePointerCapture(id) {
          this.capture = null;
          // Exercise release reentrancy: the ref must already have been cleared.
          dispatch(this, "onLostPointerCapture", { pointerId: id });
        },
        getClientRects() {
          assert.fail("divider dragging must not read client rects");
        }
      };
      node.props = child.props;
      Object.assign(node.style, child.props.style);
      return node;
    });
    layer.children = handles;
    element.props.ref.current = layer;
    pending.forEach((effect) => effect());
  }
  function dispatch(node, name, fields = {}) {
    const event = {
      type:
        {
          onPointerUp: "pointerup",
          onPointerCancel: "pointercancel",
          onLostPointerCapture: "lostpointercapture"
        }[name] ?? name,
      button: 0,
      pointerId: 7,
      clientX: 400,
      clientY: 400,
      currentTarget: node,
      preventDefault() {},
      ...fields
    };
    node.props[name](event);
  }
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    hooks.forEach((hook) => hook?.cleanup?.());
  };
  render();
  t.after(() => {
    unmount();
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    }
  });
  log.length = 0;
  return {
    log,
    writes,
    storage,
    grid,
    render,
    dispatch,
    unmount,
    model,
    handles: () => handles,
    renders: () => renders,
    props: () => props,
    breakpoint(narrow) {
      media.matches = narrow;
      [...listeners].forEach((listener) => listener());
    },
    gridWrites: () => log.filter(([action, label]) => action === "write" && label === "grid"),
    reads: () => log.filter(([action]) => action === "read").length
  };
}

test("moves only the captured divider preview, then commits pointerup's final coordinate once", (t) => {
  const f = fixture(t),
    handle = f.handles()[0];
  const originalPlacement = [handle.style.gridColumn, handle.style.gridRow];
  f.dispatch(handle, "onPointerDown");
  assert.equal(f.log[0][0], "read", "measure before focus/capture/writes");
  for (const clientX of [420, 480, 520]) f.dispatch(handle, "onPointerMove", { clientX });
  assert.equal(handle.style.translate, "120px 0");
  assert.equal(handle.dataset.resizing, "true");
  assert.equal(handle.capture, 7);
  assert.deepEqual([handle.style.gridColumn, handle.style.gridRow], originalPlacement);
  assert.equal(handle.getAttribute("aria-valuenow"), "43");
  assert.deepEqual(f.gridWrites(), []);
  assert.deepEqual(f.writes, []);
  assert.equal(f.reads(), 1);
  assert.equal(f.renders(), 1);
  f.dispatch(handle, "onKeyDown", { key: "ArrowRight" });
  assert.deepEqual(f.gridWrites(), [], "keyboard cannot change geometry during capture");
  f.dispatch(handle, "onPointerUp", { clientX: 550 });
  assert.equal(f.gridWrites().length, 1);
  assert.equal(f.writes.length, 1);
  assert.equal(handle.capture, null);
  assert.equal(handle.dataset.resizing, undefined);
  assert.equal(handle.style.translate, "");
  assert.equal(handle.getAttribute("aria-valuenow"), "46");
  const sizes = f.writes[0][1].column;
  assert.deepEqual(sizes.slice(0, 4), Array(4).fill(137.5));
  assert.deepEqual(sizes.slice(4, 8), Array(4).fill(62.5));
  assert.deepEqual(sizes.slice(8), Array(4).fill(100));
  f.dispatch(handle, "onPointerUp", { clientX: 600 });
  assert.equal(f.gridWrites().length, 1);
  assert.equal(f.writes.length, 1);
});

for (const termination of ["onPointerCancel", "onLostPointerCapture"]) {
  test(`${termination} commits the last clamped preview once and ignores cancellation coordinates`, (t) => {
    const f = fixture(t),
      handle = f.handles()[0];
    f.dispatch(handle, "onPointerDown");
    f.dispatch(handle, "onPointerMove", { clientX: 50_000 });
    assert.equal(handle.style.translate, "272px 0");
    assert.equal(handle.getAttribute("aria-valuenow"), handle.getAttribute("aria-valuemax"));
    f.dispatch(handle, termination, { clientX: -50_000 });
    assert.equal(f.gridWrites().length, 1);
    assert.equal(f.writes.length, 1);
    for (const size of f.writes[0][1].column.slice(4, 8)) assert.ok(Math.abs(size - 32) < 1e-9);
    f.dispatch(handle, "onLostPointerCapture");
    assert.equal(f.writes.length, 1);
    assert.equal(handle.style.translate, "");
  });
}

test("no movement or return to the starting position causes no commit or storage write", (t) => {
  const f = fixture(t),
    handle = f.handles()[0];
  for (const moved of [false, true]) {
    f.dispatch(handle, "onPointerDown");
    if (moved) f.dispatch(handle, "onPointerMove", { clientX: 500 });
    f.dispatch(handle, "onPointerUp");
    assert.equal(handle.style.translate, "");
    assert.equal(handle.getAttribute("aria-valuenow"), "33");
  }
  assert.deepEqual(f.gridWrites(), []);
  assert.deepEqual(f.writes, []);
});

test("keyboard remains immediate, honors shift and clamps at Home/End", (t) => {
  const f = fixture(t),
    handle = f.handles()[0];
  for (const [key, shiftKey, expected] of [
    ["ArrowRight", false, 103],
    ["ArrowLeft", true, 95],
    ["Home", false, 32],
    ["End", false, 168]
  ]) {
    f.dispatch(handle, "onKeyDown", { key, shiftKey });
    assert.ok(Math.abs(f.writes.at(-1)[1].column[0] - expected) < 1e-9);
    assert.equal(f.gridWrites().length, f.writes.length);
  }
  assert.equal(f.writes.length, 4);
});

for (const change of ["owner", "definition", "breakpoint", "unmount"]) {
  test(`${change} clears capture and saves pending tracks only under the original scope`, (t) => {
    const f = fixture(t),
      handle = f.handles()[0];
    f.dispatch(handle, "onPointerDown");
    f.dispatch(handle, "onPointerMove", { clientX: 520 });
    if (change === "owner") f.render({ ...f.props(), owner: "owner-two" });
    if (change === "definition")
      f.render({ ...f.props(), definition: f.model.chartLayout("6-wide") });
    if (change === "breakpoint") f.breakpoint(true);
    if (change === "unmount") f.unmount();
    assert.equal(handle.style.translate, "");
    assert.equal(handle.capture, null);
    assert.equal(handle.dataset.resizing, undefined);
    assert.deepEqual(f.gridWrites(), [], "never apply old pending geometry into a new scope");
    assert.equal(f.writes.length, 1);
    assert.match(f.writes[0][0], /\["owner-one","6-balanced","desktop"\]/);
    assert.deepEqual(f.writes[0][1].column.slice(0, 4), Array(4).fill(130));
    f.dispatch(handle, "onPointerMove", { clientX: 700 });
    f.dispatch(handle, "onPointerUp", { clientX: 700 });
    assert.equal(f.writes.length, 1, "late events do not revive stale drags");
    if (change === "owner") {
      f.render({ ...f.props(), owner: "owner-one" });
      assert.equal(
        f.gridWrites().length,
        1,
        "the original owner can restore its own pending sizes"
      );
    }
  });
}

test("stacked mobile rows preview vertically and keep pixel sizing and the 240px pane minimum", (t) => {
  const f = fixture(t, { count: 3 });
  f.breakpoint(true);
  f.log.length = 0;
  const handle = f.handles()[0];
  f.dispatch(handle, "onPointerDown");
  f.dispatch(handle, "onPointerMove", { clientY: -5000 });
  assert.equal(handle.style.translate, "0 -160px");
  assert.equal(handle.getAttribute("aria-valuenow"), handle.getAttribute("aria-valuemin"));
  assert.deepEqual(f.gridWrites(), []);
  f.dispatch(handle, "onPointerUp", { clientY: -5000 });
  assert.deepEqual(f.writes[0][1].row, [240, 560, 400]);
  assert.equal(f.grid.style.getPropertyValue("--chart-grid-stacked-rows"), "240px 560px 400px");
});

test("pointer ids, buttons, invalid geometry and absent owners retain their scope rules", (t) => {
  const f = fixture(t, { owner: undefined }),
    handle = f.handles()[0];
  f.dispatch(handle, "onPointerDown", { button: 2 });
  assert.equal(handle.capture, null);
  f.dispatch(handle, "onPointerDown");
  f.dispatch(handle, "onPointerMove", { pointerId: 8, clientX: 700 });
  f.dispatch(handle, "onPointerUp", { pointerId: 8, clientX: 700 });
  assert.deepEqual(f.gridWrites(), []);
  f.dispatch(handle, "onPointerMove", { clientX: 520 });
  f.dispatch(handle, "onPointerUp", { clientX: 520 });
  assert.equal(f.gridWrites().length, 1);
  assert.deepEqual(f.writes, [], "anonymous layouts stay in memory");
  globalThis.getComputedStyle = () => ({ gridTemplateColumns: "none", gridTemplateRows: "none" });
  f.dispatch(handle, "onPointerDown");
  assert.equal(handle.capture, null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const load = createSourceLoader({
  "screens/terminal/controller-camera-sync.js": {
    cameraCurrent: (controller, chart) => controller.chart === chart && !chart?.retired,
    userCameraAction: (controller, chart, action) => {
      assert.equal(chart, controller.chart);
      chart.actions.push("begin");
      action();
      chart.actions.push("end");
    }
  }
});
const { bindChartRangeZoom, chartRangeZoomSession } = load(
  "screens/terminal/chart-range-zoom-input.js"
);
const { chartMeasurement } = load("screens/terminal/chart-measurement-session.js");

function setup() {
  class Element extends EventTarget {
    constructor(control = false) {
      super();
      this.control = control;
    }
    closest() {
      return this.control ? this : null;
    }
  }
  const view = Object.assign(new EventTarget(), { Element });
  const document = Object.assign(new EventTarget(), {
    defaultView: view,
    visibilityState: "visible",
    querySelector: () => null
  });
  const plot = new Element();
  const control = new Element(true);
  const other = new Element();
  const captures = new Set();
  const host = Object.assign(new Element(), {
    ownerDocument: document,
    contains: (target) => target === plot || target === control,
    getBoundingClientRect: () => ({ left: 50, top: 40 }),
    hasPointerCapture: (id) => captures.has(id),
    setPointerCapture: (id) => captures.add(id),
    releasePointerCapture: (id) => captures.delete(id)
  });
  const state = { chartRevision: 3, candles: [{}] };
  const actions = [];
  const callListeners = [];
  const chart = {
    actions,
    plotSize: () => ({ width: 220, height: 110 }),
    pixelToPoint: (x, y) => ({ timestamp: 1_000 + x * 60, value: 500 - y }),
    zoomToSelection: (...points) => actions.push(points)
  };
  const controller = {
    chart,
    getSnapshot: () => state,
    subscribe(listener) {
      callListeners.push(listener);
      return () => callListeners.splice(callListeners.indexOf(listener), 1);
    }
  };
  const previews = [];
  const session = chartRangeZoomSession(controller);
  const pointer = (type, x = 0, y = 0, props = {}) => {
    const event = new Event(type, { cancelable: true });
    const { target = plot, ...rest } = props;
    Object.defineProperty(event, "target", { value: target });
    Object.assign(event, {
      button: 0,
      pointerId: 1,
      isPrimary: true,
      clientX: x + 50,
      clientY: y + 40,
      ...rest
    });
    view.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const bind = () => {
    session.set(true);
    return bindChartRangeZoom(host, controller, (rectangle) => previews.push(rectangle));
  };
  const touchStart = (target = plot, count = 1) => {
    const event = new Event("touchstart", { cancelable: true });
    Object.assign(event, {
      changedTouches: [{ target, clientX: 75, clientY: 65 }],
      touches: Array.from({ length: count })
    });
    view.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return {
    pointer,
    touchStart,
    bind,
    session,
    chart,
    controller,
    actions,
    previews,
    state,
    callListeners,
    captures,
    control,
    other
  };
}

test("drag clamps to the active plot and applies one user camera action", () => {
  const { bind, pointer, actions, previews, captures, session, other } = setup();
  const unbind = bind();
  assert.equal(pointer("pointerdown", 190, 92), true);
  assert.equal(captures.has(1), true);
  assert.equal(pointer("pointermove", -20, -10, { target: other }), true);
  assert.deepEqual(previews.at(-1), { left: 0, top: 0, width: 190, height: 92 });
  assert.equal(pointer("pointerup", -20, -10, { target: other }), true);
  assert.deepEqual(actions, [
    "begin",
    [
      { timestamp: 1000, value: 500 },
      { timestamp: 12400, value: 408 }
    ],
    "end"
  ]);
  assert.equal(previews.at(-1), null);
  assert.equal(captures.size, 0);
  assert.equal(session.isArmed(), false);
  assert.equal(pointer("pointerdown", 190, 92), false);
  unbind();
});

test("the axes, control targets, right click and other panes keep their native events", () => {
  const { bind, pointer, actions, captures, session, control, other } = setup();
  const unbind = bind();
  for (const [x, y, props] of [
    [20, 30, { button: 2 }],
    [20, 30, { target: control }],
    [20, 30, { target: other }],
    [220, 45, {}],
    [12, 110, {}]
  ])
    assert.equal(pointer("pointerdown", x, y, props), false);
  assert.equal(captures.size, 0);
  assert.deepEqual(actions, []);
  assert.equal(session.isArmed(), true);
  unbind();
});

test("a thin selection clears the preview and keeps the tool armed", () => {
  const { bind, pointer, actions, session } = setup();
  const unbind = bind();
  pointer("pointerdown", 10, 20);
  pointer("pointerup", 17, 85);
  assert.deepEqual(actions, []);
  assert.equal(session.isArmed(), true);
  pointer("pointerdown", 10, 20);
  pointer("pointerup", 18, 28);
  assert.equal(actions.length, 3);
  assert.equal(session.isArmed(), false);
  unbind();
});

test("touch start is blocked only in the selected chart plot, and a second touch cancels", () => {
  const { bind, pointer, touchStart, actions, session, control, other } = setup();
  const unbind = bind();
  assert.equal(touchStart(control), false);
  assert.equal(touchStart(other), false);
  assert.equal(pointer("pointerdown", 25, 25, { pointerType: "touch" }), true);
  assert.equal(touchStart(), true);
  assert.equal(touchStart(undefined, 2), true);
  assert.equal(session.isArmed(), false);
  assert.deepEqual(actions, []);
  unbind();
});

test("Escape, a second pointer, cancellation and source replacement release the gesture", () => {
  for (const cancel of [
    ({ pointer }) => pointer("keydown", 0, 0, { key: "Escape" }),
    ({ pointer, other }) =>
      assert.equal(
        pointer("pointerdown", 75, 70, { isPrimary: false, pointerId: 2, target: other }),
        false
      ),
    ({ pointer }) => pointer("pointercancel"),
    ({ state, callListeners }) => {
      state.chartRevision++;
      callListeners[0]();
    },
    ({ controller }) => chartMeasurement(controller).toggle()
  ]) {
    const fixture = setup();
    const { bind, pointer, session, actions, captures, previews } = fixture;
    const unbind = bind();
    pointer("pointerdown", 10, 20);
    pointer("pointermove", 60, 80);
    cancel(fixture);
    assert.equal(session.isArmed(), false);
    assert.equal(previews.at(-1), null);
    assert.equal(captures.size, 0);
    assert.equal(pointer("pointerup", 60, 80), false);
    assert.deepEqual(actions, []);
    unbind();
  }
});

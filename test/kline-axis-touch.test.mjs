import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

const sdk = readFileSync(
  new URL("../node_modules/klinecharts/dist/index.esm.js", import.meta.url),
  "utf8"
);
const names = { MAIN: "main", X_AXIS: "xAxis", Y_AXIS: "yAxis", SEPARATOR: "separator" };
function nativeMethod(owner, name) {
  const marker = `${owner}.prototype.${name} = function`;
  const start = sdk.indexOf(marker);
  assert.ok(start >= 0, marker);
  const body = sdk.indexOf("{", start);
  let end = body + 1,
    depth = 1;
  while (depth) {
    if (sdk[end] === "{") depth++;
    else if (sdk[end] === "}") depth--;
    end++;
  }
  return vm.runInNewContext(`(${sdk.slice(sdk.indexOf("function", start), end)})`, {
    WidgetNameConstants: names,
    __assign: Object.assign,
    isFF: () => false,
    isValid: (value) => value !== undefined && value !== null,
    setTimeout: () => 1,
    clearTimeout() {},
    performance: { now: () => 1001 }
  });
}
function eventHost() {
  const listeners = new Map(),
    options = new Map();
  return {
    listeners,
    options,
    addEventListener(name, listener, option) {
      listeners.set(name, listener);
      options.set(name, option);
    },
    removeEventListener(name, listener) {
      if (listeners.get(name) === listener) listeners.delete(name);
    }
  };
}
function fixture(autoScale = true) {
  const host = eventHost(),
    root = eventHost(),
    container = eventHost();
  container.ownerDocument = { defaultView: host, documentElement: root };
  container.getBoundingClientRect = () => ({ left: 0, top: 0 });
  let writes = 0,
    paints = 0;
  const nativeSetRange = nativeMethod("AxisImp", "setRange");
  const axisComponent = {
    _range: { from: 100, to: 200, range: 100 },
    _autoCalcTickFlag: autoScale,
    getRange: nativeMethod("AxisImp", "getRange"),
    getAutoCalcTickFlag: nativeMethod("AxisImp", "getAutoCalcTickFlag"),
    setAutoCalcTickFlag: nativeMethod("AxisImp", "setAutoCalcTickFlag"),
    getScrollZoomEnabled: () => true,
    convertToRealValue: (value) => value,
    setRange(value) {
      nativeSetRange.call(this, value);
      writes++;
    }
  };
  const pane = { getId: () => "candle_pane", getAxisComponent: () => axisComponent };
  const widget = {
    getName: () => names.Y_AXIS,
    getPane: () => pane,
    getBounding: () => ({ left: 300, top: 50 }),
    dispatchEvent: () => false
  };
  const native = {
    _mouseDownWidget: null,
    _prevYAxisRange: null,
    _yAxisStartScaleDistance: 0,
    _chart: {
      adjustPaneViewport: () => paints++,
      getChartStore: () => ({ getTooltipStore: () => ({}) })
    },
    _findWidgetByEvent: () => ({ pane, widget })
  };
  for (const name of [
    "mouseDownEvent",
    "pressedMouseMoveEvent",
    "mouseUpEvent",
    "mouseClickEvent",
    "mouseDoubleClickEvent",
    "touchStartEvent",
    "touchMoveEvent",
    "_makeWidgetEvent"
  ])
    native[name] = nativeMethod("Event", name);
  const synthetic = {
    _target: container,
    _handler: native,
    _mouseMoveStartCoordinate: null,
    _unsubscribeRootMouseEvents: null,
    _clickTimeoutId: null,
    _clickCount: 0,
    _lastTouchEventTimeStamp: 1000,
    _cancelClick: false
  };
  for (const name of [
    "_mouseDownHandler",
    "_mouseMoveWithDownHandler",
    "_mouseUpHandler",
    "_getCoordinate",
    "_makeCompatEvent",
    "_firesTouchEvents",
    "_processEvent",
    "_mouseTouchMoveWithDownInfo",
    "_resetClickTimeout",
    "_preventDefault",
    "_eventTimeStamp"
  ])
    synthetic[name] = nativeMethod("SyntheticEvent", name);
  const sent = [];
  const axis = {
    getBoundingClientRect: () => ({ left: 300, right: 360, top: 50, bottom: 450 }),
    dispatchEvent(event) {
      sent.push(event);
      if (event.type === "mousedown") synthetic._mouseDownHandler(event);
      else if (event.type === "mousemove") synthetic._mouseMoveWithDownHandler(event);
      else synthetic._mouseUpHandler(event);
    }
  };
  const chart = {
    getDom: (pane, position) => {
      assert.equal(pane, "candle_pane");
      assert.equal(position, "yAxis");
      return axis;
    }
  };
  const { attachKlineAxisTouch } = sourceModules({
    klinecharts: { DomPosition: { YAxis: "yAxis" } }
  })("charts/kline-axis-touch.ts");
  const stop = attachKlineAxisTouch(container, chart);
  const touch = (x = 330, y = 200, id = 1) => ({ clientX: x, clientY: y, identifier: id });
  const emit = (type, touches, changedTouches = touches) => {
    const event = {
      type,
      touches,
      changedTouches,
      cancelable: true,
      defaultPrevented: false,
      stopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      }
    };
    (type === "touchstart" ? container : host).listeners.get(type)?.(event);
    return event;
  };
  return {
    host,
    root,
    container,
    native,
    synthetic,
    sent,
    touch,
    emit,
    stop,
    range: () => axisComponent.getRange(),
    autoScale: () => axisComponent.getAutoCalcTickFlag(),
    writes: () => writes,
    paints: () => paints
  };
}

class MouseFixture {
  constructor(type, options) {
    Object.assign(this, options, {
      type,
      timeStamp: 1001,
      pageX: options.clientX,
      pageY: options.clientY + 120
    });
  }
  preventDefault() {}
}
function withMouse(run) {
  const previous = globalThis.MouseEvent;
  globalThis.MouseEvent = MouseFixture;
  try {
    run();
  } finally {
    globalThis.MouseEvent = previous;
  }
}

test("installed KLine touch axis path leaves range unchanged; bridge uses native mouse scaling immediately after touch", () =>
  withMouse(() => {
    const f = fixture();
    f.native.touchStartEvent({ x: 330, y: 200, pageY: 320 });
    f.native.touchMoveEvent({ x: 330, y: 250, pageY: 370 });
    assert.equal(f.writes(), 0, "unmodified installed SDK touch path does not scale its axis");
    assert.equal(f.emit("touchstart", [f.touch()]).defaultPrevented, true);
    assert.equal(f.emit("touchmove", [f.touch(200, 250)]).defaultPrevented, true);
    assert.equal(f.writes(), 1);
    assert.equal(f.paints(), 1);
    assert.equal(f.range().range, (100 * 370) / 320);
    assert.equal(f.sent[1].clientX, 330, "horizontal drift remains in owned Y-axis lane");
    assert.equal(f.sent[1].clientY, 250);
    for (const event of f.sent) {
      assert.equal(event.bubbles, true);
      assert.equal(event.cancelable, true);
      assert.equal(event.button, 0);
      assert.equal(event.sourceCapabilities.firesTouchEvents, false);
      assert.equal(
        f.synthetic._firesTouchEvents(event),
        false,
        "no arbitrary SDK compatibility delay"
      );
    }
    f.emit("touchend", [], [f.touch(200, 250)]);
    assert.equal(f.sent.at(-1).buttons, 0);
    assert.equal(f.native._mouseDownWidget, null);
    assert.equal(f.synthetic._mousePressed, false);
    f.stop();
  }));

test("plot, outside, and multi-touch starts preserve workspace scrolling and SDK navigation", () =>
  withMouse(() => {
    const f = fixture();
    for (const touches of [
      [f.touch(250)],
      [f.touch(330, 451)],
      [f.touch(), f.touch(340, 220, 2)]
    ]) {
      const event = f.emit("touchstart", touches);
      assert.equal(event.defaultPrevented, false);
      assert.equal(event.stopped, false);
    }
    assert.equal(f.sent.length, 0);
    assert.equal(f.emit("touchmove", [f.touch(200, 250)]).defaultPrevented, false);
    assert.equal(f.writes(), 0);
    f.stop();
  }));

test("second finger finishes owned axis drag and returns events to SDK; foreign release cannot finish it", () =>
  withMouse(() => {
    const f = fixture();
    f.emit("touchstart", [f.touch()]);
    f.emit("touchmove", [f.touch(330, 250)]);
    f.emit("touchend", [f.touch()], [f.touch(340, 250, 2)]);
    f.emit("touchcancel", [f.touch()], [f.touch(340, 250, 2)]);
    assert.equal(f.sent.length, 2);
    const second = f.emit("touchstart", [f.touch(), f.touch(340, 250, 2)], [f.touch(340, 250, 2)]);
    assert.equal(second.defaultPrevented, false);
    assert.equal(second.stopped, false);
    assert.equal(f.sent.at(-1).type, "mouseup");
    assert.equal(f.synthetic._mousePressed, false);
    assert.equal(f.emit("touchmove", [f.touch(330, 300)]).defaultPrevented, false);
    f.stop();
  }));

test("cancel, blur and dispose release native drag, remove listeners, and never consume later plot touches", () =>
  withMouse(() => {
    for (const autoScale of [true, false])
      for (const finish of ["touchcancel", "second-finger", "blur", "dispose"]) {
        const f = fixture(autoScale);
        assert.deepEqual(f.container.options.get("touchstart"), { capture: true, passive: false });
        assert.deepEqual(f.host.options.get("touchmove"), { capture: true, passive: false });
        f.emit("touchstart", [f.touch()]);
        f.emit("touchmove", [f.touch(330, 250)]);
        const intended = f.range();
        assert.equal(f.autoScale(), false);
        assert.equal(f.writes(), 1);
        if (finish === "touchcancel") f.emit(finish, [], [f.touch()]);
        else if (finish === "second-finger")
          f.emit("touchstart", [f.touch(), f.touch(340, 220, 2)]);
        else if (finish === "blur") f.host.listeners.get("blur")();
        else f.stop();
        assert.equal(f.sent.at(-1).type, "mouseup");
        assert.equal(f.synthetic._mousePressed, false);
        assert.equal(f.native._mouseDownWidget, null);
        assert.equal(f.writes(), 1, "cancellation must not write another price range");
        assert.equal(f.range(), intended);
        assert.equal(f.autoScale(), false);
        assert.equal(f.emit("touchmove", [f.touch(330, 300)]).defaultPrevented, false);
        f.stop();
        f.stop();
        assert.equal(f.container.listeners.size, 0);
        assert.equal(f.host.listeners.size, 0);
        assert.equal(f.root.listeners.size, 0);
      }
  }));

test("stationary and sub-threshold cancellation preserve native autoscale and write no range", () =>
  withMouse(() => {
    for (const autoScale of [true, false]) {
      for (const finish of ["touchcancel", "second-finger", "blur", "dispose"]) {
        const f = fixture(autoScale),
          original = f.range();
        for (let attempt = 0; attempt < (finish === "dispose" ? 1 : 2); attempt++) {
          f.emit("touchstart", [f.touch()]);
          if (attempt > 0) f.emit("touchmove", [f.touch(330, 204)]);
          assert.equal(f.sent.length, 0, "pending touch must not open an SDK mouse gesture");
          if (finish === "touchcancel") f.emit(finish, [], [f.touch()]);
          else if (finish === "second-finger")
            f.emit("touchstart", [f.touch(), f.touch(340, 220, 2)]);
          else if (finish === "blur") f.host.listeners.get("blur")();
          else f.stop();
          assert.equal(f.writes(), 0, `${finish} must not call native AxisImp.setRange`);
          assert.equal(f.range(), original);
          assert.equal(f.autoScale(), autoScale);
          assert.equal(f.native._mouseDownWidget, null);
          assert.notEqual(f.synthetic._mousePressed, true);
        }
        f.stop();
        assert.equal(f.root.listeners.size, 0);
      }
    }
  }));

test("bridge starts exactly at installed SDK CancelClick boundary with the original down coordinate", () =>
  withMouse(() => {
    const f = fixture();
    f.emit("touchstart", [f.touch()]);
    f.emit("touchmove", [f.touch(330, 204.999)]);
    assert.equal(f.sent.length, 0);
    assert.equal(f.writes(), 0);
    assert.equal(f.autoScale(), true);
    f.emit("touchmove", [f.touch(330, 205)]);
    assert.equal(f.sent.length, 2);
    assert.equal(f.sent[0].type, "mousedown");
    assert.equal(f.sent[0].clientY, 200);
    assert.equal(
      f.synthetic._cancelClick,
      true,
      "installed SyntheticEvent accepts the exact 5px threshold"
    );
    assert.equal(f.writes(), 1);
    assert.equal(f.range().range, (100 * 325) / 320);
    f.stop();
    assert.equal(f.writes(), 1);
    assert.equal(f.synthetic._mousePressed, false);
  }));

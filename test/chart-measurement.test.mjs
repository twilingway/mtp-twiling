import assert from "node:assert/strict";
import test from "node:test";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const minute = 60_000;
const day = 86_400_000;
const point = (timestamp, value) => ({ timestamp, value });
const fridayClose = Date.UTC(2026, 0, 2, 20);
const mondayOpen = Date.UTC(2026, 0, 5, 9);
const timestamps = [fridayClose - minute, fridayClose, mondayOpen, mondayOpen + minute];
const candles = timestamps.map((timestamp) => ({ timestamp }));
const { measureChartRange } = createSourceLoader()("model/chart-measurement.js");

test("the ruler counts actual candle intervals through a weekend", () => {
  const from = point(fridayClose, 80);
  const to = point(mondayOpen + minute, 120);
  assert.deepEqual(measureChartRange(from, to, candles), {
    change: 40,
    percent: 50,
    bars: 2,
    elapsed: 2 * day + 13 * 60 * minute + minute
  });
  assert.deepEqual(measureChartRange(to, from, candles), {
    change: -40,
    percent: (-40 / 120) * 100,
    bars: 2,
    elapsed: 2 * day + 13 * 60 * minute + minute
  });
});

test("empty projected times do not invent candles and zero reference omits the percentage", () => {
  const from = point(mondayOpen + day, 0);
  const to = point(mondayOpen + 2 * day, 13);
  assert.deepEqual(measureChartRange(from, to, candles), {
    change: 13,
    percent: null,
    bars: 0,
    elapsed: day
  });
  assert.equal(
    measureChartRange(point(fridayClose, -20), point(mondayOpen, -10), candles).percent,
    50
  );
});

function setup() {
  const cleanup = [];
  const load = createSourceLoader({
    react: {
      useEffect(effect) {
        const dispose = effect();
        if (dispose) cleanup.push(dispose);
      },
      useRef(current) {
        return { current };
      }
    }
  });
  const { useChartMeasurementInput } = load("screens/terminal/chart-measurement-input.js");
  const { chartMeasurement } = load("screens/terminal/chart-measurement-session.js");
  const state = {
    owner: "profile",
    chartRevision: 1,
    preferences: { symbol: "A", instrumentUid: "a-id", engine: "kline", timeframe: "1m" },
    candles,
    rows: [{ symbol: "A", uid: "a-id", step: 0.05 }]
  };
  const controller = {
    getSnapshot: () => state,
    chart: {
      pixelToPoint: (x, y) =>
        timestamps[x - 10] !== undefined && y < 100 ? point(timestamps[x - 10], y / 100) : null
    }
  };
  const coordinates = ({ clientX, clientY }) => ({ x: clientX, y: clientY });
  const input = useChartMeasurementInput(controller, state, coordinates, ".ignored");
  const session = chartMeasurement(controller);
  return {
    input,
    session,
    nextSession: chartMeasurement({}),
    state,
    dispose: () => cleanup.forEach((run) => run())
  };
}

function pointer(x, y, shiftKey = false) {
  const calls = [];
  const event = {
    isPrimary: true,
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
    shiftKey,
    preventDefault: () => calls.push("prevent"),
    stopPropagation: () => calls.push("stop")
  };
  return { event, calls };
}

test("Shift-click selects one chart's endpoints, previews and dismisses without taking a regular tap", () => {
  const { input, session, nextSession, dispose } = setup();
  const ordinary = pointer(11, 22);
  assert.equal(input.down(ordinary.event), false);
  assert.deepEqual(ordinary.calls, []);
  const from = pointer(11, 22, true);
  assert.equal(input.down(from.event), true);
  assert.equal(input.up(from.event), true);
  assert.deepEqual(from.calls, ["prevent", "stop", "prevent", "stop"]);
  assert.deepEqual(session.get(), { phase: "tracking", from: point(fridayClose, 0.2), to: null });
  const to = pointer(13, 74, true);
  assert.equal(input.move(to.event), true);
  assert.deepEqual(session.get().to, point(mondayOpen + minute, 0.75));
  assert.equal(input.down(to.event), true);
  assert.equal(input.up(to.event), true);
  assert.equal(session.get().phase, "result");
  assert.equal(nextSession.get().phase, "idle");
  assert.equal(input.down(ordinary.event), false);
  assert.equal(session.get().phase, "idle");
  dispose();
});

test("the toolbar mode accepts two taps, rejects swipes and clears a cancelled pointer", () => {
  const { input, session, dispose } = setup();
  session.toggle();
  assert.equal(session.get().phase, "armed");
  let tap = pointer(11, 22).event;
  assert.equal(input.down(tap), true);
  assert.equal(input.up({ ...tap, clientY: 55 }), true);
  assert.equal(session.get().phase, "armed");
  assert.equal(input.down(tap), true);
  input.cancel(tap);
  assert.equal(input.up(tap), false);
  assert.equal(session.get().phase, "armed");
  assert.equal(input.down(tap), true);
  assert.equal(input.up(tap), true);
  assert.equal(session.get().phase, "tracking");
  tap = pointer(12, 61).event;
  assert.equal(input.down(tap), true);
  assert.equal(input.up(tap), true);
  assert.equal(session.get().phase, "result");
  dispose();
  assert.equal(session.get().phase, "idle");
});

test("the ruler ignores the scales, profile transitions and pointers outside current candles", () => {
  const { input, session, state, dispose } = setup();
  session.toggle();
  assert.equal(input.down(pointer(11, 110).event), false);
  state.profileTransition = true;
  assert.equal(input.down(pointer(11, 22).event), false);
  assert.equal(session.get().phase, "armed");
  state.profileTransition = false;
  state.candles = [];
  assert.equal(input.down(pointer(11, 22).event), false);
  dispose();
});

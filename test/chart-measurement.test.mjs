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

function renderMeasurement(
  start,
  end,
  from,
  to,
  preview = false,
  { width = 400, height = 200, locale = "en" } = {}
) {
  const jsx = (type, props) => ({ type, ...props });
  const load = createSourceLoader({
    react: {
      useEffect() {},
      useLayoutEffect() {},
      useState: () => [{ from, to, width, height }],
      useSyncExternalStore: (_subscribe, get) => get()
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "screens/terminal/context.js": {}
  });
  const { ChartMeasurementOverlay } = load("screens/terminal/ChartMeasurement.js");
  const { chartMeasurement } = load("screens/terminal/chart-measurement-session.js");
  const controller = {};
  const session = chartMeasurement(controller);
  session.select(start);
  if (end) {
    if (preview) session.preview(end);
    else session.select(end);
  }
  const state = { preferences: { locale }, rows: [], candles };
  const overlay = ChartMeasurementOverlay({ controller, state });
  const [svg, card] = overlay.children;
  const shapes = svg.children.filter(Boolean);
  return {
    phase: overlay["data-measurement"],
    direction: overlay["data-measurement-direction"],
    arrows: shapes.filter((shape) => shape.type === "path").map((shape) => shape.d),
    area: shapes.find((shape) => shape.type === "rect"),
    points: shapes.filter((shape) => shape.type === "circle"),
    card
  };
}

test("the ruler colors growth and decline by price and points independently along both axes", () => {
  const lower = point(fridayClose, -20);
  const higher = point(mondayOpen, -10);
  const leftBottom = { x: 20, y: 80 };
  const rightTop = { x: 80, y: 20 };
  const rise = renderMeasurement(lower, higher, leftBottom, rightTop, true);
  assert.equal(rise.phase, "tracking");
  assert.equal(rise.direction, "up");
  assert.deepEqual(rise.arrows, [
    "M20 50L80 50M74 53.3L80 50L74 46.7",
    "M50 80L50 20M53.3 26L50 20L46.7 26"
  ]);
  assert.deepEqual(
    { x: rise.area.x, y: rise.area.y, width: rise.area.width, height: rise.area.height },
    { x: 20, y: 20, width: 60, height: 60 }
  );
  const fall = renderMeasurement(higher, lower, rightTop, leftBottom);
  assert.equal(fall.phase, "result");
  assert.equal(fall.direction, "down");
  assert.deepEqual(fall.arrows, [
    "M80 50L20 50M26 46.7L20 50L26 53.3",
    "M50 20L50 80M46.7 74L50 80L53.3 74"
  ]);
  assert.equal(fall.card["aria-label"], "Measurement");
  const reverseRise = renderMeasurement(
    point(mondayOpen, -20),
    point(fridayClose, -10),
    { x: 80, y: 80 },
    { x: 20, y: 20 }
  );
  assert.equal(reverseRise.direction, "up");
  assert.deepEqual(reverseRise.arrows, [fall.arrows[0], rise.arrows[1]]);
});

test("the ruler omits zero-length axes and keeps the other arrow and result", () => {
  const start = point(fridayClose, 100);
  const from = { x: 20, y: 30 };
  const flat = renderMeasurement(start, point(mondayOpen, 100), from, { x: 23, y: 30 });
  assert.equal(flat.direction, "flat");
  assert.equal(flat.area, undefined);
  assert.deepEqual(flat.arrows, ["M20 30L23 30M22 30.55L23 30L22 29.45"]);
  const vertical = renderMeasurement(start, point(fridayClose, 80), from, { x: 20, y: 60 });
  assert.equal(vertical.direction, "down");
  assert.equal(vertical.area, undefined);
  assert.deepEqual(vertical.arrows, ["M20 30L20 60M16.7 54L20 60L23.3 54"]);
  const samePoint = renderMeasurement(start, start, from, from);
  assert.equal(samePoint.direction, "flat");
  assert.equal(samePoint.area, undefined);
  assert.deepEqual(samePoint.arrows, []);
  assert.equal(samePoint.points.length, 1);
  assert.equal(samePoint.card["aria-label"], "Measurement");
});

test("the card keeps a separate headline and stats and fits a narrow pane at its lower edge", () => {
  const { card } = renderMeasurement(
    point(fridayClose, 80),
    point(mondayOpen, 120),
    { x: 10, y: 38 },
    { x: 89, y: 79 },
    false,
    { width: 92, height: 82, locale: "ru" }
  );
  assert.equal(card["data-compact"], "true");
  assert.equal(card.style.width, 80);
  assert.equal(card.style.left, 6);
  assert.equal(card.style.top, 76);
  assert.equal(card.style.maxHeight, 70);
  assert.equal(card.style.transform, "translateY(min(0px, calc(0px - 100%)))");
  const [change, stats] = card.children.children;
  assert.equal(change.type, "strong");
  assert.equal(change.children.length, 2);
  assert.match(change.children[0].children, /40,00/);
  assert.match(change.children[1].children, /50,00%/);
  assert.equal(stats.type, "dl");
  assert.deepEqual(
    stats.children.map(({ children: [label] }) => label.children),
    ["Свечи", "Время"]
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

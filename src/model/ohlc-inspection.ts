import type { PixelPoint } from "./types.js";

export const OHLC_HOLD_MS = 480;
const tapSlop = 8;

interface Press {
  id: number;
  point: PixelPoint;
  touch: boolean;
  startedAt: number;
}

type Schedule = (run: () => void, delay: number) => () => void;

export function createOhlcInspection(
  onHold: boolean,
  show: (timestamp: number | null) => void,
  schedule: Schedule
) {
  let pending: (() => void) | undefined;
  let hovered: number | null = null;
  let pinned = false;
  let visible: number | null = null;
  let press: (Press & { timestamp: number; shown: boolean; dismiss: boolean }) | null = null;

  function publish(timestamp: number | null) {
    if (visible === timestamp) return;
    visible = timestamp;
    show(timestamp);
  }

  function stopTimer() {
    pending?.();
    pending = undefined;
  }

  function clear() {
    stopTimer();
    hovered = null;
    pinned = false;
    press = null;
    publish(null);
  }

  function moved(start: PixelPoint, point: PixelPoint) {
    return Math.hypot(point.x - start.x, point.y - start.y) > tapSlop;
  }

  return {
    clear,
    leave: () => {
      if (!pinned || press) clear();
    },
    hover(timestamp: number | null) {
      if (press || pinned || hovered === timestamp) return;
      stopTimer();
      hovered = timestamp;
      if (onHold && timestamp !== null) {
        publish(null);
        pending = schedule(() => publish(timestamp), OHLC_HOLD_MS);
      } else publish(timestamp);
    },
    down(input: Press, timestamp: number | null) {
      if (press || timestamp === null) {
        clear();
        return;
      }
      stopTimer();
      hovered = null;
      const current = { ...input, timestamp, shown: false, dismiss: pinned };
      press = current;
      if (!pinned) publish(null);
      if (onHold && !current.dismiss) {
        pending = schedule(() => {
          current.shown = true;
          pinned = input.touch;
          publish(timestamp);
        }, OHLC_HOLD_MS);
      }
    },
    hasPress: (id: number) => press?.id === id,
    move(id: number, point: PixelPoint, sample: () => number | null) {
      if (press?.id === id && (moved(press.point, point) || sample() !== press.timestamp)) clear();
    },
    up(id: number, point: PixelPoint, timestamp: number | null, endedAt: number) {
      if (press?.id !== id) return;
      const current = press;
      press = null;
      stopTimer();
      if (
        !current.touch ||
        moved(current.point, point) ||
        current.dismiss ||
        current.timestamp !== timestamp
      ) {
        clear();
        return;
      }
      if (current.shown || (!onHold && endedAt - current.startedAt < OHLC_HOLD_MS)) {
        if (!current.shown) {
          pinned = true;
          publish(timestamp);
        }
      }
    },
    cancel(id: number) {
      if (press?.id === id) clear();
    },
    touchPress: () => onHold && press?.touch === true
  };
}

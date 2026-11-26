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
  let press: (Press & { shown: boolean; dismiss: boolean }) | null = null;

  function stopTimer() {
    pending?.();
    pending = undefined;
  }

  function clear() {
    stopTimer();
    hovered = null;
    pinned = false;
    press = null;
    show(null);
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
        show(null);
        pending = schedule(() => show(timestamp), OHLC_HOLD_MS);
      } else show(timestamp);
    },
    down(input: Press, timestamp: number | null) {
      if (press) {
        clear();
        return;
      }
      stopTimer();
      hovered = null;
      const current = { ...input, shown: false, dismiss: pinned };
      press = current;
      if (!pinned) show(null);
      if (onHold && timestamp !== null && !current.dismiss) {
        pending = schedule(() => {
          current.shown = true;
          pinned = input.touch;
          show(timestamp);
        }, OHLC_HOLD_MS);
      }
    },
    move(id: number, point: PixelPoint) {
      if (press?.id === id && moved(press.point, point)) clear();
    },
    up(id: number, point: PixelPoint, timestamp: number | null, endedAt: number) {
      if (press?.id !== id) return;
      const current = press;
      press = null;
      stopTimer();
      if (!current.touch || moved(current.point, point) || current.dismiss) {
        clear();
        return;
      }
      if (current.shown || (!onHold && endedAt - current.startedAt < OHLC_HOLD_MS)) {
        if (!current.shown) {
          pinned = timestamp !== null;
          show(timestamp);
        }
      }
    },
    cancel(id: number) {
      if (press?.id === id) clear();
    },
    touchPress: () => onHold && press?.touch === true
  };
}

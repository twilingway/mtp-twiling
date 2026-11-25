import { DomPosition } from "klinecharts";
import type { Chart } from "klinecharts";
import type { PixelPoint } from "../model/types.js";

/** KLine 9 exposes its axis DOM but no public method for disabling price autoscale. */
export function freezeKlinePriceScale(chart: Pick<Chart, "getDom">): boolean {
  const axis = chart.getDom("candle_pane", DomPosition.YAxis);
  if (!axis) return false;
  const rect = axis.getBoundingClientRect();
  if (rect.width < 14 || rect.height <= 0) return false;
  const clientX = rect.left + rect.width / 2,
    clientY = rect.top + rect.height / 2,
    event = { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX, clientY };
  // A horizontal axis gesture crosses the native drag threshold with an unchanged Y.
  // Native axis handling copies the current range into manual mode at exactly 1:1.
  axis.dispatchEvent(new MouseEvent("mousedown", event));
  axis.dispatchEvent(new MouseEvent("mousemove", { ...event, clientX: clientX + 6 }));
  axis.dispatchEvent(new MouseEvent("mouseup", { ...event, clientX: clientX + 6, buttons: 0 }));
  return true;
}

export function beginKlinePan(chart: Pick<Chart, "getDom">, start?: PixelPoint): void {
  if (!freezeKlinePriceScale(chart) || !start) return;
  const pane = chart.getDom("candle_pane", DomPosition.Main);
  if (!pane) return;
  const rect = pane.getBoundingClientRect();
  // Restore the native main-pane drag interrupted by the axis-mode gesture.
  pane.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: rect.left + start.x,
      clientY: rect.top + start.y
    })
  );
}

export function resetKlinePriceScale(chart: Pick<Chart, "getDom">): void {
  const axis = chart.getDom("candle_pane", DomPosition.YAxis);
  if (!axis) return;
  const rect = axis.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const event = {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2
  };
  // KLine recognizes its native double click from two down/up pairs.
  for (let click = 0; click < 2; click++) {
    axis.dispatchEvent(new MouseEvent("mousedown", { ...event, buttons: 1 }));
    axis.dispatchEvent(new MouseEvent("mouseup", { ...event, buttons: 0 }));
  }
}

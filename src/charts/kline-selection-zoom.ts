import { DomPosition } from "klinecharts";
import type { Chart } from "klinecharts";
import { selectionTimeWindow } from "./selection-zoom.js";
import type { SelectionZoomBounds } from "./selection-zoom.js";

interface AxisRange {
  from: number;
  to: number;
  range: number;
  realFrom: number;
  realTo: number;
  realRange: number;
}

interface NativePriceChart extends Pick<Chart, "getDom"> {
  // KLine 9.8.12's axis gesture uses these methods. Its public API only zooms X.
  getDrawPaneById?(paneId: string): {
    getAxisComponent?(): {
      getType?(): string;
      setRange?(value: AxisRange): void;
      setAutoCalcTickFlag?(flag: boolean): void;
    } | null;
  } | null;
  adjustPaneViewport?(
    measureHeight: boolean,
    measureWidth: boolean,
    paint: boolean,
    y: boolean
  ): void;
}

const pricePane = "candle_pane";

export function resetKlineSelectionPrice(chart: NativePriceChart): boolean {
  const axis = chart.getDrawPaneById?.(pricePane)?.getAxisComponent?.();
  if (
    typeof axis?.setAutoCalcTickFlag !== "function" ||
    typeof chart.adjustPaneViewport !== "function"
  )
    return false;
  axis.setAutoCalcTickFlag(true);
  chart.adjustPaneViewport(false, true, true, true);
  return true;
}

export function zoomKlineSelection(
  chart: NativePriceChart &
    Pick<Chart, "getSize" | "getBarSpace" | "setBarSpace" | "scrollByDistance">,
  selection: SelectionZoomBounds,
  xAt: (index: number) => number | undefined
): boolean {
  const size = chart.getSize(pricePane, DomPosition.Main);
  const axis = chart.getDrawPaneById?.(pricePane)?.getAxisComponent?.();
  // MTP configures a linear price axis. For incompatible SDKs leave the full viewport intact.
  if (
    !size ||
    size.width <= 0 ||
    size.height <= 0 ||
    axis?.getType?.() !== "normal" ||
    typeof axis.setRange !== "function" ||
    typeof chart.adjustPaneViewport !== "function"
  )
    return false;
  const window = selectionTimeWindow(selection.time, size.width, 1, 50);
  if (!window) return false;
  const x = xAt(window.center);
  if (x === undefined || !Number.isFinite(x)) return false;

  const { from, to } = selection.price;
  const range = to - from;
  // setRange switches off native autoscale just like dragging the vertical price axis.
  axis.setRange({ from, to, range, realFrom: from, realTo: to, realRange: range });
  if (chart.getBarSpace() !== window.spacing) chart.setBarSpace(window.spacing);
  const centerX = xAt(window.center);
  if (centerX !== undefined && Number.isFinite(centerX)) {
    const distance = size.width / 2 - centerX;
    if (Math.abs(distance) > 0.5) chart.scrollByDistance(distance, 0);
  }
  chart.adjustPaneViewport(false, true, true, true);
  return true;
}

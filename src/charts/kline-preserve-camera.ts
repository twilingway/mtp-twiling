import { DomPosition } from "klinecharts";
import type { Chart } from "klinecharts";
import { signedRightOffset } from "./view-camera.js";

/** Positive distances are exact; historical negative distances require signed pixel geometry. */
export function readKlineCameraOffset(chart: Chart): number {
  const spacing = chart.getBarSpace();
  const distance = chart.getOffsetRightDistance();
  if (Number.isFinite(distance) && distance > 0 && spacing > 0) return distance / spacing;
  const width = chart.getSize("candle_pane", DomPosition.Main)?.width;
  const pixels = chart.convertToPixel([{ dataIndex: chart.getDataList().length - 1 }], {
    paneId: "candle_pane",
    absolute: true
  });
  const point = Array.isArray(pixels) ? pixels[0] : pixels;
  return width !== undefined && point?.x !== undefined && spacing > 0
    ? signedRightOffset(width, point.x, spacing)
    : distance / spacing;
}

export function preserveKlineCamera(chart: Chart, action: () => void): void {
  const spacing = chart.getBarSpace();
  const before = readKlineCameraOffset(chart);
  action();
  if (chart.getBarSpace() !== spacing) chart.setBarSpace(spacing);
  if (Number.isFinite(before) && Math.abs(readKlineCameraOffset(chart) - before) > 1e-9)
    chart.setOffsetRightDistance(before * spacing);
}

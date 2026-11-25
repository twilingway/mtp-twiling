import { DomPosition } from "klinecharts";
import type { Chart } from "klinecharts";
import { signedRightOffset } from "./view-camera.js";

/** getOffsetRightDistance can clamp historical negative offsets; derive the signed public geometry. */
export function preserveKlineCamera(chart: Chart, action: () => void): void {
  const spacing = chart.getBarSpace();
  const offset = () => {
    const width = chart.getSize("candle_pane", DomPosition.Main)?.width;
    const pixels = chart.convertToPixel([{ dataIndex: chart.getDataList().length - 1 }], {
      paneId: "candle_pane",
      absolute: true
    });
    const point = Array.isArray(pixels) ? pixels[0] : pixels;
    return width !== undefined && point?.x !== undefined && spacing > 0
      ? signedRightOffset(width, point.x, spacing)
      : chart.getOffsetRightDistance() / spacing;
  };
  const before = offset();
  action();
  if (chart.getBarSpace() !== spacing) chart.setBarSpace(spacing);
  if (Number.isFinite(before) && Math.abs(offset() - before) > 1e-9)
    chart.setOffsetRightDistance(before * spacing);
}

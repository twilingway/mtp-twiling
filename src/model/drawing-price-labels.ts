import { drawingStyle } from "./drawing-model.js";
import type { DrawingDraft, DrawingPoint } from "./types.js";

export interface DrawingPriceTarget {
  point: DrawingPoint;
  color: string;
  anchor: "always" | "visible" | "ray";
}

export function drawingPriceTargets(
  drawings: readonly DrawingDraft[],
  selected?: DrawingDraft
): DrawingPriceTarget[] {
  const target = (
    drawing: DrawingDraft,
    point: DrawingPoint,
    anchor: DrawingPriceTarget["anchor"]
  ): DrawingPriceTarget => ({ point, color: drawingStyle(drawing).color, anchor });
  const selectedTargets =
    selected && selected.name !== "verticalStraightLine"
      ? selected.points.map((point) => target(selected, point, "visible"))
      : [];
  return [
    ...drawings.flatMap((drawing) => {
      const point = drawing.points[0];
      if (!point) return [];
      if (drawing.name === "horizontalStraightLine") return [target(drawing, point, "always")];
      if (drawing.name === "horizontalRayLine") return [target(drawing, point, "ray")];
      return [];
    }),
    ...selectedTargets
  ];
}

export function drawingPriceLabelPosition(
  trueY: number,
  plotHeight: number,
  occupied: readonly number[],
  labelHeight = 16
): number | null {
  if (trueY < 0 || trueY > plotHeight || plotHeight < labelHeight) return null;
  const half = labelHeight / 2;
  const center = Math.max(half, Math.min(plotHeight - half, trueY));
  for (const candidate of [
    center,
    center - labelHeight,
    center + labelHeight,
    center - 2 * labelHeight,
    center + 2 * labelHeight
  ]) {
    if (
      candidate >= half &&
      candidate <= plotHeight - half &&
      occupied.every((used) => Math.abs(used - candidate) >= labelHeight)
    )
      return candidate;
  }
  return null;
}

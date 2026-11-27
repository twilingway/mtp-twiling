import type { Drawing, DrawingSettings, ImageAsset, PixelPoint } from "../../../model/types.js";

export interface WidgetViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function clampObjectWidget(
  point: PixelPoint,
  size: { width: number; height: number },
  viewport: WidgetViewport
): PixelPoint {
  const left = viewport.left + 6;
  const top = viewport.top + 6;
  return {
    x: Math.max(left, Math.min(point.x, viewport.left + viewport.width - size.width - 6)),
    y: Math.max(top, Math.min(point.y, viewport.top + viewport.height - size.height - 6))
  };
}

export function selectedWidgetObject(
  selected: string | null,
  drawings: readonly Drawing[],
  images: readonly ImageAsset[]
) {
  const drawing = drawings.find((item) => item.id === selected && item.visible !== false);
  if (drawing) return { kind: "drawing" as const, drawing };
  const image = images.find((item) => item.id === selected && item.visible !== false);
  return image ? { kind: "image" as const, image } : null;
}

export function widgetLineColor(drawing: Drawing, color: string): Partial<DrawingSettings> {
  return drawing.name.startsWith("fibonacci") ? { color, oneColor: true } : { color };
}

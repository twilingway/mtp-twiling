import { isDrawing, isRecord } from "./backup-format.js";
import { annotationTableDimensions } from "./drawing-annotation.js";
import { isInstrumentSymbol } from "./instrument-symbol.js";
import type { Drawing, DrawingPoint, ImageAsset, PixelPoint } from "./types.js";

export interface EditingScope {
  owner: string;
  symbol: string;
}
export interface ObjectSnapshot extends EditingScope {
  drawings: Drawing[];
  images: ImageAsset[];
  selectedObject: string | null;
}
export function objectSnapshot(value: ObjectSnapshot): ObjectSnapshot {
  return {
    owner: value.owner,
    symbol: value.symbol,
    selectedObject: value.selectedObject,
    drawings: structuredClone(value.drawings),
    images: value.images.map((asset) => ({ ...asset, point: { ...asset.point } }))
  };
}
export function sameScope(a: EditingScope, b: EditingScope): boolean {
  return a.owner === b.owner && a.symbol === b.symbol;
}
function sameObjects(a: ObjectSnapshot, b: ObjectSnapshot): boolean {
  return (
    JSON.stringify(a.drawings) === JSON.stringify(b.drawings) &&
    a.images.length === b.images.length &&
    a.images.every((asset, index) => {
      const other = b.images[index];
      return (
        other?.blob === asset.blob &&
        JSON.stringify({ ...asset, blob: null }) === JSON.stringify({ ...other, blob: null })
      );
    })
  );
}
interface EditCommand {
  before: ObjectSnapshot;
  after: ObjectSnapshot;
}
export class DrawingUndoHistory {
  private readonly stacks = new Map<string, { undo: EditCommand[]; redo: EditCommand[] }>();
  private stack(scope: EditingScope) {
    const key = JSON.stringify([scope.owner, scope.symbol]);
    let stack = this.stacks.get(key);
    if (!stack) {
      stack = { undo: [], redo: [] };
      this.stacks.set(key, stack);
    }
    return stack;
  }
  record(before: ObjectSnapshot, after: ObjectSnapshot): boolean {
    if (!sameScope(before, after) || sameObjects(before, after)) return false;
    const stack = this.stack(before);
    stack.undo.push({ before: objectSnapshot(before), after: objectSnapshot(after) });
    stack.redo = [];
    return true;
  }
  undo(scope: EditingScope): ObjectSnapshot | null {
    const stack = this.stack(scope),
      command = stack.undo.pop();
    if (!command) return null;
    stack.redo.push(command);
    return objectSnapshot(command.before);
  }
  redo(scope: EditingScope): ObjectSnapshot | null {
    const stack = this.stack(scope),
      command = stack.redo.pop();
    if (!command) return null;
    stack.undo.push(command);
    return objectSnapshot(command.after);
  }
  clear(): void {
    this.stacks.clear();
  }
}

export interface ObjectProjection {
  pointToPixel(point: DrawingPoint): PixelPoint | null;
  pixelToPoint(x: number, y: number): DrawingPoint | null;
  plotSize?(): { width: number; height: number };
}
export function translatePoint(
  point: DrawingPoint,
  projection: ObjectProjection,
  offset: PixelPoint
): DrawingPoint | null {
  const pixel = projection.pointToPixel(point);
  return pixel ? projection.pixelToPoint(pixel.x + offset.x, pixel.y + offset.y) : null;
}
export function copyDrawing(
  drawing: Drawing,
  projection: ObjectProjection,
  offset: PixelPoint
): Drawing | null {
  const annotation = drawing.settings?.annotation;
  const points = annotation?.screenAnchored
    ? drawing.points.map((point) => ({ ...point }))
    : drawing.points.map((point) => translatePoint(point, projection, offset));
  if (points.some((point) => point === null)) return null;
  const copy = { ...structuredClone(drawing), id: crypto.randomUUID(), points };
  const size = projection.plotSize?.();
  if (annotation?.screenAnchored && size && size.width > 0 && size.height > 0) {
    const tableSize =
      drawing.name === "table"
        ? annotationTableDimensions(annotation, size)
        : { width: 0, height: 0 };
    copy.settings = {
      ...copy.settings,
      annotation: {
        ...copy.settings?.annotation,
        screenX: Math.max(
          0,
          Math.min(
            1,
            (annotation.screenX ?? 0.5) + offset.x / Math.max(1, size.width - tableSize.width)
          )
        ),
        screenY: Math.max(
          0,
          Math.min(
            1,
            (annotation.screenY ?? 0.3) + offset.y / Math.max(1, size.height - tableSize.height)
          )
        )
      }
    };
  }
  return isDrawing(copy) ? copy : null;
}
export function copyImage(
  asset: ImageAsset,
  scope: EditingScope,
  projection: ObjectProjection,
  offset: PixelPoint
): ImageAsset | null {
  const point = translatePoint(asset.point, projection, offset);
  return point
    ? { ...asset, ...scope, id: crypto.randomUUID(), syncId: crypto.randomUUID(), point }
    : null;
}

export const DRAWING_CLIPBOARD_MIME = "application/x-mtp-drawing+json";
const application = "mtp-drawing-clipboard";
interface DrawingClipboard {
  application: typeof application;
  version: 1;
  token: string;
  kind: "drawing";
  drawing: Drawing;
  placement?: ClipboardPlacement;
}
interface ImageClipboard {
  application: typeof application;
  version: 1;
  token: string;
  kind: "image";
}
export type ObjectClipboardPayload = DrawingClipboard | ImageClipboard;
export interface ClipboardPlacement {
  symbol: string;
  points: PixelPoint[];
}
const drawingKeys = new Set([
  "id",
  "name",
  "points",
  "settings",
  "title",
  "visible",
  "lock",
  "layer",
  "visibility"
]);
const settingKeys = new Set([
  "annotation",
  "color",
  "width",
  "lineStyle",
  "lineOpacity",
  "trendLine",
  "trendColor",
  "trendWidth",
  "trendStyle",
  "trendOpacity",
  "fill",
  "opacity",
  "extendLeft",
  "extendRight",
  "reverse",
  "labels",
  "prices",
  "levels",
  "labelSide",
  "labelVertical",
  "labelFormat",
  "fontSize",
  "textEnabled",
  "text",
  "textColor",
  "textAlign",
  "textVertical",
  "levelStyles",
  "oneColor",
  "extend"
]);
const onlyKeys = (value: Record<string, unknown>, keys: Set<string>) =>
  Object.keys(value).every((key) => keys.has(key));
function safeDrawing(value: unknown): value is Drawing {
  if (!isDrawing(value) || !onlyKeys(value as unknown as Record<string, unknown>, drawingKeys))
    return false;
  if (value.points.some((point) => !onlyKeys({ ...point }, new Set(["timestamp", "value"]))))
    return false;
  if (value.settings && !onlyKeys({ ...value.settings }, settingKeys)) return false;
  if (
    value.settings?.levelStyles?.some(
      (level) => !onlyKeys({ ...level }, new Set(["value", "enabled", "color", "text"]))
    )
  )
    return false;
  return (
    !value.visibility ||
    Object.values(value.visibility).every((rule) =>
      onlyKeys({ ...rule }, new Set(["enabled", "from", "to"]))
    )
  );
}
export function encodeDrawingClipboard(
  drawing: Drawing,
  token: string,
  placement?: ClipboardPlacement
): string | null {
  if (!safeDrawing(drawing)) return null;
  return JSON.stringify({
    application,
    version: 1,
    token,
    kind: "drawing",
    drawing,
    ...(placement ? { placement } : {})
  });
}
export function encodeImageClipboard(token: string): string {
  return JSON.stringify({ application, version: 1, token, kind: "image" });
}
export function parseObjectClipboard(text: string): ObjectClipboardPayload | null {
  if (!text || text.length > 256 * 1024) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (
      !isRecord(value) ||
      value.application !== application ||
      value.version !== 1 ||
      typeof value.token !== "string" ||
      value.token.length > 100
    )
      return null;
    if (
      value.kind === "drawing" &&
      onlyKeys(
        value,
        new Set(["application", "version", "token", "kind", "drawing", "placement"])
      ) &&
      safeDrawing(value.drawing)
    ) {
      const placement = value.placement;
      if (
        placement !== undefined &&
        (!isRecord(placement) ||
          !onlyKeys(placement, new Set(["symbol", "points"])) ||
          !isInstrumentSymbol(placement.symbol) ||
          !Array.isArray(placement.points) ||
          placement.points.length !== value.drawing.points.length ||
          !placement.points.every(
            (point: unknown) =>
              isRecord(point) &&
              onlyKeys(point, new Set(["x", "y"])) &&
              typeof point.x === "number" &&
              Number.isFinite(point.x) &&
              typeof point.y === "number" &&
              Number.isFinite(point.y)
          ))
      )
        return null;
      return {
        application,
        version: 1,
        token: value.token,
        kind: "drawing",
        drawing: value.drawing,
        ...(placement ? { placement: placement as unknown as ClipboardPlacement } : {})
      };
    }
    if (
      value.kind === "image" &&
      onlyKeys(value, new Set(["application", "version", "token", "kind"]))
    )
      return { application, version: 1, token: value.token, kind: "image" };
    return null;
  } catch {
    return null;
  }
}

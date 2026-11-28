import type { ChartSettings, DrawingTool } from "./types.js";

export type DrawingTarget = "drawings" | "indicators" | "all";
export type DrawingCursor = "crosshair" | "dot" | "arrow" | "demonstration" | "eraser";
export type MagnetMode = "off" | "weak" | "strong";
export interface DrawingToolbarSettings {
  cursor?: DrawingCursor;
  magnet?: MagnetMode;
  magnetStrength?: "weak" | "strong";
  snapIndicators?: boolean;
  stayInDrawingMode?: boolean;
  drawingsHidden?: boolean;
  indicatorsHidden?: boolean;
  drawingsLocked?: boolean;
  indicatorsLocked?: boolean;
  hideTarget?: DrawingTarget;
  lockTarget?: DrawingTarget;
  deleteLocked?: boolean;
  lastTools?: Record<string, string>;
  favorites?: string[];
}
export type ResolvedDrawingToolbar = Required<DrawingToolbarSettings>;
export function drawingToolbarSettings(settings: ChartSettings): ResolvedDrawingToolbar {
  return {
    cursor: "crosshair",
    magnet: "off",
    magnetStrength: "weak",
    snapIndicators: false,
    stayInDrawingMode: false,
    drawingsHidden: false,
    indicatorsHidden: false,
    drawingsLocked: false,
    indicatorsLocked: false,
    hideTarget: "all",
    lockTarget: "all",
    deleteLocked: false,
    lastTools: {},
    favorites: [],
    ...settings.drawingTools
  };
}
const cursors = ["crosshair", "dot", "arrow", "demonstration", "eraser"];
const targets = ["drawings", "indicators", "all"];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9_-]{1,100}$/.test(value) &&
  !["__proto__", "constructor", "prototype"].includes(value);
export function isDrawingToolbarSettings(value: unknown): value is DrawingToolbarSettings {
  if (!isRecord(value)) return false;
  for (const [key, item] of Object.entries(value)) {
    if (key === "cursor") {
      if (typeof item !== "string" || !cursors.includes(item)) return false;
    } else if (key === "magnet") {
      if (typeof item !== "string" || !["off", "weak", "strong"].includes(item)) return false;
    } else if (key === "magnetStrength") {
      if (typeof item !== "string" || !["weak", "strong"].includes(item)) return false;
    } else if (key === "hideTarget" || key === "lockTarget") {
      if (typeof item !== "string" || !targets.includes(item)) return false;
    } else if (key === "lastTools") {
      if (
        !isRecord(item) ||
        Object.keys(item).length > 12 ||
        !Object.entries(item).every(([group, tool]) => identifier(group) && identifier(tool))
      )
        return false;
    } else if (key === "favorites") {
      if (!Array.isArray(item) || item.length > 100 || !item.every(identifier)) return false;
    } else if (
      [
        "snapIndicators",
        "stayInDrawingMode",
        "drawingsHidden",
        "indicatorsHidden",
        "drawingsLocked",
        "indicatorsLocked",
        "deleteLocked"
      ].includes(key)
    ) {
      if (typeof item !== "boolean") return false;
    } else return false;
  }
  return true;
}
export const TOOL_GROUP: Partial<Record<DrawingTool, string>> = {
  text: "annotation",
  note: "annotation",
  priceNote: "annotation",
  pin: "annotation",
  table: "annotation",
  callout: "annotation",
  comment: "annotation",
  priceLabel: "annotation",
  signpost: "annotation",
  flag: "annotation",
  segment: "lines",
  rayLine: "lines",
  straightLine: "lines",
  horizontalStraightLine: "lines",
  horizontalRayLine: "lines",
  verticalStraightLine: "lines",
  rectangle: "shapes",
  brush: "shapes",
  highlighter: "shapes",
  arrowPointer: "shapes",
  arrow: "shapes",
  arrowUp: "shapes",
  arrowDown: "shapes",
  rotatedRectangle: "shapes",
  path: "shapes",
  circle: "shapes",
  ellipse: "shapes",
  polyline: "shapes",
  triangle: "shapes",
  arc: "shapes",
  quadraticCurve: "shapes",
  cubicCurve: "shapes",
  fibonacciLine: "fib",
  fibonacciExtension: "fib"
};

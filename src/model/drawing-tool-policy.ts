import type { DrawingTool } from "./types.js";

export const MAX_DRAWING_POINTS = 2048;
export const GEOMETRIC_TOOLS = [
  "brush",
  "highlighter",
  "arrowPointer",
  "arrow",
  "arrowUp",
  "arrowDown",
  "rotatedRectangle",
  "path",
  "circle",
  "ellipse",
  "polyline",
  "triangle",
  "arc",
  "quadraticCurve",
  "cubicCurve"
] as const satisfies readonly DrawingTool[];

export function isGeometricTool(tool: DrawingTool): boolean {
  return (GEOMETRIC_TOOLS as readonly string[]).includes(tool);
}
export function isFreehandTool(tool: DrawingTool): boolean {
  return tool === "brush" || tool === "highlighter";
}
export function isVertexTool(tool: DrawingTool): boolean {
  return tool === "path" || tool === "polyline";
}
export function drawingPointCount(tool: DrawingTool): number | null {
  if (isFreehandTool(tool) || isVertexTool(tool)) return null;
  if (
    [
      "horizontalStraightLine",
      "horizontalRayLine",
      "verticalStraightLine",
      "arrowUp",
      "arrowDown"
    ].includes(tool)
  )
    return 1;
  if (
    ["rotatedRectangle", "triangle", "arc", "quadraticCurve", "fibonacciExtension"].includes(tool)
  )
    return 3;
  return tool === "cubicCurve" ? 4 : 2;
}
export function validDrawingPointCount(tool: DrawingTool, count: number): boolean {
  const required = drawingPointCount(tool);
  return required === null ? count >= 2 && count <= MAX_DRAWING_POINTS : count === required;
}
export function drawingSupportsFill(tool: DrawingTool): boolean {
  return [
    "rectangle",
    "rotatedRectangle",
    "circle",
    "ellipse",
    "triangle",
    "arc",
    "polyline",
    "arrowPointer",
    "arrowUp",
    "arrowDown"
  ].includes(tool);
}
export function drawingHandleIndices(tool: DrawingTool, count: number): number[] {
  if (isFreehandTool(tool)) return count > 1 ? [0, count - 1] : count ? [0] : [];
  return Array.from({ length: count }, (_, index) => index);
}

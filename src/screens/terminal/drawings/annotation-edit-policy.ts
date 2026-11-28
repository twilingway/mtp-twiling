import { isAnnotationTool } from "../../../model/drawing-annotation.js";
import type { DrawingTool } from "../../../model/types.js";

export function annotationSupportsCustomText(tool: DrawingTool): boolean {
  return isAnnotationTool(tool) && !["table", "flag", "priceLabel"].includes(tool);
}

export function annotationUsesInlineEditor(tool: DrawingTool): boolean {
  return annotationSupportsCustomText(tool) && tool !== "priceNote";
}

export function annotationNeedsCreationEditor(tool: DrawingTool): boolean {
  return tool === "table" || annotationUsesInlineEditor(tool);
}

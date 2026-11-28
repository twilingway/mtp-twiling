import { annotationFontCss, deterministicMeasureText } from "./drawing-annotation-layout.js";
import type { AnnotationFont } from "./drawing-annotation-layout.js";

let context: CanvasRenderingContext2D | null | undefined;

// A shared CSS-pixel measurement source keeps painting and pointer bounds identical.
export function annotationMeasureText(text: string, font: AnnotationFont): number {
  if (context === undefined && typeof document !== "undefined")
    context = document.createElement("canvas").getContext("2d");
  if (!context) return deterministicMeasureText(text, font);
  context.font = annotationFontCss(font);
  return context.measureText(text).width;
}

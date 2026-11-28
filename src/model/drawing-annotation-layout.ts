import { annotationTableDimensions, isAnnotationTool } from "./drawing-annotation.js";
import { annotationOutline } from "./drawing-annotation-outline.js";
import type { AnnotationTool, DrawingDraft, PixelPoint } from "./types.js";

export interface AnnotationBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface AnnotationFont {
  size: number;
  bold: boolean;
  italic: boolean;
}
export type AnnotationMeasure = (text: string, font: AnnotationFont) => number;
export interface AnnotationTextLine {
  x: number;
  y: number;
  text: string;
  align: "left" | "center" | "right";
  maxWidth: number;
}
export interface AnnotationCell {
  bounds: AnnotationBounds;
  row: number;
  column: number;
  text: AnnotationTextLine[];
}
export interface AnnotationLayout {
  kind: AnnotationTool;
  bounds: AnnotationBounds;
  body: AnnotationBounds | null;
  marker: AnnotationBounds | null;
  leader: [PixelPoint, PixelPoint] | null;
  text: AnnotationTextLine[];
  cells: AnnotationCell[];
  font: AnnotationFont;
  background: boolean;
  anchor: PixelPoint;
  outline: PixelPoint[] | null;
  price: { bounds: AnnotationBounds; text: AnnotationTextLine[]; font: AnnotationFont } | null;
  handles: { index: number; point: PixelPoint }[];
}
export interface AnnotationLayoutOptions {
  selected?: boolean;
  hovered?: boolean;
  measureText?: AnnotationMeasure;
  formatPrice?: (value: number) => string;
}
export interface AnnotationHitOptions extends Omit<AnnotationLayoutOptions, "selected"> {
  selectedId?: string | null;
  hoveredId?: string | null;
}
export const deterministicMeasureText: AnnotationMeasure = (text, font) =>
  Array.from(text).length * font.size * 0.6;
export const annotationFontCss = (font: AnnotationFont): string =>
  `${font.italic ? "italic " : ""}${font.bold ? "bold " : ""}${font.size}px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif`;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const rect = (x: number, y: number, width: number, height: number): AnnotationBounds => ({
  left: x,
  top: y,
  right: x + width,
  bottom: y + height
});
export function annotationContains(bounds: AnnotationBounds, point: PixelPoint): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}
function combined(bounds: AnnotationBounds[]): AnnotationBounds {
  return {
    left: Math.min(...bounds.map((b) => b.left)),
    top: Math.min(...bounds.map((b) => b.top)),
    right: Math.max(...bounds.map((b) => b.right)),
    bottom: Math.max(...bounds.map((b) => b.bottom))
  };
}
function wrapLines(
  text: string,
  width: number,
  font: AnnotationFont,
  measure: AnnotationMeasure,
  wrap: boolean
): string[] {
  const output: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!wrap || measure(paragraph, font) <= width + 0.01) {
      output.push(paragraph);
      continue;
    }
    let line = "";
    for (const character of paragraph) {
      if (line && measure(line + character, font) > width + 0.01) {
        output.push(line);
        line = "";
      }
      line += character;
    }
    output.push(line);
  }
  return output;
}
function textLines(
  value: string,
  bounds: AnnotationBounds,
  font: AnnotationFont,
  measure: AnnotationMeasure,
  align: "left" | "center" | "right",
  vertical: "top" | "center" | "bottom",
  wrap: boolean
): AnnotationTextLine[] {
  const padding = 6,
    width = Math.max(1, bounds.right - bounds.left - padding * 2);
  const lineHeight = font.size * 1.3;
  const lines = wrapLines(value, width, font, measure, wrap);
  const available = Math.max(0, bounds.bottom - bounds.top - padding * 2);
  const visible = lines.slice(0, Math.max(1, Math.floor((available + 0.01) / lineHeight)));
  const textHeight = visible.length * lineHeight;
  const top =
    bounds.top +
    padding +
    (vertical === "center"
      ? Math.max(0, (available - textHeight) / 2)
      : vertical === "bottom"
        ? Math.max(0, available - textHeight)
        : 0);
  const x =
    align === "center"
      ? (bounds.left + bounds.right) / 2
      : align === "right"
        ? bounds.right - padding
        : bounds.left + padding;
  return visible.map((text, index) => ({
    text,
    x,
    y: top + index * lineHeight,
    align,
    maxWidth: width
  }));
}

/** Pure shared geometry. Browser painting and picking inject the same font measurement provider. */
export function annotationLayout(
  drawing: DrawingDraft,
  projected: readonly PixelPoint[],
  width: number,
  height: number,
  options: AnnotationLayoutOptions = {}
): AnnotationLayout | null {
  if (!isAnnotationTool(drawing.name) || width <= 0 || height <= 0) return null;
  const style = drawing.settings ?? {},
    settings = style.annotation ?? {};
  const font: AnnotationFont = {
    size: style.fontSize ?? 14,
    bold: settings.bold ?? false,
    italic: settings.italic ?? false
  };
  const measure = options.measureText ?? deterministicMeasureText;
  const first = projected[0];
  const anchor = settings.screenAnchored
    ? { x: width * (settings.screenX ?? 0.5), y: height * (settings.screenY ?? 0.3) }
    : first;
  if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return null;
  const kind = drawing.name;
  const marker = ["pin", "signpost", "flag"].includes(kind)
    ? kind === "pin"
      ? rect(anchor.x - 11.5, anchor.y - 29, 23, 29)
      : rect(
          anchor.x - 8,
          anchor.y - (kind === "flag" ? 24 : 8),
          kind === "flag" ? 28 : 16,
          kind === "flag" ? 32 : 16
        )
    : null;
  const price = drawing.points[0]?.value;
  const priceText = price === undefined ? "" : (options.formatPrice?.(price) ?? String(price));
  let value = style.textEnabled === false ? "" : (style.text ?? "");
  if (kind === "priceLabel") value = priceText;
  const markerOnly = kind === "flag" || (kind === "pin" && !options.selected && !options.hovered);
  if (markerOnly && marker)
    return {
      kind,
      bounds: marker,
      body: null,
      marker,
      leader: null,
      text: [],
      cells: [],
      font,
      background: false,
      anchor,
      outline: null,
      price: null,
      handles: [{ index: 0, point: anchor }]
    };
  const align = style.textAlign ?? "left",
    vertical = style.textVertical ?? "top";
  const rawWidth = Math.max(24, ...value.split(/\r?\n/).map((line) => measure(line, font) + 12));
  const bodyWidth = clamp(
    settings.width ?? Math.min(settings.wrap === false ? 1600 : 320, rawWidth),
    24,
    1600
  );
  const wrapped = wrapLines(value, bodyWidth - 12, font, measure, settings.wrap !== false);
  const bodyHeight = clamp(
    settings.height ?? Math.max(30, wrapped.length * font.size * 1.3 + 12),
    16,
    1200
  );
  let position = { x: anchor.x + (settings.offsetX ?? 0), y: anchor.y + (settings.offsetY ?? 0) };
  if (["note", "priceNote", "callout"].includes(kind) && projected[1] && !settings.screenAnchored)
    position = { ...projected[1] };
  if (kind === "priceNote") {
    const priceFont = { ...font, size: 12, bold: false };
    const priceWidth = Math.max(36, measure(priceText, priceFont) + 12);
    const priceBounds = rect(position.x - priceWidth / 2, position.y - 14, priceWidth, 28);
    const captionBounds = rect(
      (anchor.x + position.x) / 2 - bodyWidth / 2,
      (anchor.y + position.y) / 2 - bodyHeight - 5,
      bodyWidth,
      bodyHeight
    );
    const caption = value
      ? textLines(value, captionBounds, font, measure, "center", "top", settings.wrap !== false)
      : [];
    return {
      kind,
      bounds: combined([
        priceBounds,
        rect(anchor.x, anchor.y, 0, 0),
        ...caption.map((line) =>
          rect(line.x - line.maxWidth / 2, line.y, line.maxWidth, font.size * 1.3)
        )
      ]),
      body: priceBounds,
      marker: null,
      leader: [anchor, position],
      text: caption,
      cells: [],
      font,
      background: false,
      anchor,
      outline: null,
      price: {
        bounds: priceBounds,
        text: textLines(priceText, priceBounds, priceFont, measure, "center", "center", false),
        font: priceFont
      },
      handles: [
        { index: 0, point: anchor },
        ...(projected[1] ? [{ index: 1, point: position }] : [])
      ]
    };
  }
  if (kind === "callout" || kind === "signpost") {
    position.x -= bodyWidth / 2;
    position.y -= bodyHeight / 2;
  }
  if (kind === "signpost" && settings.offsetY === undefined) position.y -= 60;
  if (kind === "pin" || kind === "comment") {
    position.x -= kind === "pin" ? bodyWidth / 2 : 0;
    position.y -= bodyHeight + (kind === "pin" ? 37 : 10);
  }
  if (kind === "priceLabel") {
    position.x += 10;
    position.y -= bodyHeight + 8;
  }
  if (kind === "text") {
    if (align === "center") position.x -= bodyWidth / 2;
    if (align === "right") position.x -= bodyWidth;
    if (vertical === "center") position.y -= bodyHeight / 2;
    if (vertical === "bottom") position.y -= bodyHeight;
  }
  let body = rect(position.x, position.y, bodyWidth, bodyHeight);
  const cells: AnnotationCell[] = [];
  if (kind === "table") {
    const matrix = settings.table?.cells ?? [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""]
    ];
    const columns = matrix[0]?.length ?? 0;
    if (!matrix.length || !columns) return null;
    const tableSize = annotationTableDimensions(settings, { width, height });
    const { columnWidths, rowHeights } = tableSize;
    if (settings.screenAnchored) {
      anchor.x = Math.max(0, width - tableSize.width) * (settings.screenX ?? 0.5);
      anchor.y = Math.max(0, height - tableSize.height) * (settings.screenY ?? 0.3);
      position = { ...anchor };
    }
    body = rect(position.x, position.y, tableSize.width, tableSize.height);
    let y = body.top;
    matrix.forEach((row, rowIndex) => {
      let x = body.left;
      row.forEach((cell, column) => {
        const bounds = rect(x, y, columnWidths[column]!, rowHeights[rowIndex]!);
        cells.push({
          bounds,
          row: rowIndex,
          column,
          text: textLines(cell, bounds, font, measure, align, vertical, settings.wrap !== false)
        });
        x = bounds.right;
      });
      y += rowHeights[rowIndex]!;
    });
  }
  const leader: [PixelPoint, PixelPoint] | null = [
    "note",
    "priceNote",
    "callout",
    "signpost"
  ].includes(kind)
    ? [
        anchor,
        { x: clamp(anchor.x, body.left, body.right), y: clamp(anchor.y, body.top, body.bottom) }
      ]
    : null;
  const bounds = combined([
    body,
    ...(marker ? [marker] : []),
    ...(leader ? [rect(anchor.x, anchor.y, 0, 0)] : [])
  ]);
  const handles = projected.map((point, index) => ({ index, point }));
  if (settings.screenAnchored) handles.splice(0, handles.length, { index: 0, point: anchor });
  if (kind === "table") {
    handles.push({ index: 1, point: { x: body.right, y: body.bottom } });
    for (const cell of cells) {
      if (cell.row === 0 && cell.column < (settings.table?.cells[0]?.length ?? 3) - 1)
        handles.push({
          index: 100 + cell.column,
          point: { x: cell.bounds.right, y: (body.top + body.bottom) / 2 }
        });
      if (cell.column === 0 && cell.row < (settings.table?.cells.length ?? 3) - 1)
        handles.push({
          index: 200 + cell.row,
          point: { x: (body.left + body.right) / 2, y: cell.bounds.bottom }
        });
    }
  }
  if (kind === "signpost")
    handles.push({
      index: 1,
      point: { x: (body.left + body.right) / 2, y: (body.top + body.bottom) / 2 }
    });
  return {
    kind,
    bounds,
    body,
    marker,
    leader,
    cells,
    font,
    anchor,
    handles,
    outline: ["callout", "priceLabel", "comment"].includes(kind)
      ? annotationOutline(body, anchor)
      : null,
    price: null,
    background: kind !== "text",
    text:
      kind === "table"
        ? []
        : textLines(value, body, font, measure, align, vertical, settings.wrap !== false)
  };
}

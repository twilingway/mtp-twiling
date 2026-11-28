import type {
  AnnotationTool,
  DrawingAnnotationSettings,
  DrawingAnnotationTable,
  DrawingSettings,
  DrawingTool
} from "./types.js";

export const ANNOTATION_TOOLS = [
  "text",
  "note",
  "priceNote",
  "pin",
  "table",
  "callout",
  "comment",
  "priceLabel",
  "signpost",
  "flag"
] as const satisfies readonly AnnotationTool[];
export const ANNOTATION_LIMITS = {
  text: 10000,
  rows: 20,
  columns: 20,
  cell: 2000,
  tableText: 20000,
  minWidth: 24,
  maxWidth: 1600,
  minHeight: 16,
  maxHeight: 1200,
  offset: 4000
} as const;

export function isAnnotationTool(tool: string): tool is AnnotationTool {
  return (ANNOTATION_TOOLS as readonly string[]).includes(tool);
}

/** Defaults belong to a newly created object; existing drawings are never migrated in place. */
export function annotationDefaults(tool: DrawingTool): DrawingSettings {
  if (!isAnnotationTool(tool)) return {};
  const whiteBox = tool === "note" || tool === "pin" || tool === "table" || tool === "signpost";
  const cyan = tool === "callout";
  return {
    text: ["flag", "priceLabel", "priceNote", "table"].includes(tool) ? "" : "Текст",
    fontSize: tool === "comment" ? 16 : tool === "signpost" ? 12 : 14,
    color: cyan ? "#0097a7" : "#2962ff",
    textColor: whiteBox
      ? "#0f0f0f"
      : tool === "text" || tool === "priceNote"
        ? "#2962ff"
        : "#ffffff",
    textAlign: tool === "signpost" ? "center" : "left",
    textVertical: "top",
    annotation: {
      bold: tool === "priceLabel",
      italic: false,
      backgroundColor: whiteBox ? "#ffffff" : cyan ? "#0097a7" : "#2962ff",
      backgroundOpacity: tool === "text" ? 0 : cyan ? 0.7 : 1,
      borderColor:
        tool === "table" ? "#dbdbdb" : whiteBox ? "#ebebeb" : cyan ? "#0097a7" : "#2962ff",
      borderOpacity: 1,
      borderWidth: tool === "text" || tool === "note" || tool === "pin" ? 0 : cyan ? 2 : 1,
      borderStyle: "solid",
      wrap: tool !== "text" && tool !== "callout",
      ...(tool === "signpost" && { offsetX: 0, offsetY: -60 }),
      ...(tool === "table" && {
        table: {
          cells: [
            ["", "", ""],
            ["", "", ""],
            ["", "", ""]
          ]
        }
      })
    }
  };
}

/** Effective table dimensions bound the entire matrix without dropping rows or columns. */
export function annotationTableDimensions(
  settings: DrawingAnnotationSettings,
  viewport?: { width: number; height: number }
): { width: number; height: number; columnWidths: number[]; rowHeights: number[] } {
  const table = settings.table;
  const columns = table?.cells[0]?.length ?? 3,
    rows = table?.cells.length ?? 3;
  const widths = table?.columnWidths ?? Array.from({ length: columns }, () => 120);
  const heights = table?.rowHeights ?? Array.from({ length: rows }, () => 34);
  const naturalWidth = widths.reduce((a, b) => a + b, 0),
    naturalHeight = heights.reduce((a, b) => a + b, 0);
  let width = Math.min(1600, settings.width ?? naturalWidth);
  let height = Math.min(1200, settings.height ?? naturalHeight);
  if (settings.screenAnchored && viewport) {
    width = Math.min(width, Math.max(1, viewport.width));
    height = Math.min(height, Math.max(1, viewport.height));
  }
  return {
    width,
    height,
    columnWidths: widths.map((value) => (value * width) / naturalWidth),
    rowHeights: heights.map((value) => (value * height) / naturalHeight)
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function plainKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      typeof key === "string" && allowed.includes(key) && !!descriptor && "value" in descriptor
    );
  });
}
const between = (value: unknown, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

export function isDrawingAnnotationTable(value: unknown): value is DrawingAnnotationTable {
  if (!record(value) || !plainKeys(value, ["cells", "columnWidths", "rowHeights"])) return false;
  const cells = value.cells;
  if (!Array.isArray(cells) || cells.length < 1 || cells.length > ANNOTATION_LIMITS.rows)
    return false;
  const columns: unknown = Array.isArray(cells[0]) ? cells[0].length : 0;
  if (typeof columns !== "number" || columns < 1 || columns > ANNOTATION_LIMITS.columns)
    return false;
  let length = 0;
  for (const row of cells) {
    if (!Array.isArray(row) || row.length !== columns) return false;
    for (const cell of row) {
      if (typeof cell !== "string" || cell.length > ANNOTATION_LIMITS.cell) return false;
      length += cell.length;
    }
  }
  if (length > ANNOTATION_LIMITS.tableText) return false;
  const sizes = (items: unknown, count: number, min: number, max: number) =>
    items === undefined ||
    (Array.isArray(items) &&
      items.length === count &&
      items.every((item: unknown) => between(item, min, max)) &&
      items.reduce((total: number, item: number) => total + item, 0) <= max + 0.000001);
  return (
    sizes(value.columnWidths, columns, 24, 1600) && sizes(value.rowHeights, cells.length, 16, 1200)
  );
}

export function isDrawingAnnotationSettings(value: unknown): value is DrawingAnnotationSettings {
  if (!record(value)) return false;
  const booleanKeys = ["bold", "italic", "wrap", "screenAnchored"];
  const colorKeys = ["backgroundColor", "borderColor"];
  const ranges: Record<string, readonly [number, number]> = {
    backgroundOpacity: [0, 1],
    borderOpacity: [0, 1],
    borderWidth: [0, 5],
    width: [24, 1600],
    height: [16, 1200],
    offsetX: [-4000, 4000],
    offsetY: [-4000, 4000],
    screenX: [0, 1],
    screenY: [0, 1]
  };
  if (
    !plainKeys(value, [
      ...booleanKeys,
      ...colorKeys,
      ...Object.keys(ranges),
      "borderStyle",
      "table"
    ])
  )
    return false;
  return Object.entries(value).every(([key, item]) => {
    if (item === undefined) return true;
    if (booleanKeys.includes(key)) return typeof item === "boolean";
    if (colorKeys.includes(key)) return typeof item === "string" && /^#[0-9a-f]{6}$/i.test(item);
    const range = ranges[key];
    if (range) return between(item, range[0], range[1]);
    if (key === "borderStyle")
      return typeof item === "string" && ["solid", "dashed", "dotted"].includes(item);
    return key === "table" && isDrawingAnnotationTable(item);
  });
}

import { ANNOTATION_LIMITS } from "../../../model/drawing-annotation.js";
import type { DrawingAnnotationTable } from "../../../model/types.js";

export function resizeAnnotationTable(
  table: DrawingAnnotationTable,
  rows: number,
  columns: number
): DrawingAnnotationTable {
  const height = Math.max(1, Math.min(ANNOTATION_LIMITS.rows, rows));
  const width = Math.max(1, Math.min(ANNOTATION_LIMITS.columns, columns));
  return {
    cells: Array.from({ length: height }, (_, row) =>
      Array.from({ length: width }, (_, column) => table.cells[row]?.[column] ?? "")
    ),
    ...(table.columnWidths && {
      columnWidths: Array.from({ length: width }, (_, i) => table.columnWidths?.[i] ?? 120)
    }),
    ...(table.rowHeights && {
      rowHeights: Array.from({ length: height }, (_, i) => table.rowHeights?.[i] ?? 34)
    })
  };
}
export function updateAnnotationCell(
  table: DrawingAnnotationTable,
  row: number,
  column: number,
  text: string
): DrawingAnnotationTable {
  if (!table.cells[row] || table.cells[row]?.[column] === undefined) return table;
  const otherLength =
    table.cells.flat().reduce((sum, value) => sum + value.length, 0) -
    (table.cells[row]?.[column]?.length ?? 0);
  const value = text.slice(
    0,
    Math.min(ANNOTATION_LIMITS.cell, ANNOTATION_LIMITS.tableText - otherLength)
  );
  return {
    ...table,
    cells: table.cells.map((cells, r) =>
      r === row ? cells.map((cell, c) => (c === column ? value : cell)) : cells
    )
  };
}

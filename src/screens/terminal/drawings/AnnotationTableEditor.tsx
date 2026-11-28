import { t } from "../../../i18n/messages.js";
import type { DrawingAnnotationTable } from "../../../model/types.js";
import { resizeAnnotationTable, updateAnnotationCell } from "./annotation-editor-model.js";

export function AnnotationTableEditor({
  table,
  onChange
}: {
  table: DrawingAnnotationTable;
  onChange: (value: DrawingAnnotationTable) => void;
}) {
  const rows = table.cells.length,
    columns = table.cells[0]?.length ?? 1;
  return (
    <div className="annotation-table-editor">
      <div className="annotation-table-actions">
        <button
          type="button"
          disabled={rows >= 20}
          onClick={() => onChange(resizeAnnotationTable(table, rows + 1, columns))}
        >
          {t("＋ Строка")}
        </button>
        <button
          type="button"
          disabled={rows <= 1}
          onClick={() => onChange(resizeAnnotationTable(table, rows - 1, columns))}
        >
          {t("− Строка")}
        </button>
        <button
          type="button"
          disabled={columns >= 20}
          onClick={() => onChange(resizeAnnotationTable(table, rows, columns + 1))}
        >
          {t("＋ Столбец")}
        </button>
        <button
          type="button"
          disabled={columns <= 1}
          onClick={() => onChange(resizeAnnotationTable(table, rows, columns - 1))}
        >
          {t("− Столбец")}
        </button>
      </div>
      <div className="annotation-table-scroll">
        <table>
          <thead>
            <tr>
              <th />
              {table.cells[0]?.map((_, column) => (
                <th key={column}>
                  <input
                    type="number"
                    aria-label={`${t("Ширина столбца")} ${column + 1}`}
                    min={24}
                    max={1600}
                    value={table.columnWidths?.[column] ?? 120}
                    onChange={(event) =>
                      onChange({
                        ...table,
                        columnWidths: Array.from({ length: columns }, (_, i) =>
                          i === column
                            ? Number(event.currentTarget.value)
                            : (table.columnWidths?.[i] ?? 120)
                        )
                      })
                    }
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.cells.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th>
                  <input
                    type="number"
                    aria-label={`${t("Высота строки")} ${rowIndex + 1}`}
                    min={16}
                    max={1200}
                    value={table.rowHeights?.[rowIndex] ?? 34}
                    onChange={(event) =>
                      onChange({
                        ...table,
                        rowHeights: Array.from({ length: rows }, (_, i) =>
                          i === rowIndex
                            ? Number(event.currentTarget.value)
                            : (table.rowHeights?.[i] ?? 34)
                        )
                      })
                    }
                  />
                </th>
                {row.map((cell, column) => (
                  <td key={column}>
                    <textarea
                      aria-label={`${t("Ячейка")} ${rowIndex + 1}:${column + 1}`}
                      maxLength={2000}
                      rows={2}
                      value={cell}
                      onChange={(event) =>
                        onChange(
                          updateAnnotationCell(table, rowIndex, column, event.currentTarget.value)
                        )
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small>
        {rows} × {columns} · {table.cells.flat().reduce((sum, cell) => sum + cell.length, 0)} /
        20000
      </small>
    </div>
  );
}

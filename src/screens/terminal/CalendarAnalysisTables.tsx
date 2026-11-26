import { useMemo } from "react";
import type { ReactNode } from "react";
import { intlLocale } from "../../i18n/preferences.js";
import type { Locale } from "../../i18n/preferences.js";
import { lineColor } from "../../model/candle-palette.js";
import { calendarList } from "../../model/technical-indicators/catalog-expansion/calendar-analysis-data.js";
import { seasonalChanges } from "../../model/technical-indicators/ta-batch-sessions-seasonality.js";
import type { SeasonalityCell } from "../../model/technical-indicators/ta-batch-sessions-seasonality.js";
import type { CalendarTableModel, PerformanceTableRow } from "./use-calendar-analysis.js";

type PerformanceModel = Extract<CalendarTableModel, { kind: "performance" }>;
type SeasonalityModel = Extract<CalendarTableModel, { kind: "seasonality" }>;
const positions = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
const tr = (locale: Locale, ru: string, en: string) => (locale === "en" ? en : ru);

function stateText(locale: Locale, state: PerformanceTableRow["status"]): string | undefined {
  switch (state) {
    case "loading":
      return tr(locale, "Загружается история", "Loading history");
    case "error":
      return tr(locale, "Не удалось загрузить историю", "History request failed");
    case "empty":
      return tr(locale, "Доступных свечей нет", "No candles available");
    case "unsupported":
      return tr(locale, "Часовой пояс рынка неизвестен", "Exchange time zone unavailable");
    case "unknown":
      return tr(locale, "Добавьте инструмент в котировки", "Add this instrument to the watchlist");
    case "ambiguous":
      return tr(locale, "Уточните источник в тикере", "Specify the source in the symbol");
    default:
      return undefined;
  }
}

function percentFormat(locale: Locale, signed: boolean) {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: signed ? "exceptZero" : "auto"
  });
}

function percent(format: Intl.NumberFormat, value: number | null | undefined): string {
  return value == null ? "—" : format.format(value / 100);
}

function heat(table: CalendarTableModel, value: number | null | undefined): string | undefined {
  if (value == null || value === 0) return undefined;
  const style = table.styles?.[value > 0 ? "positive" : "negative"];
  if (style?.visible === false) return undefined;
  return lineColor(
    style?.color ?? (value > 0 ? "#29a38c" : "#c94e6d"),
    Math.min(style?.opacity ?? 0.25, 0.36) *
      Math.min(1, Math.abs(value) / table.params.intensityCutoff)
  );
}

function TableShell({
  title,
  locale,
  refresh,
  children
}: {
  title: string;
  locale: Locale;
  refresh?: (() => void) | undefined;
  children: ReactNode;
}) {
  return (
    <details className="calendar-table" open>
      <summary>{title}</summary>
      <div className="calendar-table-scroll" role="region" aria-label={title} tabIndex={0}>
        {children}
      </div>
      {refresh && (
        <button type="button" className="calendar-table-refresh" onClick={refresh}>
          {tr(locale, "Обновить", "Refresh")}
        </button>
      )}
    </details>
  );
}

export function PerformanceTable({
  table,
  locale,
  refresh
}: {
  table: PerformanceModel;
  locale: Locale;
  refresh?: () => void;
}) {
  const format = percentFormat(locale, true);
  const title = tr(locale, "Динамика", "Performance");
  const loading = table.rows.some((row) => row.status === "loading");
  return (
    <TableShell title={title} locale={locale} refresh={refresh}>
      <table aria-label={title}>
        <thead>
          <tr>
            <th scope="col">{tr(locale, "Инструмент", "Instrument")}</th>
            {table.periods.map((period) => (
              <th key={period} scope="col">
                {period}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => {
            const date = new Intl.DateTimeFormat(intlLocale(locale), {
              dateStyle: "medium",
              ...(row.timeZone && { timeZone: row.timeZone })
            });
            const body = new Map(row.cells.map((cell) => [cell.timeframe, cell]));
            const note = stateText(locale, row.status);
            return (
              <tr key={`${row.label}-${index}`}>
                <th scope="row">
                  {row.label}
                  {note && <small className="calendar-row-note">{note}</small>}
                </th>
                {table.periods.map((period) => {
                  const cell = body.get(period);
                  const anchor =
                    cell?.anchorTimestamp != null ? date.format(cell.anchorTimestamp) : undefined;
                  const label =
                    anchor && `${tr(locale, "Базовая свеча", "Anchor candle")} · ${anchor}`;
                  return (
                    <td
                      key={period}
                      title={label}
                      style={{ backgroundColor: heat(table, cell?.percent) }}
                    >
                      {percent(format, cell?.percent)}
                      {label && <span className="calendar-sr-only"> · {label}</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {loading && <p role="status">{stateText(locale, "loading")}</p>}
      {!table.rows.length && (
        <p>{tr(locale, "Выберите инструмент для сравнения", "Select an instrument to compare")}</p>
      )}
    </TableShell>
  );
}

function yearRows(cells: readonly SeasonalityCell[]) {
  const groups = new Map<number, Map<number, SeasonalityCell>>();
  for (const cell of cells) {
    const year = groups.get(cell.year) ?? new Map<number, SeasonalityCell>();
    year.set(cell.month, cell);
    groups.set(cell.year, year);
  }
  return [...groups].sort(([left], [right]) => right - left);
}

export function SeasonalityTable({
  table,
  locale,
  refresh
}: {
  table: SeasonalityModel;
  locale: Locale;
  refresh?: () => void;
}) {
  const title = `${tr(locale, "Сезонный анализ", "Seasonality")}${table.symbol ? ` · ${table.symbol}` : ""}`;
  const { history, params } = table;
  const { cells, statistics } = useMemo(
    () =>
      seasonalChanges(history?.months ?? [], {
        startYear: params.startYear,
        ignoredMonths: calendarList(params.ignoredMonths)
      }),
    [history, params.startYear, params.ignoredMonths]
  );
  const format = percentFormat(locale, true);
  const neutral = percentFormat(locale, false);
  const monthFormat = new Intl.DateTimeFormat(intlLocale(locale), {
    month: "short",
    timeZone: "UTC"
  });
  const months = Array.from({ length: 12 }, (_, i) => ({
    index: i + 1,
    label: monthFormat.format(Date.UTC(2020, i, 1))
  }));
  const years = yearRows(cells);
  const projection = params.showProjections ? cells.at(-1)?.projection : undefined;
  const current = cells.at(-1);
  const formatPrice = new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 6 });
  const summary = [
    ...(params.showAverages
      ? [{ title: tr(locale, "Среднее", "Average"), key: "average" as const }]
      : []),
    ...(params.showDeviation
      ? [
          {
            title: tr(locale, "Ст. отклонение", "Std. deviation"),
            key: "standardDeviation" as const
          }
        ]
      : []),
    ...(params.showPercentPositive
      ? [{ title: tr(locale, "Доля роста", "Positive share"), key: "percentPositive" as const }]
      : [])
  ];
  const note = stateText(locale, table.status);
  return (
    <TableShell title={title} locale={locale} refresh={refresh}>
      {note && <p role={table.status === "loading" ? "status" : undefined}>{note}</p>}
      {table.status === "ready" && !years.length && (
        <p>{tr(locale, "Нет свечей за выбранные годы", "No candles for the selected years")}</p>
      )}
      {years.length > 0 && (
        <table aria-label={title}>
          <thead>
            <tr>
              <th scope="col">{tr(locale, "Год", "Year")}</th>
              {months.map(({ index, label }) => (
                <th key={index} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map(([year, data]) => (
              <tr key={year}>
                <th scope="row">{year}</th>
                {months.map(({ index }) => {
                  const cell = data.get(index);
                  const progress =
                    cell && !cell.complete
                      ? tr(locale, "Месяц ещё не закрыт", "Month still open")
                      : undefined;
                  return (
                    <td
                      key={index}
                      style={{ backgroundColor: heat(table, cell?.changePercent) }}
                      title={progress}
                    >
                      {percent(format, cell?.changePercent)}
                      {progress && (
                        <>
                          <sup aria-hidden="true">*</sup>
                          <span className="calendar-sr-only"> · {progress}</span>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {summary.length > 0 && (
            <tfoot>
              {summary.map(({ title: label, key }) => (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  {statistics.map((stat, index) => (
                    <td
                      key={index}
                      title={`${tr(locale, "Наблюдений", "Samples")} · ${stat.count}`}
                    >
                      {percent(key === "average" ? format : neutral, stat[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      )}
      {current && !current.complete && (
        <p>{tr(locale, "* Месяц ещё не закрыт", "* Month still open")}</p>
      )}
      {projection && projection.expectedClose !== null && (
        <p>
          {tr(locale, "Расчётное закрытие", "Projected close")}{" "}
          {formatPrice.format(projection.expectedClose)} ·{" "}
          {percent(format, projection.historical.average)} · {tr(locale, "наблюдений", "samples")}{" "}
          {projection.historical.count}
        </p>
      )}
    </TableShell>
  );
}

export function CalendarAnalysisTables({
  tables,
  locale = "ru",
  refresh
}: {
  tables: readonly CalendarTableModel[];
  locale?: Locale;
  refresh?: () => void;
}) {
  if (!tables.length) return null;
  const actions = refresh ? { refresh } : {};
  return (
    <div className="calendar-analysis-overlays">
      {positions.map((position) => {
        const group = tables.filter(({ params }) => params.tablePosition === position);
        return group.length ? (
          <div
            key={position}
            className="calendar-analysis-position"
            data-position={position}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            {group.map((table) =>
              table.kind === "performance" ? (
                <PerformanceTable key={table.id} table={table} locale={locale} {...actions} />
              ) : (
                <SeasonalityTable key={table.id} table={table} locale={locale} {...actions} />
              )
            )}
          </div>
        ) : null;
      })}
    </div>
  );
}

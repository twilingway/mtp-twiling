import { useCallback, useEffect, useMemo, useState } from "react";
import { technicalCalculationContext } from "../../charts/technical-calculation-context.js";
import type { OutputStyle } from "../../model/technical-indicators/types.js";
import type { MarketRow } from "../../model/types.js";
import {
  applyLatestPerformanceTrade,
  calendarList,
  coveredDailyRange,
  coveredMonthlyRange,
  dailyPerformanceDataset,
  normalizeSeasonalityHistory,
  performancePeriodDays,
  performanceTargets
} from "../../model/technical-indicators/catalog-expansion/calendar-analysis-data.js";
import type {
  CalendarHistoryLoader,
  CalendarHistorySource,
  DailyPerformanceDataset,
  SeasonalityHistory
} from "../../model/technical-indicators/catalog-expansion/calendar-analysis-data.js";
import type {
  PerformanceStudyParameters,
  SeasonalityStudyParameters
} from "../../model/technical-indicators/catalog-expansion/calendar-analysis.js";
import type { PerformanceCell } from "../../model/technical-indicators/ta-batch-sessions-performance.js";

export interface CalendarStudyInstance {
  id: string;
  definitionId: string;
  params: object;
  visible: boolean;
  styles?: Readonly<Record<string, OutputStyle>>;
}

type CalendarStatus = "loading" | "ready" | "empty" | "error" | "unsupported";
export interface PerformanceTableRow {
  label: string;
  status: CalendarStatus | "unknown" | "ambiguous";
  timeZone?: string;
  cells: readonly PerformanceCell[];
}

interface TableRef {
  id: string;
  styles?: Readonly<Record<string, OutputStyle>>;
}

export type CalendarTableModel = TableRef &
  (
    | {
        kind: "performance";
        params: PerformanceStudyParameters;
        periods: readonly string[];
        rows: readonly PerformanceTableRow[];
      }
    | {
        kind: "seasonality";
        params: SeasonalityStudyParameters;
        symbol: string;
        status: CalendarStatus;
        history: SeasonalityHistory | undefined;
      }
  );

interface UseCalendarAnalysisOptions {
  ownerKey: unknown;
  row: MarketRow | undefined;
  rows: readonly MarketRow[];
  instances?: readonly CalendarStudyInstance[] | undefined;
  hidden?: boolean;
  loadCandles?: CalendarHistoryLoader | undefined;
}

type Request = CalendarHistorySource & { timeZone: string } & (
    { timeframe: "1d"; periods: readonly string[] } | { timeframe: "1M"; startYear: number }
  );
type Observed =
  | { status: "error" }
  | { status: "ready"; daily: DailyPerformanceDataset }
  | { status: "ready"; monthly: SeasonalityHistory };
interface Snapshot {
  owner: unknown;
  key: string;
  values: ReadonlyMap<string, Observed>;
}

const requestKey = (timeframe: Request["timeframe"], uid: string) => `${timeframe}\0${uid}`;
const zoneFor = (row: MarketRow | undefined) =>
  technicalCalculationContext("1d", row).exchangeTimeZone;

function plans(
  instances: readonly CalendarStudyInstance[],
  row: MarketRow | undefined,
  rows: readonly MarketRow[]
) {
  const daily = new Map<string, { symbol: string; timeZone: string; periods: Set<string> }>();
  let startYear: number | undefined;
  for (const item of instances) {
    if (item.definitionId === "performance") {
      const { includeChartSymbol, comparisonSymbols, comparisonPeriods } =
        item.params as PerformanceStudyParameters;
      const periods = calendarList(comparisonPeriods.toUpperCase());
      for (const target of performanceTargets(includeChartSymbol, comparisonSymbols, row, rows)) {
        if (!("row" in target)) continue;
        const { uid, symbol } = target.row;
        const timeZone = zoneFor(target.row);
        if (!timeZone) continue;
        const previous = daily.get(uid);
        if (previous) periods.forEach((period) => previous.periods.add(period));
        else daily.set(uid, { symbol, timeZone, periods: new Set(periods) });
      }
    } else if (item.definitionId === "seasonality") {
      const year = (item.params as SeasonalityStudyParameters).startYear;
      startYear = Math.min(startYear ?? year, year);
    }
  }
  const requests: Request[] = [...daily].map(([uid, { symbol, periods, timeZone }]) => ({
    uid,
    symbol,
    timeZone,
    timeframe: "1d",
    periods: [...periods].sort()
  }));
  const zone = zoneFor(row);
  if (startYear !== undefined && row?.uid && zone)
    requests.push({ timeframe: "1M", uid: row.uid, symbol: row.symbol, timeZone: zone, startYear });
  return requests.sort((a, b) =>
    requestKey(a.timeframe, a.uid).localeCompare(requestKey(b.timeframe, b.uid))
  );
}

async function readHistory(
  requests: readonly Request[],
  loader: CalendarHistoryLoader,
  signal: AbortSignal,
  publish: (key: string, observed: Observed) => void
): Promise<void> {
  const asOf = Date.now();
  let next = 0;
  const worker = async () => {
    while (!signal.aborted && next < requests.length) {
      const task = requests[next++]!;
      const key = requestKey(task.timeframe, task.uid);
      try {
        const range =
          task.timeframe === "1M"
            ? coveredMonthlyRange(asOf, task.startYear)
            : coveredDailyRange(
                asOf,
                Math.max(...task.periods.map((period) => performancePeriodDays(period) ?? 0))
              );
        const bars =
          range.from <= range.to ? await loader(task, task.timeframe, range, signal) : [];
        if (signal.aborted) return;
        publish(
          key,
          task.timeframe === "1M"
            ? { status: "ready", monthly: normalizeSeasonalityHistory(bars, task.timeZone, asOf) }
            : {
                status: "ready",
                daily: dailyPerformanceDataset(task.symbol, task.timeZone, bars, task.periods, asOf)
              }
        );
      } catch {
        if (!signal.aborted) publish(key, { status: "error" });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(requests.length, 3) }, worker));
}

const isCalendar = ({ visible, definitionId }: CalendarStudyInstance) =>
  visible && (definitionId === "seasonality" || definitionId === "performance");

export function useCalendarAnalysis({
  ownerKey,
  row,
  rows,
  instances,
  hidden,
  loadCandles
}: UseCalendarAnalysisOptions) {
  const active = useMemo(
    () => (hidden ? [] : (instances ?? []).filter(isCalendar)),
    [hidden, instances]
  );
  const planKey = JSON.stringify(plans(active, row, rows));
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (ownerKey == null || !loadCandles || planKey === "[]") return;
    const requests = JSON.parse(planKey) as readonly Request[];
    const abort = new AbortController();
    let busy = false;
    const read = async () => {
      if (busy || abort.signal.aborted) return;
      busy = true;
      try {
        await readHistory(requests, loadCandles, abort.signal, (key, observation) => {
          if (abort.signal.aborted) return;
          setSnapshot((previous) => {
            if (abort.signal.aborted) return previous;
            const values = new Map(
              previous?.key === planKey && previous.owner === ownerKey ? previous.values : []
            );
            values.set(key, observation);
            return { key: planKey, owner: ownerKey, values };
          });
        });
      } finally {
        busy = false;
      }
    };
    void read();
    const timer = setInterval(
      () => {
        if (document.visibilityState !== "hidden") void read();
      },
      5 * 60 * 1000
    );
    return () => {
      clearInterval(timer);
      abort.abort();
    };
  }, [loadCandles, ownerKey, planKey, revision]);

  const values =
    snapshot?.key === planKey && snapshot.owner === ownerKey ? snapshot.values : undefined;
  const marketMonth = row?.uid ? values?.get(requestKey("1M", row.uid)) : undefined;
  const seasonalityHistory =
    marketMonth?.status === "ready" && "monthly" in marketMonth ? marketMonth.monthly : undefined;
  const tables = active.map((item): CalendarTableModel => {
    const id = item.id;
    const style = item.styles ? { styles: item.styles } : {};
    if (item.definitionId === "seasonality") {
      const params = item.params as SeasonalityStudyParameters;
      return {
        id,
        ...style,
        kind: "seasonality",
        params,
        symbol: row?.ticker ?? row?.symbol ?? "",
        history: seasonalityHistory,
        status:
          !row || !zoneFor(row)
            ? "unsupported"
            : marketMonth?.status === "error"
              ? "error"
              : seasonalityHistory
                ? seasonalityHistory.months.length
                  ? "ready"
                  : "empty"
                : "loading"
      };
    }
    const params = item.params as PerformanceStudyParameters;
    const periods = [...new Set(calendarList(params.comparisonPeriods.toUpperCase()))];
    const targets = performanceTargets(
      params.includeChartSymbol,
      params.comparisonSymbols,
      row,
      rows
    );
    const tableRows = targets.map((target): PerformanceTableRow => {
      if ("error" in target) return { label: target.label, status: target.error, cells: [] };
      const market = target.row;
      const timeZone = zoneFor(market);
      if (!timeZone) return { label: target.label, status: "unsupported", cells: [] };
      const observed = values?.get(requestKey("1d", market.uid));
      if (!observed || observed.status === "error" || !("daily" in observed))
        return {
          label: target.label,
          status: observed?.status === "error" ? "error" : "loading",
          timeZone,
          cells: []
        };
      const cells = applyLatestPerformanceTrade(
        observed.daily,
        market.time ? Date.parse(market.time) : NaN,
        market.price
      );
      return {
        label: target.label,
        status: observed.daily.latestDay !== undefined ? "ready" : "empty",
        timeZone,
        cells
      };
    });
    return { id, ...style, kind: "performance", params, periods, rows: tableRows };
  });
  return { tables, seasonalityHistory, refresh };
}

import { useEffect, useEffectEvent, useState } from "react";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { validProviderIdentity } from "../../model/market-provider.js";
import {
  autoKeyLevelPriceRequests,
  type AutoKeyLevelSelection
} from "../../model/technical-indicators/catalog-expansion/auto-key-levels.js";
import {
  priceLevelCalendarPeriod,
  type PriceLevelHistoryRequest,
  type PriceLevelPeriodData,
  type PriceLevelVenue
} from "../../model/technical-indicators/catalog-expansion/level-periods.js";
import {
  priceLevelRequests,
  type PriceLevelStudySelection
} from "../../model/technical-indicators/catalog-expansion/period-studies.js";
import type { MarketRow } from "../../model/types.js";
import { loadCoverage } from "../../services/storage-v2.js";
import {
  loadPriceLevelPeriods,
  type PriceLevelHistorySource
} from "../../services/technical-price-level-history.js";
import type { TerminalController } from "./controller.js";
import { marketAvailable } from "./market-readiness.js";
import type { TerminalState } from "./state.js";

type PriceLevelStatus =
  "hidden" | "unsupported" | "loading" | "ready" | "empty" | "partial" | "error";

export interface ChartPriceLevelHistory {
  readonly status: PriceLevelStatus;
  readonly priceLevelPeriods?: PriceLevelPeriodData;
}

type Session = ReturnType<TerminalController["sessionKey"]>;
type HistoryReadPort = Pick<PriceLevelHistorySource, "loadCandles">;
interface Observation {
  readonly key: string;
  readonly session: Session;
  readonly value: ChartPriceLevelHistory;
}

const refreshMs = 60_000;
const retryMs = 15_000;

function historySession(session: Session): session is NonNullable<Session> & HistoryReadPort {
  return session !== null && "loadCandles" in session && typeof session.loadCandles === "function";
}

function isPeriodSelection(item: { definitionId: string }): boolean {
  return (
    item.definitionId === "pivot-points-standard" ||
    item.definitionId === "multi-time-period-charts"
  );
}

function bucketedRequests(
  requests: readonly PriceLevelHistoryRequest[]
): PriceLevelHistoryRequest[] {
  const byInterval = new Map<PriceLevelHistoryRequest["interval"], PriceLevelHistoryRequest>();
  for (const { interval, from, to, precedingTradingPeriods } of requests) {
    const existing = byInterval.get(interval);
    byInterval.set(interval, {
      interval,
      from: Math.min(existing?.from ?? Infinity, priceLevelCalendarPeriod(from, interval).start),
      to: Math.max(existing?.to ?? -Infinity, priceLevelCalendarPeriod(to, interval).start),
      precedingTradingPeriods: Math.max(
        existing?.precedingTradingPeriods ?? 0,
        precedingTradingPeriods
      )
    });
  }
  return [...byInterval.values()].sort((left, right) =>
    left.interval.localeCompare(right.interval)
  );
}

export function usePriceLevelHistory(
  controller: TerminalController,
  state: TerminalState,
  row: MarketRow | undefined
): ChartPriceLevelHistory {
  const { owner, preferences, chartRevision } = state;
  const { timeframe } = preferences;
  const session = controller.sessionKey();
  const uid = row?.uid;
  const symbol = row?.symbol;
  const venue: PriceLevelVenue = row?.providerRef?.provider ?? "tbank";
  const studySelections =
    preferences.technicalIndicators?.filter(
      (item): item is typeof item & PriceLevelStudySelection =>
        isPeriodSelection(item) && item.visible
    ) ?? [];
  const keyLevelSelections =
    preferences.technicalIndicators?.filter(
      (item): item is typeof item & AutoKeyLevelSelection =>
        item.definitionId === "auto-key-levels" && item.visible
    ) ?? [];
  const wanted =
    studySelections.length + keyLevelSelections.length > 0 &&
    !drawingToolbarSettings(preferences.chartSettings).indicatorsHidden;
  const supported = !!(
    row &&
    uid &&
    symbol &&
    validProviderIdentity(row) &&
    historySession(session)
  );
  const enabled =
    wanted &&
    supported &&
    marketAvailable(state) &&
    !state.profileTransition &&
    !state.importingBackup &&
    !state.importRecoveryRequired &&
    state.historyViewReady !== false;
  const first = state.candles[0]?.timestamp;
  const last = state.candles.at(-1)?.timestamp;
  const hasChart = first !== undefined && last !== undefined;
  const requests =
    wanted && hasChart
      ? bucketedRequests([
          ...priceLevelRequests(studySelections, timeframe, [first, last]),
          ...autoKeyLevelPriceRequests(keyLevelSelections, timeframe, last)
        ])
      : [];
  const key = JSON.stringify([owner, uid, symbol, venue, timeframe, chartRevision, requests]);
  const readPlan = useEffectEvent(() => (enabled ? { key, requests } : undefined));
  const [observation, setObservation] = useState<Observation | null>(null);

  useEffect(() => {
    if (!enabled || !uid || !symbol || !historySession(session)) return;
    const plan = readPlan()?.requests ?? [];
    if (!plan.length) return;
    const until = Math.max(
      ...plan.map(({ interval, to }) => priceLevelCalendarPeriod(to, interval).end)
    );
    const abort = new AbortController();
    const loadCandles = session.loadCandles.bind(session);
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let accumulated: PriceLevelPeriodData = {};

    const active = () => {
      if (abort.signal.aborted || controller.sessionKey() !== session || readPlan()?.key !== key)
        return false;
      const current = controller.getSnapshot();
      if (
        current.owner !== owner ||
        current.preferences.timeframe !== timeframe ||
        current.chartRevision !== chartRevision ||
        current.profileTransition ||
        current.importingBackup ||
        current.importRecoveryRequired ||
        !marketAvailable(current) ||
        current.historyViewReady === false
      )
        return false;
      const currentRow = selectedMarketRow(current.rows, current.preferences);
      return currentRow?.uid === uid && currentRow.symbol === symbol;
    };
    const update = async () => {
      if (!active()) return;
      const results = await Promise.allSettled(
        plan.map((request) =>
          loadPriceLevelPeriods(request, {
            loadCandles,
            uid,
            symbol,
            venue,
            asOf: Date.now(),
            signal: abort.signal,
            ...(venue === "tbank"
              ? { coveredRanges: (interval) => loadCoverage(owner, uid, interval) }
              : {})
          })
        )
      );
      if (!active()) return;
      const data = { ...accumulated };
      let failed = false;
      for (const [index, result] of results.entries()) {
        if (result.status === "fulfilled") data[plan[index]!.interval] = result.value;
        else failed = true;
      }
      accumulated = data;
      const hasData = Object.values(data).some((periods) => periods.length > 0);
      setObservation({
        key,
        session,
        value: {
          status: failed ? (hasData ? "partial" : "error") : hasData ? "ready" : "empty",
          ...(hasData ? { priceLevelPeriods: data } : {})
        }
      });
      if (failed || Date.now() < until)
        retryTimer = setTimeout(() => void update(), failed ? retryMs : refreshMs);
    };
    void update();
    return () => {
      abort.abort();
      clearTimeout(retryTimer);
    };
  }, [chartRevision, controller, enabled, key, owner, session, symbol, timeframe, uid, venue]);

  if (!wanted) return { status: "hidden" };
  if (!supported || (hasChart && !requests.length)) return { status: "unsupported" };
  if (!enabled || !hasChart) return { status: "loading" };
  return observation?.key === key && observation.session === session
    ? observation.value
    : { status: "loading" };
}

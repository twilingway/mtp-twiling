import { useEffect, useRef, useState } from "react";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import type { OpenInterestObservations } from "../../model/technical-indicators/ta-batch-external.js";
import type { HistoryRange, MarketRow } from "../../model/types.js";
import { supportsBybitOpenInterestInterval } from "../../services/providers/bybit/open-interest.js";
import type { TerminalController } from "./controller.js";
import { marketAvailable } from "./market-readiness.js";
import type { TerminalState } from "./state.js";

interface ObservedWindow {
  key: string;
  session: unknown;
  range: HistoryRange;
  observations: OpenInterestObservations | null;
  status: "loading" | "complete" | "error";
}

type OpenInterestStatus = "hidden" | "unsupported" | "loading" | "empty" | "ready" | "error";
export interface ChartOpenInterest {
  observations?: OpenInterestObservations;
  currency?: string;
  status: OpenInterestStatus;
}

function combine(
  prior: OpenInterestObservations | null,
  next: OpenInterestObservations | null
): OpenInterestObservations | null {
  if (!next) return prior;
  if (!prior || prior.instrumentKey !== next.instrumentKey) return next;
  const rows = new Map(prior.rows.map((row) => [row.timestamp, row]));
  for (const row of next.rows) {
    if (row.value !== null || !rows.has(row.timestamp)) rows.set(row.timestamp, row);
  }
  return {
    ...next,
    rows: [...rows.values()].sort((left, right) => left.timestamp - right.timestamp)
  };
}

function missingRanges(previous: HistoryRange | undefined, next: HistoryRange): HistoryRange[] {
  if (!previous || previous.to < next.from || next.to < previous.from) return [next];
  return [
    ...(next.to > previous.to ? [{ from: previous.to, to: next.to }] : []),
    ...(next.from < previous.from ? [{ from: next.from, to: previous.from - 1 }] : [])
  ];
}

export function useOpenInterest(
  controller: TerminalController,
  state: TerminalState,
  row: MarketRow | undefined
): ChartOpenInterest {
  const preferences = state.preferences;
  const timeframe = preferences.timeframe;
  const uid = row?.uid;
  const currency = row?.baseCoin;
  const session = controller.sessionKey();
  const wanted =
    !drawingToolbarSettings(preferences.chartSettings).indicatorsHidden &&
    preferences.technicalIndicators?.some(
      (item) => item.definitionId === "open-interest" && item.visible
    );
  const supported =
    !!uid &&
    !!currency &&
    row.providerRef?.provider === "bybit" &&
    row.providerRef.category === "linear" &&
    supportsBybitOpenInterestInterval(timeframe);
  const enabled =
    wanted &&
    supported &&
    session !== null &&
    marketAvailable(state) &&
    !state.importingBackup &&
    !state.importRecoveryRequired &&
    state.historyViewReady !== false;
  const key = JSON.stringify([state.owner, uid, timeframe, currency]);
  const from = state.candles[0]?.timestamp;
  const to = state.candles.at(-1)?.timestamp;
  const cache = useRef<ObservedWindow | null>(null);
  const [result, setResult] = useState<ObservedWindow | null>(null);

  useEffect(() => {
    if (!enabled || !session || !uid || from === undefined || to === undefined) return;
    const previous =
      cache.current?.key === key && cache.current.session === session ? cache.current : null;
    const ranges = missingRanges(previous?.range, { from, to });
    if (!ranges.length) return;
    const abort = new AbortController();
    const overlapping = previous && previous.range.to >= from && previous.range.from <= to;
    let observations = overlapping ? previous.observations : null;
    let previewed = false;
    const range = {
      from: overlapping ? Math.min(previous.range.from, from) : from,
      to: overlapping ? Math.max(previous.range.to, to) : to
    };
    const publish = (status: ObservedWindow["status"]) => {
      if (abort.signal.aborted || controller.sessionKey() !== session) return;
      const next = { key, range, session, observations, status };
      if (status === "complete") cache.current = next;
      setResult(next);
    };
    const update = async () => {
      for (const needed of ranges) {
        const data = await session.loadOpenInterest(
          uid,
          timeframe,
          needed,
          abort.signal,
          (page) => {
            if (previewed || abort.signal.aborted || observations) return;
            if (!page.rows.some((row) => row.value !== null)) return;
            observations = page;
            previewed = true;
            publish("loading");
          }
        );
        if (abort.signal.aborted) return;
        observations = combine(observations, data);
      }
      publish("complete");
    };
    void update().catch(() => publish("error"));
    return () => abort.abort();
  }, [controller, enabled, from, to, key, session, timeframe, uid]);

  if (!wanted) return { status: "hidden" };
  if (!supported) return { status: "unsupported" };
  if (!enabled || from === undefined || to === undefined) return { status: "loading" };
  const current = result?.key === key && result.session === session ? result : null;
  const observations = current?.observations ?? undefined;
  const active =
    observations &&
    observations.rows.some(
      (item) => item.timestamp >= from && item.timestamp <= to && item.value !== null
    )
      ? observations
      : undefined;
  const status =
    !current || current.range.from > from || current.range.to < to
      ? "loading"
      : current.status === "complete"
        ? active
          ? "ready"
          : "empty"
        : current.status;
  return { status, currency, ...(active ? { observations: active } : {}) };
}

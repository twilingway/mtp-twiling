import { useEffect, useState } from "react";
import { TIMEFRAMES, mergeCandles, updateCandleList } from "../../model/history-codec.js";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { providerRefFromId } from "../../model/market-provider.js";
import type { Candle, MarketRow, Timeframe } from "../../model/types.js";
import type { CorrelationHistory } from "../../model/technical-indicators/catalog-expansion/correlation.js";
import type {
  CorrelationCandleReader,
  CorrelationCandleSeries,
  CorrelationComparisonInstrument
} from "../../services/correlation-history.js";
import {
  loadCorrelationComparison,
  selectCorrelationComparison
} from "../../services/correlation-history.js";
import type { CandleEvent } from "../../services/types.js";
import type { TerminalController } from "./controller.js";
import { marketAvailable } from "./market-readiness.js";
import type { TerminalState } from "./state.js";

type Reader = CorrelationCandleReader & {
  watchCandles?(
    uid: string,
    timeframe: Timeframe,
    accept: (event: CandleEvent) => void,
    signal: AbortSignal
  ): () => void;
};

function canReadHistory(session: object): session is Reader {
  return "loadCandles" in session && typeof session.loadCandles === "function";
}

type Result = {
  key: string;
  session: object;
  history: CorrelationHistory;
  done: boolean;
  failures: number;
};

interface ChartCorrelation {
  status:
    | "hidden"
    | "unsupported"
    | "needs-comparison"
    | "loading"
    | "ready"
    | "partial"
    | "empty"
    | "error";
  history?: CorrelationHistory;
}

export function useCorrelationHistory(
  controller: TerminalController,
  state: TerminalState,
  row: MarketRow | undefined
): ChartCorrelation {
  const { timeframe, chartSettings, technicalIndicators } = state.preferences;
  const primaryUid = row?.uid;
  const session = controller.sessionKey();
  const selected = (technicalIndicators ?? [])
    .filter((item) => item.definitionId === "correlation-coefficient")
    .filter((item) => item.visible);
  const ids = new Set(selected.map(({ params }) => params.comparisonUid).filter(Boolean));
  const wanted = selected.length > 0 && !drawingToolbarSettings(chartSettings).indicatorsHidden;
  const planned = JSON.stringify(
    [...ids].sort().flatMap((uid) => {
      if (providerRefFromId(uid) && (timeframe === "2m" || timeframe === "10m")) return [];
      const target = primaryUid && selectCorrelationComparison(state.rows, uid, primaryUid);
      return target ? [target] : [];
    })
  );
  const scope = JSON.stringify([state.owner, primaryUid, timeframe, planned, state.chartRevision]);
  const from = state.candles[0]?.timestamp;
  const active =
    planned !== "[]" &&
    wanted &&
    marketAvailable(state) &&
    !state.profileTransition &&
    !state.importingBackup &&
    !state.importRecoveryRequired &&
    state.historyViewReady !== false;
  const [result, setResult] = useState<Result>();

  useEffect(() => {
    if (!active || !session || !primaryUid || from === undefined || !canReadHistory(session))
      return;
    const instruments = JSON.parse(planned) as CorrelationComparisonInstrument[];
    const abort = new AbortController();
    const comparisons = new Map<string, CorrelationCandleSeries>();
    const disposeStreams: (() => void)[] = [];
    let done = false;
    let failures = 0;
    const current = () => !abort.signal.aborted && controller.sessionKey() === session;
    const publish = () => {
      if (current())
        setResult({
          key: scope,
          session,
          done,
          failures,
          history: { primaryUid, timeframe, comparisons: new Map(comparisons) }
        });
    };
    const fetchComparison = async (target: (typeof instruments)[number]) => {
      comparisons.set(target.uid, { instrumentUid: target.uid, timeframe, bars: [] });
      let live: Candle[] = [];
      let reading = false;
      const readHistory = async () => {
        if (!current() || reading) return;
        const to = controller.getSnapshot().candles.at(-1)?.timestamp;
        if (to === undefined || to < from) return;
        reading = true;
        try {
          const loaded = await loadCorrelationComparison(
            session,
            target,
            timeframe,
            { from, to },
            abort.signal
          );
          comparisons.set(target.uid, {
            ...loaded,
            bars: mergeCandles(comparisons.get(target.uid)?.bars ?? [], loaded.bars, live)
          });
          publish();
        } finally {
          reading = false;
          live = [];
        }
      };
      const release = session.watchCandles?.(
        target.uid,
        timeframe,
        (event) => {
          if (
            !current() ||
            event.uid !== target.uid ||
            event.interval !== TIMEFRAMES[timeframe].stream ||
            event.bar.timestamp < from
          )
            return;
          if (reading) live = updateCandleList(live, event.bar);
          const existing = comparisons.get(target.uid);
          if (existing) {
            // Both history and live series contain actual provider candles.
            const bars = updateCandleList(existing.bars, event.bar);
            comparisons.set(target.uid, { ...existing, bars });
            publish();
          }
        },
        abort.signal
      );
      if (release) disposeStreams.push(release);
      if (session instanceof EventTarget) {
        const row = controller.getSnapshot().rows.find(({ uid }) => uid === target.uid);
        const ref = row?.providerRef;
        const reconnect = (event: Event) => {
          const source = (event as CustomEvent<MarketRow["providerRef"]>).detail;
          if (!ref || (source?.provider === ref.provider && source.category === ref.category))
            void readHistory().catch(() => {});
        };
        session.addEventListener(ref ? "market-reconnect" : "bank-reconnect", reconnect, {
          signal: abort.signal
        });
      }
      await readHistory();
    };
    const read = async () => {
      for (let offset = 0; current() && offset < instruments.length; offset += 4) {
        const outcomes = await Promise.allSettled(
          instruments.slice(offset, offset + 4).map(fetchComparison)
        );
        failures += outcomes.filter(({ status }) => status === "rejected").length;
      }
      done = true;
      publish();
    };
    void read();
    return () => {
      abort.abort();
      disposeStreams.forEach((release) => release());
    };
  }, [active, controller, session, primaryUid, timeframe, planned, scope, from]);

  if (!wanted) return { status: "hidden" };
  if (!ids.size) return { status: "needs-comparison" };
  if (planned === "[]") return { status: "unsupported" };
  if (!active || result?.key !== scope || result.session !== session) return { status: "loading" };
  const { history, done, failures } = result;
  const available = [...history.comparisons.values()].filter(({ bars }) => bars.length > 0).length;
  if (available > 0) return { status: done && available < ids.size ? "partial" : "ready", history };
  return { status: !done ? "loading" : failures ? "error" : "empty" };
}

import { useEffect, useRef, useState } from "react";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { shiftTimeframe } from "../../model/intervals/calendar.js";
import type { MarketRow } from "../../model/types.js";
import { okxSpotTradeSource } from "../../services/market-spot-trades.js";
import type { TerminalController } from "./controller.js";
import { marketAvailable } from "./market-readiness.js";
import type { TerminalState } from "./state.js";
import type { ChartQuoteTurnover } from "./use-quote-turnover.js";

interface Observation {
  key: string;
  session: ReturnType<TerminalController["sessionKey"]>;
  from: number;
  to: number;
  value: ChartQuoteTurnover;
}

export function useNetVolume(
  controller: TerminalController,
  state: TerminalState,
  row: MarketRow | undefined
): ChartQuoteTurnover {
  const prefs = state.preferences;
  const timeframe = prefs.timeframe;
  const source = okxSpotTradeSource(row);
  const uid = source?.uid;
  const currency = source?.currency;
  const session = controller.sessionKey();
  const wanted =
    !drawingToolbarSettings(prefs.chartSettings).indicatorsHidden &&
    prefs.technicalIndicators?.some(
      ({ definitionId, visible }) => visible && definitionId === "net-volume"
    );
  const enabled =
    wanted &&
    session !== null &&
    marketAvailable(state) &&
    !state.importingBackup &&
    !state.importRecoveryRequired &&
    state.historyViewReady !== false;
  const first = state.candles[0]?.timestamp;
  const last = state.candles.at(-1)?.timestamp;
  const key = JSON.stringify([state.owner, uid, timeframe, currency]);
  const previous = useRef<Observation | null>(null);
  const [current, setCurrent] = useState<Observation | null>(null);

  useEffect(() => {
    if (!enabled || !session || !uid || !currency || first === undefined || last === undefined)
      return;
    const abort = new AbortController();
    const end = shiftTimeframe(last, timeframe, 1);
    const closed = end <= Date.now();
    const to = closed ? end : last;
    const lastClosed = closed ? last : shiftTimeframe(last, timeframe, -1);
    if (first >= to) return;
    const past =
      previous.current?.key === key && previous.current.session === session
        ? previous.current
        : null;
    if (past?.from === first && past.to === to) return;
    const publish = (value: ChartQuoteTurnover) => {
      if (abort.signal.aborted || controller.sessionKey() !== session) return;
      const result = { key, session, from: first, to, value };
      if (value.status !== "error") previous.current = result;
      setCurrent(result);
    };
    void session
      .loadSpotTradeHistory(uid, { from: first, to }, abort.signal)
      .then((netVolumeTrades) => {
        const coverage = netVolumeTrades?.coverage;
        if (
          !netVolumeTrades ||
          !coverage ||
          netVolumeTrades.instrumentKey !== uid ||
          !netVolumeTrades.previous
        )
          return publish({ status: "empty", currency });
        const fullCandle = coverage.from <= lastClosed && coverage.to >= to;
        publish({
          status: fullCandle ? "ready" : "empty",
          currency,
          volumeStudies: { netVolumeTrades }
        });
      })
      .catch(() =>
        publish({
          status: "error",
          currency,
          ...(past?.value.volumeStudies ? { volumeStudies: past.value.volumeStudies } : {})
        })
      );
    return () => abort.abort();
  }, [controller, currency, enabled, first, key, last, session, timeframe, uid]);

  if (!wanted) return { status: "hidden" };
  if (!uid || !currency) return { status: "unsupported" };
  if (!enabled || first === undefined || last === undefined) return { status: "loading", currency };
  return current?.key === key && current.session === session
    ? current.value
    : { status: "loading", currency };
}

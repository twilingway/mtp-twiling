import { useEffect, useRef, useState } from "react";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { autoKeyLevelTradeRange } from "../../model/technical-indicators/catalog-expansion/auto-key-levels.js";
import { mergePriceVolumeHistory } from "../../model/technical-indicators/catalog-expansion/price-volume-history.js";
import type { PriceVolumeTradeHistory } from "../../model/technical-indicators/catalog-expansion/price-volume-history.js";
import type { MarketRow } from "../../model/types.js";
import { okxSpotTradeSource } from "../../services/market-spot-trades.js";
import type { TerminalController } from "./controller.js";
import { marketAvailable } from "./market-readiness.js";
import type { TerminalState } from "./state.js";

type Status = "inactive" | "loading" | "ready" | "partial" | "unavailable";
interface Observation {
  readonly uid: string;
  readonly session: NonNullable<ReturnType<TerminalController["sessionKey"]>>;
  readonly status: Status;
  readonly data?: PriceVolumeTradeHistory;
}
const refreshMs = 60_000;

export function useAutoKeyLevelTrades(
  controller: TerminalController,
  state: TerminalState,
  row: MarketRow | undefined
): { status: Status; data?: PriceVolumeTradeHistory } {
  const { chartSettings, technicalIndicators, timeframe } = state.preferences;
  const session = controller.sessionKey();
  const uid = okxSpotTradeSource(row)?.uid;
  const supported = !!uid && row?.step != null && row.step > 0;
  const last = state.candles.at(-1)?.timestamp;
  const enabled =
    technicalIndicators?.some(
      ({ definitionId, visible }) => definitionId === "auto-key-levels" && visible
    ) &&
    marketAvailable(state) &&
    !drawingToolbarSettings(chartSettings).indicatorsHidden &&
    !state.importingBackup &&
    !state.importRecoveryRequired &&
    state.historyViewReady !== false;
  const cache = useRef<Observation | null>(null);
  const [current, setCurrent] = useState<Observation | null>(null);

  useEffect(() => {
    if (!enabled || !supported || !session || !uid || last === undefined) return;
    const selected = (technicalIndicators ?? []).filter(
      (item) => item.definitionId === "auto-key-levels"
    );
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const live = () => !abort.signal.aborted && controller.sessionKey() === session;
    const previous = () =>
      cache.current?.uid === uid && cache.current.session === session
        ? cache.current.data
        : undefined;
    const publish = (status: Status, data: PriceVolumeTradeHistory | undefined) => {
      if (!live()) return;
      const next = { uid, session, status, ...(data ? { data } : {}) };
      if (data) cache.current = next;
      setCurrent(next);
    };
    const load = async () => {
      const request = autoKeyLevelTradeRange(selected, timeframe, last, Date.now());
      if (!request) return publish("inactive", undefined);
      const existing = previous();
      const from =
        existing?.coverage && existing.coverage.from <= request.from
          ? Math.max(request.from, Math.min(existing.coverage.to - 1, request.to - 1))
          : request.from;
      const fetched = await session.loadSpotTradeHistory(
        uid,
        { from, to: request.to },
        abort.signal
      );
      if (!live()) return;
      if (fetched?.instrumentKey !== uid || !fetched.coverage) {
        publish(existing ? "partial" : "unavailable", existing);
        return;
      }
      const { instrumentKey, coverage, trades } = fetched;
      const data = mergePriceVolumeHistory(existing, { instrumentKey, coverage, trades });
      publish(
        data.coverage && data.coverage.from <= request.from && data.coverage.to >= request.to
          ? "ready"
          : "partial",
        data
      );
    };
    const refresh = async () => {
      try {
        await load();
      } catch {
        if (live()) publish("unavailable", previous());
      } finally {
        if (live()) timer = setTimeout(() => void refresh(), refreshMs);
      }
    };
    void refresh();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [controller, enabled, supported, session, uid, timeframe, last, technicalIndicators]);

  if (!enabled) return { status: "inactive" };
  if (!supported) return { status: "unavailable" };
  if (!current || current.uid !== uid || current.session !== session) return { status: "loading" };
  return { status: current.status, ...(current.data ? { data: current.data } : {}) };
}

import { useEffect, useRef, useState } from "react";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { shiftTimeframe } from "../../model/intervals/calendar.js";
import { isVolumeDeltaStudy } from "../../model/technical-indicators/catalog-expansion/volume-delta.js";
import { intrabarVolumeInterval } from "../../model/technical-indicators/ta-batch-volume-intrabars.js";
import type { IntrabarVolumeHistory } from "../../model/technical-indicators/ta-batch-volume-intrabars.js";
import {
  lowerTurnoverDuration,
  quoteTurnoverWindow
} from "../../model/technical-indicators/ta-batch-volume-flow-turnover.js";
import type { MarketRow } from "../../model/types.js";
import { intrabarVolumeSource } from "../../services/market-intrabar-volume.js";
import type { TerminalController } from "./controller.js";
import { marketAvailable } from "./market-readiness.js";
import type { TerminalState } from "./state.js";
import type { ChartQuoteTurnover } from "./use-quote-turnover.js";

interface Observation {
  key: string;
  session: ReturnType<TerminalController["sessionKey"]>;
  data?: IntrabarVolumeHistory;
  value: ChartQuoteTurnover;
}

const REFRESH_MS = 60_000;

export function useIntrabarVolume(
  controller: TerminalController,
  state: TerminalState,
  row: MarketRow | undefined
): ChartQuoteTurnover {
  const prefs = state.preferences;
  const timeframe = prefs.timeframe;
  const interval = intrabarVolumeInterval(timeframe);
  const source = intrabarVolumeSource(row);
  const uid = source?.uid;
  const currency = source?.currency;
  const session = controller.sessionKey();
  const wanted =
    !drawingToolbarSettings(prefs.chartSettings).indicatorsHidden &&
    prefs.technicalIndicators?.some(
      ({ definitionId, visible }) => visible && isVolumeDeltaStudy(definitionId)
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
  const cache = useRef<Observation | null>(null);
  const [current, setCurrent] = useState<Observation | null>(null);

  useEffect(() => {
    if (
      !enabled ||
      !session ||
      !interval ||
      !uid ||
      !currency ||
      first === undefined ||
      last === undefined
    )
      return;
    const end = shiftTimeframe(last, timeframe, 1);
    const step = lowerTurnoverDuration(interval);
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const active = () => !abort.signal.aborted && controller.sessionKey() === session;
    const latest = () =>
      cache.current?.key === key && cache.current.session === session ? cache.current : null;
    const publish = (status: ChartQuoteTurnover["status"], data?: IntrabarVolumeHistory) => {
      if (!active()) return;
      const value = {
        status,
        currency,
        ...(data ? { volumeStudies: { intrabarVolume: data } } : {})
      };
      const observation = { key, session, value, ...(data ? { data } : {}) };
      if (data && status === "ready") cache.current = observation;
      setCurrent(observation);
    };
    const update = async () => {
      const range = quoteTurnoverWindow(interval, first, Math.min(Date.now(), end - 1));
      if (range.to < range.from) return publish("empty");
      const previous = latest()?.data;
      const overlaps =
        previous && previous.range.from <= range.from && previous.range.to >= range.from;
      const from = overlaps
        ? Math.max(range.from, Math.min(range.to, previous.range.to) - step)
        : range.from;
      const payload = await session.loadIntrabarVolume(
        uid,
        interval,
        { from, to: range.to },
        abort.signal
      );
      if (!active()) return;
      if (!payload || payload.instrumentKey !== uid || payload.currency !== currency)
        return publish("empty");
      const earlier = overlaps
        ? previous.bars.filter(({ timestamp }) => timestamp >= range.from && timestamp < from)
        : [];
      const bars = [...earlier, ...payload.bars];
      publish(bars.length ? "ready" : "empty", { ...payload, range, bars });
    };
    const run = () => {
      void update()
        .catch(() => publish("error", latest()?.data))
        .finally(() => {
          if (active() && Date.now() < end) timer = setTimeout(run, REFRESH_MS);
        });
    };
    run();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [controller, currency, enabled, first, interval, key, last, session, timeframe, uid]);

  if (!wanted) return { status: "hidden" };
  if (!uid || !currency || !interval) return { status: "unsupported" };
  if (!enabled || first === undefined || last === undefined) return { status: "loading", currency };
  return current?.key === key && current.session === session
    ? current.value
    : { status: "loading", currency };
}

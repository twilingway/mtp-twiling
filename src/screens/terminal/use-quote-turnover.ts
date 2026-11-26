import { useEffect, useRef, useState } from "react";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { shiftTimeframe } from "../../model/intervals/calendar.js";
import type { VolumeStudyData } from "../../model/technical-indicators/catalog-expansion/volume.js";
import {
  compileQuoteTurnover,
  lowerTurnoverDuration,
  quoteTurnoverWindow,
  turnoverInterval
} from "../../model/technical-indicators/ta-batch-volume-flow-turnover.js";
import type { QuoteTurnoverHistory } from "../../model/technical-indicators/ta-batch-volume-flow-turnover.js";
import type { MarketRow } from "../../model/types.js";
import { quoteTurnoverSource } from "../../services/market-turnover.js";
import type { TerminalController } from "./controller.js";
import { marketAvailable } from "./market-readiness.js";
import type { TerminalState } from "./state.js";

type TurnoverStatus = "hidden" | "unsupported" | "loading" | "empty" | "ready" | "error";

export interface ChartQuoteTurnover {
  status: TurnoverStatus;
  currency?: string;
  volumeStudies?: VolumeStudyData;
}

interface ObservedTurnover {
  key: string;
  session: unknown;
  history: QuoteTurnoverHistory;
  volumeStudies: VolumeStudyData;
}

interface Result {
  key: string;
  session: unknown;
  value: ChartQuoteTurnover;
}

const REFRESH_MS = 60_000;

export function useQuoteTurnover(
  controller: TerminalController,
  state: TerminalState,
  row: MarketRow | undefined
): ChartQuoteTurnover {
  const prefs = state.preferences;
  const timeframe = prefs.timeframe;
  const interval = turnoverInterval(timeframe);
  const source = quoteTurnoverSource(row);
  const uid = source?.uid;
  const currency = source?.currency;
  const session = controller.sessionKey();
  const wanted =
    !drawingToolbarSettings(prefs.chartSettings).indicatorsHidden &&
    prefs.technicalIndicators?.some(
      (instance) => instance.definitionId === "volume-24-hours" && instance.visible
    );
  const enabled =
    wanted &&
    session !== null &&
    uid &&
    interval &&
    marketAvailable(state) &&
    !state.importingBackup &&
    !state.importRecoveryRequired &&
    state.historyViewReady !== false;
  const first = state.candles[0]?.timestamp;
  const last = state.candles.at(-1)?.timestamp;
  const key = JSON.stringify([state.owner, uid, timeframe, currency]);
  const cache = useRef<ObservedTurnover | null>(null);
  const [result, setResult] = useState<Result | null>(null);

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
    const publish = (value: ChartQuoteTurnover) => {
      if (!abort.signal.aborted && controller.sessionKey() === session)
        setResult({ key, session, value });
    };
    const update = async () => {
      const window = quoteTurnoverWindow(interval, first, Math.min(Date.now(), end - 1));
      if (window.to < window.from) {
        publish({ status: "empty", currency });
        return;
      }
      const prior =
        cache.current?.key === key && cache.current.session === session
          ? cache.current.history
          : null;
      const overlap = prior && prior.range.from <= window.from && prior.range.to >= window.from;
      const from = overlap
        ? Math.max(window.from, Math.min(prior.range.to, window.to) - step)
        : window.from;
      const part = await session.loadQuoteTurnover(
        uid,
        interval,
        { from, to: window.to },
        abort.signal
      );
      if (abort.signal.aborted) return;
      if (!part || part.instrumentKey !== uid || part.currency !== currency) {
        publish({ status: "empty", currency });
        return;
      }
      const earlier = overlap
        ? prior.bars.filter(({ timestamp }) => timestamp >= window.from && timestamp < from)
        : [];
      const history = { ...part, range: window, bars: [...earlier, ...part.bars] };
      const turnover24Hours = compileQuoteTurnover(history);
      const volumeStudies = { turnover24Hours };
      cache.current = { key, session, history, volumeStudies };
      publish({
        status: turnover24Hours.values.some((value) => value !== null) ? "ready" : "empty",
        currency,
        volumeStudies
      });
    };
    const run = () => {
      void update()
        .catch(() => {
          const previous = cache.current;
          publish({
            status: "error",
            currency,
            ...(previous?.key === key && previous.session === session
              ? { volumeStudies: previous.volumeStudies }
              : {})
          });
        })
        .finally(() => {
          if (!abort.signal.aborted && Date.now() < end) timer = setTimeout(run, REFRESH_MS);
        });
    };
    run();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [controller, enabled, first, last, currency, interval, key, session, timeframe, uid]);

  if (!wanted) return { status: "hidden" };
  if (!uid || !currency || !interval) return { status: "unsupported" };
  if (!enabled || first === undefined || last === undefined) return { status: "loading", currency };
  return result?.key === key && result.session === session
    ? result.value
    : { status: "loading", currency };
}

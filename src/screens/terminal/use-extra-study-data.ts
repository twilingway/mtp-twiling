import { useMemo } from "react";
import type { TechnicalSupplementalInputs } from "../../charts/adapter.js";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import type { CalendarHistoryLoader } from "../../model/technical-indicators/catalog-expansion/calendar-analysis-data.js";
import type { MarketRow } from "../../model/types.js";
import type { CorrelationCandleReader } from "../../services/correlation-history.js";
import type { TerminalController } from "./controller.js";
import type { TerminalState } from "./state.js";
import { useAutoKeyLevelTrades } from "./use-auto-key-level-trades.js";
import { useCalendarAnalysis } from "./use-calendar-analysis.js";
import { useCorrelationHistory } from "./use-correlation-history.js";
import { useIntrabarVolume } from "./use-intrabar-volume.js";
import { useNetVolume } from "./use-net-volume.js";
import { usePriceLevelHistory } from "./use-price-level-history.js";
import { usePriceTarget } from "./use-price-target.js";

function historyReader(session: object): session is CorrelationCandleReader {
  return "loadCandles" in session && typeof session.loadCandles === "function";
}

export function useExtraStudyData(
  controller: TerminalController,
  state: TerminalState,
  row: MarketRow | undefined
) {
  const session = controller.sessionKey();
  const ownerKey = useMemo(
    () => session && { session, owner: state.owner },
    [session, state.owner]
  );
  const calendarLoader = useMemo<CalendarHistoryLoader | undefined>(() => {
    if (!session || !historyReader(session)) return;
    return async (source, timeframe, range, signal) =>
      (await session.loadCandles(source.symbol, timeframe, range, { uid: source.uid, signal }))
        .candles;
  }, [session]);
  const calendar = useCalendarAnalysis({
    ownerKey,
    row,
    rows: state.rows,
    instances: state.preferences.technicalIndicators,
    hidden: Boolean(
      drawingToolbarSettings(state.preferences.chartSettings).indicatorsHidden ||
      state.profileTransition ||
      state.importingBackup ||
      state.importRecoveryRequired
    ),
    loadCandles: calendarLoader
  });
  const correlationHistory = useCorrelationHistory(controller, state, row);
  const priceLevel = usePriceLevelHistory(controller, state, row);
  const autoKeyLevel = useAutoKeyLevelTrades(controller, state, row);
  const priceTarget = usePriceTarget(controller, state, row);
  const intrabarVolume = useIntrabarVolume(controller, state, row);
  const netVolume = useNetVolume(controller, state, row);
  const instrumentUid = row?.uid;
  const { priceLevelPeriods } = priceLevel;
  const { seasonalityHistory } = calendar;
  const forecast = priceTarget.priceTarget;
  const autoKeyLevelTrades = autoKeyLevel.data;
  const intrabar = intrabarVolume.volumeStudies?.intrabarVolume;
  const netVolumeTrades = netVolume.volumeStudies?.netVolumeTrades;
  const data = useMemo<TechnicalSupplementalInputs>(
    () => ({
      ...(instrumentUid ? { instrumentUid } : {}),
      ...(correlationHistory ? { correlationHistory } : {}),
      ...(priceLevelPeriods ? { priceLevelPeriods } : {}),
      ...(seasonalityHistory ? { seasonalityHistory } : {}),
      ...(forecast ? { priceTarget: forecast } : {}),
      ...(autoKeyLevelTrades ? { autoKeyLevelTrades } : {}),
      ...(intrabar || netVolumeTrades
        ? {
            volumeStudies: {
              ...(intrabar ? { intrabarVolume: intrabar } : {}),
              ...(netVolumeTrades ? { netVolumeTrades } : {})
            }
          }
        : {})
    }),
    [
      instrumentUid,
      correlationHistory,
      priceLevelPeriods,
      seasonalityHistory,
      forecast,
      autoKeyLevelTrades,
      intrabar,
      netVolumeTrades
    ]
  );
  return { data, calendar, priceLevel, priceTarget, intrabarVolume, netVolume };
}

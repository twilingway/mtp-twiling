import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ChartAdapter, ChartOptions } from "../../charts/adapter.js";
import { chartRenderConfigFromKey, chartRenderConfigKey } from "../../charts/render-config.js";
import { t } from "../../i18n/messages.js";
import { chartBackground } from "../../model/theme.js";
import type { Candle, ChartView, IndicatorFlags, MarketRow } from "../../model/types.js";
import type { MarketClient } from "../../services/market-client.js";
import type { PublicMarketReconnect } from "../../services/market-public.js";
import { startWorkspaceCandleFeed, workspaceHistoryRange } from "./workspace-candle-feed.js";
import type { TerminalController } from "./controller.js";
import type { TerminalPreferences } from "./state.js";

export type WorkspaceInstrument = MarketRow & { uid: string };

interface AuxiliaryChartProps {
  row: WorkspaceInstrument;
  controller: TerminalController;
  market: MarketClient;
  owner: string;
  preferences: TerminalPreferences;
}

const noIndicators: IndicatorFlags = {
  ma: false,
  ema: false,
  volume: false,
  mtp160: false,
  mtp440: false,
  mtp640: false
};

type FeedPhase = "loading" | "ready" | "empty" | "error";

export const AuxiliaryChart = memo(function AuxiliaryChart({
  row,
  controller,
  market,
  owner,
  preferences
}: AuxiliaryChartProps) {
  const { engine, timeframe, rangeDays, locale, timeZone, chartSettings } = preferences;
  const { uid, symbol } = row;
  const canvas = useRef<HTMLDivElement>(null);
  const chart = useRef<ChartAdapter | null>(null);
  const currentRow = useRef(row);
  const candles = useRef<Candle[]>([]);
  const hasData = useRef(false);
  const fittedHistory = useRef(false);
  const savedView = useRef<ChartView | null>(null);
  const [retry, setRetry] = useState(0);
  const [adapterRetry, setAdapterRetry] = useState(0);
  const [feed, setFeed] = useState<{ attempt: number; phase: FeedPhase; data: boolean }>({
    attempt: 0,
    phase: "loading",
    data: false
  });
  const [adapterFailed, setAdapterFailed] = useState(false);
  const phase = feed.attempt === retry ? feed.phase : "loading";
  const renderKey = chartRenderConfigKey(chartSettings, noIndicators);
  const render = useMemo(() => chartRenderConfigFromKey(renderKey), [renderKey]);
  const provider = row.providerRef?.provider;
  const category = row.providerRef?.category;

  useEffect(() => {
    currentRow.current = row;
    chart.current?.updatePriceFormat?.({ owner, uid, step: row.step, priceHint: row.price });
  }, [row, owner, uid]);

  useEffect(() => {
    const eventName = provider ? "market-reconnect" : "bank-reconnect";
    const refresh = (event: Event) => {
      if (controller.sessionKey() !== market || market.closed) return;
      const detail = (event as CustomEvent<PublicMarketReconnect>).detail;
      if (!provider || (detail?.provider === provider && detail.category === category))
        setRetry((attempt) => attempt + 1);
    };
    market.addEventListener(eventName, refresh);
    return () => market.removeEventListener(eventName, refresh);
  }, [controller, market, provider, category]);

  useEffect(() => {
    const active = () => {
      const state = controller.getSnapshot();
      return (
        controller.sessionKey() === market &&
        !market.closed &&
        state.owner === owner &&
        !state.profileTransition &&
        !state.importingBackup &&
        !state.importRecoveryRequired
      );
    };
    const applyHistory = (next: Candle[], final: boolean) => {
      // A view captured from live-only bars would hide the rest of the first history load.
      const fit = next.length > 0 && !fittedHistory.current;
      if (final && next.length) fittedHistory.current = true;
      candles.current = next;
      if (chart.current) {
        const view = fit ? null : chart.current.getView();
        chart.current.setData(next, fit);
        if (view) chart.current.setView(view);
      }
      if (!hasData.current && next.length) {
        hasData.current = true;
        setFeed((previous) => ({ ...previous, data: true }));
      }
    };
    return startWorkspaceCandleFeed(market, {
      uid,
      symbol,
      timeframe,
      range: workspaceHistoryRange(market.serverNow(), timeframe, rangeDays),
      initial: candles.current,
      active,
      replace: applyHistory,
      update: (bar, next) => {
        if (!hasData.current) applyHistory(next, false);
        else {
          candles.current = next;
          chart.current?.updateBar(bar);
        }
      },
      settle: (outcome, data) => setFeed({ attempt: retry, phase: outcome, data })
    });
  }, [controller, market, owner, uid, symbol, timeframe, rangeDays, retry]);

  useEffect(() => {
    const container = canvas.current;
    if (!container) return;
    let alive = true;
    let owned: ChartAdapter | undefined;
    const initialize = async () => {
      const makeChart =
        engine === "kline"
          ? (await import("../../charts/kline.js")).makeKline
          : (await import("../../charts/lightweight.js")).makeLightweight;
      if (!alive || controller.sessionKey() !== market || market.closed) return;
      const options: ChartOptions = {
        container,
        row: currentRow.current,
        timeframe,
        rangeDays,
        settings: render.settings,
        indicators: render.indicators,
        ...(locale ? { locale } : {}),
        ...(timeZone ? { timeZone } : {}),
        paint: () => {},
        onCrosshair: () => {},
        onNearStart: () => {}
      };
      owned = makeChart(options);
      owned.source = { owner, uid, viewKey: `comparison:${uid}:${timeframe}` };
      owned.persistView = false;
      chart.current = owned;
      owned.setData(candles.current, !savedView.current);
      if (savedView.current) owned.setView(savedView.current);
      setAdapterFailed(false);
    };
    void initialize().catch(() => {
      if (!alive) return;
      owned?.destroy();
      owned = undefined;
      chart.current = null;
      setAdapterFailed(true);
    });
    return () => {
      alive = false;
      if (!owned) return;
      savedView.current = owned.getView() ?? savedView.current;
      chart.current = null;
      owned.destroy();
    };
  }, [
    controller,
    market,
    owner,
    uid,
    timeframe,
    rangeDays,
    engine,
    locale,
    timeZone,
    render,
    adapterRetry
  ]);

  const error = adapterFailed
    ? t("Не удалось открыть график.")
    : phase === "error"
      ? t("Не удалось загрузить историю.")
      : phase === "empty"
        ? t("История недоступна")
        : null;
  return (
    <div className="auxiliary-chart-body" aria-busy={phase === "loading" || undefined}>
      <div
        ref={canvas}
        className="auxiliary-chart-canvas"
        style={{ background: chartBackground(chartSettings) }}
      />
      {(error || phase === "loading") && (
        <div
          className="auxiliary-chart-status"
          data-has-candles={feed.data && !adapterFailed}
          role="status"
        >
          <span>{error ?? t("Загрузка истории…")}</span>
          {error && (
            <button
              type="button"
              onClick={() => {
                if (adapterFailed) setAdapterRetry((attempt) => attempt + 1);
                else setRetry((attempt) => attempt + 1);
              }}
            >
              {t("Повторить загрузку")}
            </button>
          )}
        </div>
      )}
    </div>
  );
});

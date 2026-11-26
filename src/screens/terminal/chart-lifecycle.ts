import { marketAvailable } from "./market-readiness.js";
import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { Candle, ChartView, Drawing } from "../../model/types.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type {
  ChartAdapter,
  ChartOptions,
  TechnicalSupplementalInputs
} from "../../charts/adapter.js";
import { drawingLayer, paintDrawings } from "../../model/drawing-model.js";
import { loadChartView, saveAdapterView, saveChartView } from "../../services/chart-camera.js";
import { useTerminal } from "./context.js";
import { viewKey } from "./controller-bridge.js";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { chartRenderConfigFromKey, chartRenderConfigKey } from "../../charts/render-config.js";
import type { TerminalState } from "./state.js";
import { persistIndicatorPaneLayout } from "./indicator-preferences.js";
import { cameraCallbacks } from "./controller-camera-sync.js";
import { watchChartPriceMetadata } from "./chart-price-metadata.js";
import { persistTechnicalPaneLayout } from "./technical-indicator-actions.js";
import type { TerminalPreferences } from "./state.js";

function technicalInputs(preferences: TerminalPreferences) {
  const instances = preferences.technicalIndicators ?? [];
  return drawingToolbarSettings(preferences.chartSettings).indicatorsHidden
    ? instances.map((item) => ({ ...item, visible: false }))
    : instances;
}

export function useChartCanvas(
  ref: RefObject<HTMLDivElement | null>,
  visibleDrawings: (state: TerminalState) => Drawing[],
  supplemental: TechnicalSupplementalInputs
): void {
  const { controller, state } = useTerminal(),
    dataRef = useRef<Candle[]>([]),
    pendingSavedView = useRef<ChartView | undefined>(undefined),
    dataFallback = useRef(false),
    adapterRef = useRef<ChartAdapter | null>(null),
    supplementalRef = useRef(supplemental);
  const p = state.preferences,
    available = marketAvailable(state),
    session = controller.sessionKey(),
    uid = selectedMarketRow(state.rows, p)?.uid,
    renderKey = chartRenderConfigKey(p.chartSettings, p.indicators),
    renderConfig = useMemo(() => chartRenderConfigFromKey(renderKey), [renderKey]),
    drawingsHidden = drawingToolbarSettings(p.chartSettings).drawingsHidden,
    indicatorsHidden = drawingToolbarSettings(p.chartSettings).indicatorsHidden,
    technicalInstances = p.technicalIndicators,
    technicalLayout = p.technicalPaneLayout;
  useEffect(() => {
    supplementalRef.current = supplemental;
    const adapter = adapterRef.current;
    if (adapter && !adapter.retired) adapter.updateTechnicalInputs?.(supplemental);
  }, [supplemental]);
  useEffect(() => {
    const container = ref.current,
      owner = state.owner,
      revision = state.chartRevision,
      key = `${p.symbol}:${p.timeframe}:${p.engine}:${p.rangeDays}`;
    if (!container || !uid || !available || state.importRecoveryRequired) return;
    let cancelled = false,
      layoutWrite = 0,
      stopPriceMetadata = () => {},
      owned: ChartAdapter | null = null;
    const matches = () => {
      const current = controller.getSnapshot();
      return (
        !cancelled &&
        !current.importRecoveryRequired &&
        marketAvailable(current) &&
        controller.sessionKey() === session &&
        current.owner === owner &&
        current.chartRevision === revision &&
        viewKey(current.preferences) === key &&
        selectedMarketRow(current.rows, current.preferences)?.uid === uid
      );
    };
    const initialize = async () => {
      const snapshot = controller.getSnapshot(),
        instrument = selectedMarketRow(snapshot.rows, snapshot.preferences);
      if (!instrument || !matches()) return;
      const options: ChartOptions = {
        ...cameraCallbacks(controller, () => owned, matches, saveChartView),
        ...(p.locale ? { locale: p.locale } : {}),
        ...(p.timeZone ? { timeZone: p.timeZone } : {}),
        container,
        row: instrument,
        timeframe: p.timeframe,
        rangeDays: p.rangeDays,
        indicators: renderConfig.indicators,
        settings: renderConfig.settings,
        indicatorPaneLayout: snapshot.preferences.indicatorPaneLayout,
        technicalIndicators: technicalInputs(snapshot.preferences),
        technicalPaneLayout: snapshot.preferences.technicalPaneLayout ?? [],
        onTechnicalPaneLayout: (layout, capture) => {
          const valid = () =>
            matches() &&
            owned !== null &&
            controller.chart === owned &&
            !owned.retired &&
            !controller.getSnapshot().backupBusy &&
            !controller.getSnapshot().importingBackup;
          void persistTechnicalPaneLayout(controller, layout, valid, capture).catch(
            (error: unknown) => {
              if (valid())
                controller.notify(
                  error instanceof Error ? error.message : "Не удалось сохранить панель индикатора."
                );
            }
          );
        },
        onIndicatorLayout: (layout) => {
          const write = ++layoutWrite;
          const valid = () => {
            const current = controller.getSnapshot();
            return (
              matches() &&
              write === layoutWrite &&
              owned !== null &&
              controller.chart === owned &&
              !owned.retired &&
              // Pane dimensions remain editable while history/camera restoration is pending.
              !current.backupBusy &&
              !current.importingBackup &&
              !current.importRecoveryRequired
            );
          };
          void persistIndicatorPaneLayout(controller, layout, valid).catch((error: unknown) => {
            if (valid())
              controller.notify(
                error instanceof Error ? error.message : "Не удалось сохранить высоту панели."
              );
          });
        },
        onNearStart: () => {
          if (matches()) controller.scheduleOlderHistory();
        },
        onCrosshair: (bar) => {
          if (matches()) controller.setCrosshair(bar);
        },
        paint: (ctx, width, height, project, layer) => {
          if (!matches()) return;
          const current = controller.getSnapshot(),
            items = visibleDrawings(current).filter((item) => drawingLayer(item) === layer);
          paintDrawings(
            ctx,
            [...items, ...(current.preview && layer === "front" ? [current.preview] : [])],
            project,
            width,
            height,
            current.selectedObject
          );
        }
      };
      const [factory, view] = await Promise.all([
        p.engine === "kline"
          ? import("../../charts/kline.js").then((module) => module.makeKline)
          : import("../../charts/lightweight.js").then((module) => module.makeLightweight),
        loadChartView(owner, key).catch(() => undefined)
      ]);
      if (!matches()) return;
      owned = factory(options);
      owned.source = { owner, viewKey: key, uid };
      const current = controller.getSnapshot(),
        ready = !current.importingBackup && current.historyViewReady !== false,
        candles = current.candles,
        showingFallback = ready && candles.length > 0 && current.historyViewFallback === true;
      owned.persistView = ready && !showingFallback;
      adapterRef.current = owned;
      controller.chart = owned;
      const currentPreferences = controller.getSnapshot().preferences;
      owned.updateTechnicalIndicators?.(
        technicalInputs(currentPreferences),
        currentPreferences.technicalPaneLayout ?? []
      );
      owned.updateTechnicalInputs?.(supplementalRef.current);
      stopPriceMetadata = watchChartPriceMetadata(controller, owned, matches);
      dataRef.current = ready ? candles : [];
      dataFallback.current = showingFallback;
      if (ready && candles.length) {
        if (view && !showingFallback) owned.setView(view);
        owned.setData([...candles], true);
      } else pendingSavedView.current = view;
    };
    void initialize().catch((error: unknown) => {
      if (matches())
        controller.notify(error instanceof Error ? error.message : "Не удалось построить график");
    });
    return () => {
      cancelled = true;
      stopPriceMetadata();
      const current = controller.getSnapshot();
      if (
        owned &&
        (current.importingBackup || current.historyViewReady === false) &&
        current.owner === owner &&
        (current.importingBackup ||
          (viewKey(current.preferences) === key &&
            selectedMarketRow(current.rows, current.preferences)?.uid === uid))
      )
        owned.persistView = false;
      void saveAdapterView(owned, owner, key).catch(() => {});
      owned?.destroy();
      if (controller.chart === owned) controller.chart = null;
      adapterRef.current = null;
      dataRef.current = [];
      dataFallback.current = false;
      pendingSavedView.current = undefined;
    };
  }, [
    controller,
    session,
    ref,
    visibleDrawings,
    uid,
    state.owner,
    available,
    state.chartRevision,
    state.importRecoveryRequired,
    p.engine,
    p.symbol,
    p.timeframe,
    p.rangeDays,
    p.locale,
    p.timeZone,
    renderConfig
  ]);
  useEffect(() => {
    const adapter = adapterRef.current,
      next = state.candles,
      previous = dataRef.current,
      fallback = state.historyViewFallback === true;
    if (adapter?.retired || state.importRecoveryRequired) return;
    if (adapter)
      adapter.persistView = !fallback && !state.importingBackup && state.historyViewReady !== false;
    if (state.importingBackup || state.historyViewReady === false) return;
    if (!adapter || !next.length || next === previous) return;
    const incremental =
      previous.length > 0 &&
      next.length >= previous.length &&
      next.length <= previous.length + 1 &&
      previous.every((bar, i) => i >= previous.length - 1 || bar === next[i]);
    if (fallback && !dataFallback.current) {
      adapter.setData([...next], true);
    } else if (incremental && previous[0]?.timestamp === next[0]?.timestamp) {
      const last = next.at(-1);
      if (last) adapter.updateBar(last);
    } else {
      const view = previous.length ? adapter.getView() : null;
      if (!fallback && pendingSavedView.current) adapter.setView(pendingSavedView.current);
      adapter.setData([...next], !previous.length);
      if (view) adapter.setView(view);
    }
    dataRef.current = next;
    dataFallback.current = fallback;
    pendingSavedView.current = undefined;
  }, [
    state.candles,
    state.historyViewReady,
    state.historyViewFallback,
    state.importingBackup,
    state.importRecoveryRequired
  ]);
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || adapter.retired || state.importingBackup || state.importRecoveryRequired)
      return;
    try {
      const instances = technicalInstances ?? [];
      adapter.updateTechnicalIndicators?.(
        indicatorsHidden ? instances.map((item) => ({ ...item, visible: false })) : instances,
        technicalLayout ?? []
      );
    } catch (error: unknown) {
      controller.notify(error instanceof Error ? error.message : "Не удалось обновить индикатор.");
    }
  }, [
    controller,
    technicalInstances,
    technicalLayout,
    indicatorsHidden,
    state.importingBackup,
    state.importRecoveryRequired
  ]);
  useEffect(() => {
    adapterRef.current?.redrawDrawings();
  }, [
    state.drawings,
    state.drawingSettingsPreview,
    state.preview,
    state.selectedObject,
    drawingsHidden
  ]);
}

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Candle, Drawing } from "../../model/types.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { ChartAdapter, ChartOptions } from "../../charts/adapter.js";
import { paintDrawings } from "../../model/drawing-model.js";
import { loadChartView, saveChartView } from "../../services/chart-camera.js";
import { useTerminal } from "./context.js";
import { viewKey } from "./controller-bridge.js";
import type { TerminalState } from "./state.js";

export function useChartCanvas(
  ref: RefObject<HTMLDivElement | null>,
  visibleDrawings: (state: TerminalState) => Drawing[]
): void {
  const { controller, state } = useTerminal(),
    dataRef = useRef<Candle[]>([]),
    adapterRef = useRef<ChartAdapter | null>(null);
  const p = state.preferences,
    uid = selectedMarketRow(state.rows, p)?.uid;
  useEffect(() => {
    const container = ref.current,
      owner = state.owner,
      key = `${p.symbol}:${p.timeframe}:${p.engine}:${p.rangeDays}`;
    if (!container || !uid || !state.authenticated) return;
    let cancelled = false,
      owned: ChartAdapter | null = null;
    const matches = () => {
      const current = controller.getSnapshot();
      return (
        !cancelled &&
        current.authenticated &&
        current.owner === owner &&
        viewKey(current.preferences) === key &&
        selectedMarketRow(current.rows, current.preferences)?.uid === uid
      );
    };
    const initialize = async () => {
      const snapshot = controller.getSnapshot(),
        instrument = selectedMarketRow(snapshot.rows, snapshot.preferences);
      if (!instrument || !matches()) return;
      const options: ChartOptions = {
        container,
        row: instrument,
        timeframe: p.timeframe,
        rangeDays: p.rangeDays,
        indicators: p.indicators,
        settings: p.chartSettings,
        onNearStart: () => {
          if (matches()) controller.scheduleOlderHistory();
        },
        onCrosshair: (bar) => {
          if (matches()) controller.setCrosshair(bar);
        },
        paint: (ctx, width, height, project, layer) => {
          if (!matches()) return;
          const current = controller.getSnapshot(),
            items = visibleDrawings(current).filter((item) => (item.layer ?? "back") === layer);
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
      adapterRef.current = owned;
      controller.chart = owned;
      // Adapters retain this request until nonempty data has completed its initial fit.
      if (view) owned.setView(view);
      const candles = controller.getSnapshot().candles;
      dataRef.current = candles;
      if (candles.length) owned.setData([...candles], true);
    };
    void initialize().catch((error: unknown) => {
      if (matches())
        controller.notify(error instanceof Error ? error.message : "Не удалось построить график");
    });
    return () => {
      cancelled = true;
      const view = owned?.getView();
      if (view && owner !== "guest") void saveChartView(owner, key, view).catch(() => {});
      owned?.destroy();
      if (controller.chart === owned) controller.chart = null;
      adapterRef.current = null;
      dataRef.current = [];
    };
  }, [
    controller,
    ref,
    visibleDrawings,
    uid,
    state.owner,
    state.authenticated,
    p.engine,
    p.symbol,
    p.timeframe,
    p.rangeDays,
    p.indicators,
    p.chartSettings
  ]);
  useEffect(() => {
    const adapter = adapterRef.current,
      next = state.candles,
      previous = dataRef.current;
    if (!adapter || !next.length || next === previous) return;
    const incremental =
      previous.length > 0 &&
      next.length >= previous.length &&
      next.length <= previous.length + 1 &&
      previous.every((bar, i) => i >= previous.length - 1 || bar === next[i]);
    if (incremental && previous[0]?.timestamp === next[0]?.timestamp) {
      const last = next.at(-1);
      if (last) adapter.updateBar(last);
    } else {
      const view = previous.length ? adapter.getView() : null;
      adapter.setData([...next], !previous.length);
      if (view) adapter.setView(view);
    }
    dataRef.current = next;
  }, [state.candles]);
  useEffect(() => {
    adapterRef.current?.redrawDrawings();
  }, [state.drawings, state.preview, state.selectedObject]);
}

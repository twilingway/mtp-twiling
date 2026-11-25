import type { ChartCamera, ChartView } from "../model/types.js";
import { isInstrumentViewKey } from "../model/instrument-symbol.js";

export function isChartCamera(value: unknown): value is ChartCamera {
  if (!value || typeof value !== "object") return false;
  return (
    "barSpace" in value &&
    typeof value.barSpace === "number" &&
    Number.isFinite(value.barSpace) &&
    value.barSpace > 0 &&
    "rightOffsetBars" in value &&
    typeof value.rightOffsetBars === "number" &&
    Number.isFinite(value.rightOffsetBars)
  );
}

/** A symbol switch carries zoom and right gap, never another symbol's calendar anchor. */
export function chooseChartView(
  symbol: string,
  saved: ChartView | undefined,
  shared: { symbol: string; camera: ChartCamera } | undefined
): ChartView | undefined {
  if (shared && shared.symbol !== symbol) return { camera: shared.camera };
  return saved ?? (shared ? { camera: shared.camera } : undefined);
}

/** Retain restoration requests while a newly mounted chart has no data yet. */
export class PendingChartView {
  private pending: ChartView | null = null;
  stage(view: ChartView): void {
    this.pending = view;
  }
  take(ready: boolean): ChartView | null {
    if (!ready) return null;
    const view = this.pending;
    this.pending = null;
    return view;
  }
}

export function signedRightOffset(width: number, lastBarX: number, barSpace: number): number {
  return (width - lastBarX) / barSpace - 0.5;
}

export function parseChartViewKey(
  key: string
): { symbol: string; engine: string; timeframe: string } | null {
  if (!isInstrumentViewKey(key)) return null;
  const fields = key.split(":"),
    rangeDays = fields.pop(),
    engine = fields.pop(),
    timeframe = fields.pop(),
    symbol = fields.join(":");
  return symbol && engine && timeframe && rangeDays ? { symbol, engine, timeframe } : null;
}

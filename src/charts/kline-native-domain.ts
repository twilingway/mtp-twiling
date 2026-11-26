import type { Chart, Indicator, KLineData } from "klinecharts";
import type { TechnicalRenderOutput } from "./technical-render-data.js";
import type { PlotPrecisionPolicy } from "../model/technical-indicators/presentation-types.js";

export interface NativeDomain {
  first: number;
  end: number;
  data: readonly KLineData[];
  pricePrecision: number;
}
export interface PlannedDomain {
  paneId: string;
  policy: PlotPrecisionPolicy;
  outputs: readonly TechnicalRenderOutput[];
}
/** The installed SDK enumerates realFrom <= dataIndex < realTo, including virtual slots. */
export function klineNativeDomain(chart: Chart): NativeDomain | null {
  if (
    typeof chart.getVisibleRange !== "function" ||
    typeof chart.getDataList !== "function" ||
    typeof chart.getPriceVolumePrecision !== "function" ||
    typeof chart.getIndicatorByPaneId !== "function"
  )
    return null; // Older controlled fixtures expose only their previously used public surface.
  const range = chart.getVisibleRange(),
    data = chart.getDataList();
  return {
    first: Number.isInteger(range.realFrom) ? Math.max(0, range.realFrom) : 0,
    end: Number.isInteger(range.realTo) ? range.realTo : 0,
    data,
    pricePrecision: chart.getPriceVolumePrecision().price
  };
}
export function finiteInDomain(
  values: readonly unknown[],
  domain: Pick<NativeDomain, "first" | "end">
): boolean {
  for (let i = domain.first; i < Math.min(domain.end, values.length); i++)
    if (typeof values[i] === "number" && Number.isFinite(values[i])) return true;
  return false;
}
export function eligiblePublicPlots(
  outputs: readonly TechnicalRenderOutput[],
  domain: NativeDomain
) {
  return outputs.some((output) => output.style.visible && finiteInDomain(output.values, domain));
}
export function klinePlotPrecision(policy: PlotPrecisionPolicy, paneId: string): number {
  return policy === "fixed-2" || (policy === "compact-number" && paneId !== "candle_pane") ? 2 : 6;
}
function eligibleNative(indicator: Indicator, domain: NativeDomain): boolean {
  if (!indicator.visible) return false;
  for (let i = domain.first; i < Math.min(domain.end, indicator.result.length); i++) {
    const row: unknown = indicator.result[i];
    if (row && typeof row === "object")
      for (const figure of indicator.figures)
        if (Number.isFinite((row as Record<string, unknown>)[figure.key])) return true;
  }
  if (indicator.shouldOhlc)
    for (let i = domain.first; i < domain.end; i++) {
      const bar = domain.data[i];
      if (bar && Number.isFinite(bar.low) && Number.isFinite(bar.high)) return true;
    }
  return false;
}
/** Borrow only a precision already belonging to a real active source; never another decorator. */
export function neutralKlinePrecision(
  chart: Chart,
  paneId: string,
  domain: NativeDomain,
  activePlans: readonly PlannedDomain[],
  ownedNames: ReadonlySet<string>
): number {
  const precisions: number[] = [];
  if (paneId === "candle_pane") {
    const candle = chart.getStyles().candle;
    for (let i = domain.first; i < Math.min(domain.end, domain.data.length); i++) {
      const bar = domain.data[i];
      if (
        bar &&
        (String(candle.type) === "area"
          ? Number.isFinite(bar[candle.area.value])
          : Number.isFinite(bar.low) && Number.isFinite(bar.high))
      ) {
        precisions.push(domain.pricePrecision);
        break;
      }
    }
  }
  for (const plan of activePlans)
    if (plan.paneId === paneId)
      precisions.push(
        plan.policy === "native-price"
          ? domain.pricePrecision
          : klinePlotPrecision(plan.policy, paneId)
      );
  const native = chart.getIndicatorByPaneId(paneId) as Map<string, Indicator> | null;
  if (native && typeof native.entries === "function")
    for (const [name, indicator] of native.entries())
      if (!ownedNames.has(name) && eligibleNative(indicator, domain))
        precisions.push(indicator.precision);
  // Normal0 is a data-free empty-pane layout role, not a zero price/figure or market value.
  return precisions.length ? Math.min(...precisions) : 0;
}

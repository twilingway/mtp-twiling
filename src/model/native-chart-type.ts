import type { ChartSettings } from "./types.js";

export const NATIVE_CHART_TYPES = ["candles", "hollowCandles", "bars", "line", "area"] as const;
export type NativeChartType = (typeof NATIVE_CHART_TYPES)[number];

export function isNativeChartType(value: unknown): value is NativeChartType {
  return NATIVE_CHART_TYPES.some((type) => type === value);
}

export function validNativeChartTypeField(settings: object): boolean {
  return (
    !Object.hasOwn(settings, "chartType") ||
    isNativeChartType(Object.getOwnPropertyDescriptor(settings, "chartType")?.value)
  );
}

export function resolveNativeChartType(settings: object): NativeChartType {
  if (!validNativeChartTypeField(settings)) throw new RangeError("Тип графика не поддерживается.");
  const value: unknown = Object.getOwnPropertyDescriptor(settings, "chartType")?.value;
  return isNativeChartType(value) ? value : "candles";
}

/** An ordinary settings form can be older than the last independent chart type selection. */
export function retainNativeChartType(current: ChartSettings, next: ChartSettings): ChartSettings {
  if (!validNativeChartTypeField(next)) throw new RangeError("Тип графика не поддерживается.");
  const settings = { ...next };
  if (current.chartType === undefined) delete settings.chartType;
  else settings.chartType = current.chartType;
  return settings;
}

export const NATIVE_CHART_LINE = Object.freeze({
  color: "#2962FF",
  width: 2 as const,
  top: "rgba(41,98,255,0.28)",
  bottom: "rgba(41,98,255,0.04)"
});

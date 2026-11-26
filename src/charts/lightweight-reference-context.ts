import type {
  AutoscaleInfoProvider,
  IChartApi,
  ISeriesApi,
  SeriesType,
  Time
} from "lightweight-charts";
import type { TechnicalRenderOutput } from "./technical-render-data.js";

type Series = ISeriesApi<SeriesType>;
const seconds = (time: Time): number =>
  typeof time === "number"
    ? time
    : typeof time === "string"
      ? Date.parse(time) / 1000
      : Date.UTC(time.year, time.month - 1, time.day) / 1000;
/** SDK percentage/indexed modes use each source's own firstValue. Convert axis bounds, never data. */
export function referenceRelativeValue(
  value: number,
  ownBase: number,
  commonBase: number,
  mode: number
): number | null {
  if (mode !== 2 && mode !== 3) return value;
  if (
    !Number.isFinite(ownBase) ||
    !Number.isFinite(commonBase) ||
    ownBase === 0 ||
    commonBase === 0
  )
    return null;
  const result = ownBase + ((value - commonBase) / Math.abs(commonBase)) * Math.abs(ownBase);
  return Number.isFinite(result) ? result : null;
}
export function lightweightReferenceContext(chart: IChartApi, primary: () => Series | undefined) {
  let outputs: readonly TechnicalRenderOutput[] = [],
    series: ReadonlyMap<string, Series> = new Map();
  const first = (
    values: readonly (number | null)[],
    timestamps: readonly number[],
    visibleOnly: boolean
  ): number | null => {
    const range = chart.timeScale().getVisibleRange();
    if (!range) return null;
    const from = seconds(range.from) * 1000,
      to = seconds(range.to) * 1000;
    let low=0,high=timestamps.length;
    while(low<high){const middle=Math.floor((low+high)/2);if(timestamps[middle]!<from)low=middle+1;else high=middle;}
    for (let i = low; i < timestamps.length && (!visibleOnly || timestamps[i]!<=to); i++)
      if (
        timestamps[i]! >= from &&
        (!visibleOnly || timestamps[i]! <= to) &&
        Number.isFinite(values[i])
      )
        return values[i]!;
    return null;
  };
  function primaryBase(): number | null {
    const range = chart.timeScale().getVisibleRange(),
      owner = primary();
    if (!range || !owner) return null;
    const logical=chart.timeScale().getVisibleLogicalRange();if(!logical)return null;
    // Same floor(left)/nearest-right rule as installed TimeScaleVisibleRange + Series.firstBar,
    // plus the missing upper-bound eligibility check. Public O(log N) lookup, no data() copy.
    const row=owner.dataByIndex(Math.floor(logical.from),1);
    if(row && seconds(row.time)<=seconds(range.to)){
      const value="close" in row?row.close:"value" in row?row.value:null;
      if(typeof value==="number"&&Number.isFinite(value))return value;
    }
    return null;
  }
  function owner(instanceId: string, paneKey: string, fallback?: Series) {
    if (paneKey === "price") return primaryBase()===null?undefined:primary();
    const output = outputs.find(
      (item) =>
        item.instanceId === instanceId &&
        item.paneKey === paneKey &&
        item.style.visible &&
        first(item.values, item.timestamps, true) !== null
    );
    return output ? series.get(output.key) : fallback;
  }
  function base(instanceId: string, paneKey: string, fallback: number | null): number | null {
    if (paneKey === "price") return primaryBase();
    const output = outputs.find(
      (item) =>
        item.instanceId === instanceId &&
        item.paneKey === paneKey &&
        item.style.visible &&
        first(item.values, item.timestamps, true) !== null
    );
    return output ? first(output.values, output.timestamps, false) : fallback;
  }
  return {
    update(next: readonly TechnicalRenderOutput[], owned: ReadonlyMap<string, Series>) {
      outputs = next;
      series = owned;
    },
    project(instanceId: string, paneKey: string, value: number, fallback?: Series): number | null {
      const result = owner(instanceId, paneKey, fallback)?.priceToCoordinate(value);
      return typeof result === "number" && Number.isFinite(result) ? result : null;
    },
    autoscale(
      instanceId: string,
      paneKey: string,
      ownBase: () => number | null,
      fallback: number | null,
      original: AutoscaleInfoProvider,
      modeValue?: () => number
    ): AutoscaleInfoProvider {
      return (source) => {
        const info = original(source);
        if (!info?.priceRange) return null;
        const mode = modeValue?.() ?? owner(instanceId, paneKey)?.priceScale().options().mode ?? 0;
        if (mode !== 2 && mode !== 3) return info;
        const common = base(instanceId, paneKey, fallback),
          own = ownBase();
        if (common === null || own === null) return null;
        const min = referenceRelativeValue(info.priceRange.minValue, own, common, mode),
          max = referenceRelativeValue(info.priceRange.maxValue, own, common, mode);
        return min === null || max === null
          ? null
          : { ...info, priceRange: { minValue: min, maxValue: max } };
      };
    },
    first
  };
}

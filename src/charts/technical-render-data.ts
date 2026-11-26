import type { Candle } from "../model/types.js";
import { technicalIndicatorGroups } from "../model/technical-indicator-layout.js";
import type { TechnicalPanePreference } from "../model/technical-indicator-layout.js";
import { calculateTechnicalIndicator } from "../model/technical-indicators/runtime.js";
import { isVolumeDeltaStudy } from "../model/technical-indicators/catalog-expansion/volume-delta.js";
import { getTechnicalIndicatorDefinition } from "../model/technical-indicators/definitions.js";
import { isTechnicalIndicatorInstance } from "../model/technical-indicators/instances.js";
import { compilePresentation } from "../model/technical-indicators/presentation.js";
import type {
  CompiledPresentationFill,
  CompiledPresentationPlot
} from "../model/technical-indicators/presentation-types.js";
import type { CompiledReferenceLevel } from "../model/technical-indicators/presentation-types.js";
import { compileTechnicalPriceRegions } from "./technical-calendar-paint.js";
import type { RenderedPriceDecoration } from "./technical-calendar-paint.js";
import { technicalPlotData } from "./technical-plot-offsets.js";
import type { TechnicalSupplementalInputs } from "./adapter.js";
import type { VisibleAverageRange } from "../model/technical-indicators/ta-batch-anchored.js";
import type {
  OutputStyle,
  TechnicalCalculationContext,
  TechnicalIndicatorInstance,
  TechnicalIndicatorResult
} from "../model/technical-indicators/types.js";

export interface TechnicalRenderOutput {
  key: string;
  instanceId: string;
  paneKey: string;
  outputId: string;
  kind: "line" | "histogram";
  style: OutputStyle & { opacity: number; lineStyle: "solid" | "dashed" | "dotted" };
  order: number;
  levels: readonly number[];
  timestamps: readonly number[];
  values: readonly (number | null)[];
  presentation?: CompiledPresentationPlot;
}
export interface TechnicalRenderFill extends CompiledPresentationFill {
  readonly key: string;
  readonly instanceId: string;
  readonly paneKey: string;
  readonly order: number;
  readonly timestamps: readonly number[];
  readonly scalePlotKey: string;
}
export interface TechnicalRenderReference extends CompiledReferenceLevel {
  readonly key: string;
  readonly instanceId: string;
  readonly paneKey: string;
  readonly order: number;
  readonly timestamps: readonly number[];
}

const auxiliaryStudyIds = new Set<string>([
  "correlation-coefficient",
  "pivot-points-standard",
  "multi-time-period-charts",
  "booker-intraday-pivots",
  "booker-missed-pivots",
  "booker-ziv-ghost-pivots",
  "seasonality",
  "price-target",
  "auto-key-levels"
]);
/** Per-adapter cache, keyed by the independent asynchronous and viewport inputs used by a study. */
export class TechnicalRenderData {
  private bars: readonly Candle[] = [];
  private readonly cache = new Map<string, TechnicalIndicatorResult>();
  private readonly context: TechnicalCalculationContext | undefined;
  private visibleRange: VisibleAverageRange | undefined;
  private supplemental: TechnicalSupplementalInputs = {};
  private openInterestRevision = 0;
  private volumeRevision = 0;
  private intrabarRevision = 0;
  private supplementalRevision = 0;
  constructor(context?: TechnicalCalculationContext) {
    this.context = context ? { ...context } : undefined;
  }
  setData(bars: readonly Candle[]): void {
    this.bars = bars;
    this.cache.clear();
  }
  setSupplementalInputs(
    inputs: TechnicalSupplementalInputs,
    instrumentUid: string | null
  ): boolean {
    const { openInterest, volumeStudies } = inputs;
    const {
      correlationHistory,
      priceLevelPeriods,
      bookerPivotPeriods,
      seasonalityHistory,
      priceTarget,
      autoKeyLevelTrades
    } = inputs.instrumentUid === instrumentUid ? inputs : {};
    const { turnover24Hours, intrabarVolume, relativeVolumePeriods, netVolumeTrades } =
      volumeStudies ?? {};
    const scoped: TechnicalSupplementalInputs = {
      ...(openInterest?.instrumentKey === instrumentUid ? { openInterest } : {}),
      ...(correlationHistory?.primaryUid === instrumentUid ? { correlationHistory } : {}),
      ...(priceLevelPeriods ? { priceLevelPeriods } : {}),
      ...(bookerPivotPeriods ? { bookerPivotPeriods } : {}),
      ...(seasonalityHistory ? { seasonalityHistory } : {}),
      ...(priceTarget?.forecast.instrumentKey === instrumentUid ? { priceTarget } : {}),
      ...(autoKeyLevelTrades?.instrumentKey === instrumentUid ? { autoKeyLevelTrades } : {}),
      ...(volumeStudies
        ? {
            volumeStudies: {
              ...(relativeVolumePeriods ? { relativeVolumePeriods } : {}),
              ...(turnover24Hours?.instrumentKey === instrumentUid ? { turnover24Hours } : {}),
              ...(netVolumeTrades?.instrumentKey === instrumentUid ? { netVolumeTrades } : {}),
              ...(intrabarVolume?.instrumentKey === instrumentUid ? { intrabarVolume } : {})
            }
          }
        : {})
    };
    const interestChanged = scoped.openInterest !== this.supplemental.openInterest;
    const previousVolume = this.supplemental.volumeStudies;
    const volumeChanged =
      scoped.volumeStudies?.turnover24Hours !== previousVolume?.turnover24Hours ||
      scoped.volumeStudies?.relativeVolumePeriods !== previousVolume?.relativeVolumePeriods ||
      scoped.volumeStudies?.netVolumeTrades !== previousVolume?.netVolumeTrades;
    const intrabarChanged = scoped.volumeStudies?.intrabarVolume !== previousVolume?.intrabarVolume;
    const supplementalChanged =
      scoped.correlationHistory !== this.supplemental.correlationHistory ||
      scoped.priceLevelPeriods !== this.supplemental.priceLevelPeriods ||
      scoped.bookerPivotPeriods !== this.supplemental.bookerPivotPeriods ||
      scoped.seasonalityHistory !== this.supplemental.seasonalityHistory ||
      scoped.priceTarget !== this.supplemental.priceTarget ||
      scoped.autoKeyLevelTrades !== this.supplemental.autoKeyLevelTrades;
    if (interestChanged) this.openInterestRevision++;
    if (volumeChanged) this.volumeRevision++;
    if (intrabarChanged) this.intrabarRevision++;
    if (supplementalChanged) this.supplementalRevision++;
    this.supplemental = scoped;
    return interestChanged || volumeChanged || intrabarChanged || supplementalChanged;
  }
  setVisibleBars(first: number, last: number): boolean {
    const from = this.bars[Math.max(0, Math.ceil(first))]?.timestamp;
    const to = this.bars[Math.min(this.bars.length - 1, Math.floor(last))]?.timestamp;
    const next = from !== undefined && to !== undefined && from <= to ? { from, to } : undefined;
    if (next?.from === this.visibleRange?.from && next?.to === this.visibleRange?.to) return false;
    this.visibleRange = next;
    return true;
  }
  compile(
    instances: readonly TechnicalIndicatorInstance[],
    layout: readonly TechnicalPanePreference[] = []
  ) {
    const seen = new Set<string>();
    const groups = technicalIndicatorGroups(instances.filter(isTechnicalIndicatorInstance), layout);
    const outputs: TechnicalRenderOutput[] = [];
    const fills: TechnicalRenderFill[] = [];
    const references: TechnicalRenderReference[] = [];
    const priceRegions: RenderedPriceDecoration[] = [];
    let order = 0;
    for (const group of groups)
      for (const instance of group.instances) {
        const definition = getTechnicalIndicatorDefinition(instance.definitionId);
        if (definition?.status !== "computed") continue;
        const range =
          instance.definitionId === "visible-average-price" ? this.visibleRange : undefined;
        const externalKey =
          instance.definitionId === "open-interest"
            ? this.openInterestRevision
            : instance.definitionId === "relative-volume-at-time" ||
                instance.definitionId === "volume-24-hours" ||
                instance.definitionId === "net-volume"
              ? this.volumeRevision
              : isVolumeDeltaStudy(instance.definitionId)
                ? this.intrabarRevision
                : auxiliaryStudyIds.has(instance.definitionId)
                  ? this.supplementalRevision
                  : null;
        const key = JSON.stringify([instance.definitionId, instance.params, range, externalKey]);
        seen.add(key);
        let result = this.cache.get(key);
        if (!result) {
          const context =
            this.context && (range || externalKey !== null)
              ? { ...this.context, ...this.supplemental, ...(range ? { visibleRange: range } : {}) }
              : this.context;
          result = calculateTechnicalIndicator(instance, this.bars, context);
          this.cache.set(key, result);
        }
        if (instance.visible && group.key === "price" && result.priceRegions?.length)
          priceRegions.push(
            ...compileTechnicalPriceRegions(
              result.priceRegions,
              definition.priceRegionStyles ?? [],
              instance.styles
            )
          );
        const plotted =
          instance.visible && !group.preference?.collapsed
            ? technicalPlotData(result, this.context)
            : result;
        const presentation = definition.presentation
          ? compilePresentation(definition.presentation, {
              timestamps: plotted.timestamps,
              series: plotted.series,
              ...(instance.styles ? { styles: instance.styles } : {}),
              visible: instance.visible,
              collapsed: group.preference?.collapsed ?? false
            })
          : undefined;
        if (
          presentation &&
          (presentation.plots.length !== definition.outputs.length ||
            definition.outputs.some(
              (output) =>
                !presentation.plots.some(
                  (plot) =>
                    plot.id === output.id &&
                    (plot.geometry.kind === "columns") === (output.kind === "histogram")
                )
            ))
        )
          throw new RangeError("TA presentation plots must match declared visible outputs");
        for (const output of definition.outputs) {
          const custom = instance.styles?.[output.id],
            plot = presentation?.plots.find((item) => item.id === output.id);
          outputs.push({
            key: `${instance.id}/${output.id}`,
            instanceId: instance.id,
            paneKey: group.key,
            outputId: output.id,
            kind: output.kind,
            order: order++,
            levels: group.key === "price" ? [] : definition.levels,
            style: {
              color:
                plot?.color.kind === "solid" ? plot.color.color : (custom?.color ?? output.color),
              width: plot?.width ?? custom?.width ?? 1,
              opacity: plot?.opacity ?? custom?.opacity ?? 1,
              lineStyle: plot?.lineStyle ?? custom?.lineStyle ?? "solid",
              visible:
                plot?.visible ??
                (instance.visible && (custom?.visible ?? true) && !group.preference?.collapsed)
            },
            timestamps: plotted.timestamps,
            values: plot?.values ?? plotted.series[output.id] ?? [],
            ...(plot ? { presentation: plot } : {})
          });
        }
        if (presentation?.fills.length) {
          for (const fill of presentation.fills) {
            const scalePlot =
              presentation.plots.find((plot) => plot.seriesKey === fill.toSeries) ??
              presentation.plots.find((plot) => plot.seriesKey === fill.fromSeries) ??
              presentation.plots[0];
            if (!scalePlot) throw new RangeError("TA fills require an owning plot scale");
            fills.push({
              ...fill,
              key: `${instance.id}/fill/${fill.id}`,
              instanceId: instance.id,
              paneKey: group.key,
              order: order++,
              timestamps: presentation.timestamps,
              scalePlotKey: `${instance.id}/${scalePlot.id}`
            });
          }
        }
        for (const level of presentation?.referenceLevels ?? [])
          references.push({
            ...level,
            key: `${instance.id}/reference/${level.id}`,
            instanceId: instance.id,
            paneKey: group.key,
            order: order++,
            timestamps: result.timestamps
          });
      }
    for (const key of this.cache.keys()) if (!seen.has(key)) this.cache.delete(key);
    return { groups, outputs, fills, references, priceRegions };
  }
  dispose(): void {
    this.bars = [];
    this.cache.clear();
  }
}

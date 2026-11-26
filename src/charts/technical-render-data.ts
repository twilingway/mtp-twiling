import type { Candle } from "../model/types.js";
import { technicalIndicatorGroups } from "../model/technical-indicator-layout.js";
import type { TechnicalPanePreference } from "../model/technical-indicator-layout.js";
import { calculateTechnicalIndicator } from "../model/technical-indicators/runtime.js";
import { getTechnicalIndicatorDefinition } from "../model/technical-indicators/definitions.js";
import { isTechnicalIndicatorInstance } from "../model/technical-indicators/instances.js";
import { compilePresentation } from "../model/technical-indicators/presentation.js";
import type {
  CompiledPresentationFill,
  CompiledPresentationPlot
} from "../model/technical-indicators/presentation-types.js";
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
/** Per-adapter cache: formulas depend on complete real input, never on the visible chart range. */
export class TechnicalRenderData {
  private bars: readonly Candle[] = [];
  private readonly cache = new Map<string, TechnicalIndicatorResult>();
  private readonly context: TechnicalCalculationContext | undefined;
  constructor(context?: TechnicalCalculationContext) {
    this.context = context ? { ...context } : undefined;
  }
  setData(bars: readonly Candle[]): void {
    this.bars = bars;
    this.cache.clear();
  }
  compile(
    instances: readonly TechnicalIndicatorInstance[],
    layout: readonly TechnicalPanePreference[] = []
  ) {
    const seen = new Set<string>();
    const groups = technicalIndicatorGroups(instances.filter(isTechnicalIndicatorInstance), layout);
    const outputs: TechnicalRenderOutput[] = [];
    const fills: TechnicalRenderFill[] = [];
    let order = 0;
    for (const group of groups)
      for (const instance of group.instances) {
        const definition = getTechnicalIndicatorDefinition(instance.definitionId);
        if (definition?.status !== "computed") continue;
        const key = JSON.stringify([instance.definitionId, instance.params]);
        seen.add(key);
        let result = this.cache.get(key);
        if (!result) {
          result = calculateTechnicalIndicator(instance, this.bars, this.context);
          this.cache.set(key, result);
        }
        const presentation = definition.presentation
          ? compilePresentation(definition.presentation, {
              timestamps: result.timestamps,
              series: result.series,
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
            timestamps: result.timestamps,
            values: plot?.values ?? result.series[output.id] ?? [],
            ...(plot ? { presentation: plot } : {})
          });
        }
        if (presentation?.fills.length) {
          const scalePlot = presentation.plots[0];
          if (!scalePlot) throw new RangeError("TA fills require an owning plot scale");
          for (const fill of presentation.fills)
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
    for (const key of this.cache.keys()) if (!seen.has(key)) this.cache.delete(key);
    return { groups, outputs, fills };
  }
  dispose(): void {
    this.bars = [];
    this.cache.clear();
  }
}

import type { Candle } from "../model/types.js";
import { technicalIndicatorGroups } from "../model/technical-indicator-layout.js";
import type { TechnicalPanePreference } from "../model/technical-indicator-layout.js";
import { calculateTechnicalIndicator } from "../model/technical-indicators/runtime.js";
import { getTechnicalIndicatorDefinition } from "../model/technical-indicators/definitions.js";
import { isTechnicalIndicatorInstance } from "../model/technical-indicators/instances.js";
import type {
  OutputStyle,
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
}
/** Per-adapter cache: formulas depend on complete real input, never on the visible chart range. */
export class TechnicalRenderData {
  private bars: readonly Candle[] = [];
  private readonly cache = new Map<string, TechnicalIndicatorResult>();
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
    let order = 0;
    for (const group of groups)
      for (const instance of group.instances) {
        const definition = getTechnicalIndicatorDefinition(instance.definitionId);
        if (definition?.status !== "computed") continue;
        const key = JSON.stringify([instance.definitionId, instance.params]);
        seen.add(key);
        let result = this.cache.get(key);
        if (!result) {
          result = calculateTechnicalIndicator(instance, this.bars);
          this.cache.set(key, result);
        }
        for (const output of definition.outputs) {
          const custom = instance.styles?.[output.id];
          outputs.push({
            key: `${instance.id}/${output.id}`,
            instanceId: instance.id,
            paneKey: group.key,
            outputId: output.id,
            kind: output.kind,
            order: order++,
            levels: group.key === "price" ? [] : definition.levels,
            style: {
              color: custom?.color ?? output.color,
              width: custom?.width ?? 1,
              opacity: custom?.opacity ?? 1,
              lineStyle: custom?.lineStyle ?? "solid",
              visible: instance.visible && (custom?.visible ?? true) && !group.preference?.collapsed
            },
            timestamps: result.timestamps,
            values: result.series[output.id] ?? []
          });
        }
      }
    for (const key of this.cache.keys()) if (!seen.has(key)) this.cache.delete(key);
    return { groups, outputs };
  }
  dispose(): void {
    this.bars = [];
    this.cache.clear();
  }
}

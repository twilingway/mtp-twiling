import { anchoredStudies } from "./anchored.js";
import { autoKeyLevelStudies } from "./auto-key-levels.js";
import { autoSlopedStudies } from "./auto-sloped.js";
import { averageStudies } from "./averages.js";
import { bandStudies } from "./bands.js";
import { bookerStudies } from "./booker.js";
import { bookerPivotStudies } from "./booker-pivots.js";
import { calendarAnalysisStudies } from "./calendar-analysis.js";
import { correlationStudies } from "./correlation.js";
import { externalStudies } from "./external.js";
import { knoxvilleStudies } from "./knoxville.js";
import { levelStudies } from "./levels.js";
import { marketBreadthStudies } from "./market-breadth.js";
import { momentumStudies } from "./momentum.js";
import { netVolumeStudy } from "./net-volume.js";
import { periodStudies } from "./period-studies.js";
import { priceTargetStudies } from "./price-target.js";
import { sessionStudies } from "./sessions.js";
import { trendStudies } from "./trend.js";
import { volumeStudies } from "./volume.js";
import { volumeDeltaStudies } from "./volume-delta.js";
import type {
  CatalogExpansionParameters,
  TechnicalBar,
  TechnicalCalculationContext,
  TechnicalIndicatorInstance,
  TechnicalIndicatorResult
} from "../types.js";

export const catalogExpansionStudies = [
  ...anchoredStudies,
  ...autoKeyLevelStudies,
  ...autoSlopedStudies,
  ...averageStudies,
  ...bandStudies,
  ...bookerStudies,
  ...bookerPivotStudies,
  ...calendarAnalysisStudies,
  ...correlationStudies,
  ...externalStudies,
  ...knoxvilleStudies,
  ...levelStudies,
  ...marketBreadthStudies,
  ...momentumStudies,
  netVolumeStudy,
  ...periodStudies,
  ...priceTargetStudies,
  ...sessionStudies,
  ...trendStudies,
  ...volumeStudies,
  ...volumeDeltaStudies
];
type CatalogStudy = (typeof catalogExpansionStudies)[number];
type CatalogInstance = Extract<
  TechnicalIndicatorInstance,
  { definitionId: keyof CatalogExpansionParameters }
>;
const byDefinition = new Map<string, CatalogStudy>(
  catalogExpansionStudies.map((study) => [study.definition.id, study])
);
const byCatalogId = new Map(
  catalogExpansionStudies.map((study) => [study.catalogId, study.definition.id])
);

export function catalogExpansionDefinitionId(catalogId: string) {
  return byCatalogId.get(catalogId);
}

export function isCatalogExpansionInstance(
  instance: TechnicalIndicatorInstance
): instance is CatalogInstance {
  return byDefinition.has(instance.definitionId);
}

export function catalogExpansionParamsValid(definitionId: string, params: object): boolean {
  return byDefinition.get(definitionId)?.validParams?.(params) ?? true;
}

function getStudy(instance: CatalogInstance): CatalogStudy {
  const study = byDefinition.get(instance.definitionId);
  if (!study) throw new RangeError("Unknown catalog study");
  return study;
}

export function catalogExpansionHistory(instance: CatalogInstance) {
  return getStudy(instance).history(instance.params);
}

export function catalogExpansionUnavailable(
  instance: CatalogInstance,
  barCount: number,
  context?: TechnicalCalculationContext
) {
  return getStudy(instance).unavailableReason?.(barCount, instance.params, context);
}

function emptySeries(study: CatalogStudy, count: number) {
  const { outputs, presentation } = study.definition;
  const constantKeys = new Set(presentation?.constantSeries?.map(({ seriesKey }) => seriesKey));
  const keys = presentation
    ? [...presentation.plots.map(({ seriesKey }) => seriesKey), ...presentation.hiddenSeries]
    : outputs.map(({ id }) => id);
  const empty = Array<null>(count).fill(null);
  return Object.fromEntries(
    keys.filter((key) => !constantKeys.has(key)).map((key) => [key, empty])
  );
}

export function calculateCatalogExpansion(
  instance: CatalogInstance,
  bars: readonly TechnicalBar[],
  context?: TechnicalCalculationContext
): TechnicalIndicatorResult {
  const study = getStudy(instance);
  const unavailableReason = study.unavailableReason?.(bars.length, instance.params, context);
  const history = study.history(instance.params);
  return {
    instanceId: instance.id,
    definitionId: instance.definitionId,
    status: "computed",
    timestamps: bars.map(({ timestamp }) => timestamp),
    ...history,
    ...(unavailableReason
      ? { unavailableReason, series: emptySeries(study, bars.length) }
      : {
          series: study.calculate(bars, instance.params, context),
          ...(study.priceRegions && {
            priceRegions: study.priceRegions(bars, instance.params, context)
          })
        }),
    ...(study.barOffsets && { barOffsets: study.barOffsets(instance.params) })
  };
}

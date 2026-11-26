import type {
  NumericSeries,
  TechnicalBar,
  TechnicalCalculationContext,
  TechnicalHistoryRequirement,
  TechnicalIndicatorDefinition,
  TechnicalIndicatorResult
} from "../types.js";
import type { TechnicalPriceDecoration } from "./calendar-geometry.js";

export interface CatalogStudyHistory {
  warmupBars: number | null;
  historyRequirement: TechnicalHistoryRequirement;
}

interface CatalogStudy<Id extends string, Params extends object> {
  catalogId: string;
  definition: Omit<TechnicalIndicatorDefinition, "id"> & { id: Id };
  validParams?(this: void, params: Params): boolean;
  history(params: Params): CatalogStudyHistory;
  barOffsets?(this: void, params: Params): Readonly<Record<string, number>>;
  unavailableReason?(
    this: void,
    barCount: number,
    params: Params,
    context?: TechnicalCalculationContext
  ): TechnicalIndicatorResult["unavailableReason"];
  calculate(
    bars: readonly TechnicalBar[],
    params: Params,
    context?: TechnicalCalculationContext
  ): Readonly<Record<string, NumericSeries>>;
  priceRegions?(
    this: void,
    bars: readonly TechnicalBar[],
    params: Params,
    context?: TechnicalCalculationContext
  ): readonly TechnicalPriceDecoration[];
}

// The registry accepts a validated instance, whose parameters match its definition ID.
export function defineCatalogStudy<Id extends string, Params extends object>(
  study: CatalogStudy<Id, Params>
): CatalogStudy<Id, object> {
  const { validParams, unavailableReason, barOffsets, priceRegions } = study;
  return {
    catalogId: study.catalogId,
    definition: study.definition,
    ...(validParams && { validParams: (params: object) => validParams(params as Params) }),
    history: (params) => study.history(params as Params),
    ...(barOffsets && { barOffsets: (params: object) => barOffsets(params as Params) }),
    ...(unavailableReason && {
      unavailableReason: (
        barCount: number,
        params: object,
        context?: TechnicalCalculationContext
      ) => unavailableReason(barCount, params as Params, context)
    }),
    calculate: (bars, params, context) => study.calculate(bars, params as Params, context),
    ...(priceRegions && {
      priceRegions: (
        bars: readonly TechnicalBar[],
        params: object,
        context?: TechnicalCalculationContext
      ) => priceRegions(bars, params as Params, context)
    })
  };
}

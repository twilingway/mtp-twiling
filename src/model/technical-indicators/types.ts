import type {
  RelativeRegisteredId,
  RelativeRegisteredParameters,
  RelativeRegisteredHistory
} from "./relative-registration-contract.js";
import type { CumulativeHistoryRequirement } from "./momentum-volume/metadata.js";
import type { VolumeFlowHistoryRequirement, VolumeFlowId } from "./volume-flow/metadata.js";
import type { VolumeAverage } from "./volume-flow/parameters.js";
import type { PresentationDefinition } from "./presentation-types.js";
import type { KeltnerParameters, KeltnerHistoryRequirement } from "./keltner-contract.js";
import type { TrendPriceId, TrendPriceHistoryRequirement } from "./trend-price-contract.js";
import type {
  ChannelPriceId,
  ChannelPriceParameters,
  ChannelPriceHistoryRequirement
} from "./channel-average-contract.js";
import type {
  StateOscillatorId,
  StateOscillatorHistoryRequirement
} from "./state-oscillator-contract.js";
import type { IntervalId } from "../intervals/registry.js";
import type { OpenInterestObservations } from "./ta-batch-external.js";
import type {
  AnchoredIndicatorContext,
  AnchoredStudyHistory
} from "./catalog-expansion/anchored-context.js";
import type { AnchoredStudyParameters } from "./catalog-expansion/anchored.js";
import type { AverageStudyParameters } from "./catalog-expansion/averages.js";
import type { BandStudyParameters } from "./catalog-expansion/bands.js";
import type { BookerStudyParameters } from "./catalog-expansion/booker.js";
import type { ExternalStudyParameters } from "./catalog-expansion/external.js";
import type { LevelStudyParameters } from "./catalog-expansion/levels.js";
import type { MomentumStudyParameters } from "./catalog-expansion/momentum.js";
import type { SessionStudyParameters } from "./catalog-expansion/sessions.js";
import type {
  RankCorrelationWindowHistory,
  TrendStudyParameters
} from "./catalog-expansion/trend.js";
import type {
  RelativeVolumeHistoryRequirement,
  VolumeStudyData,
  VolumeStudyParameters
} from "./catalog-expansion/volume.js";
import type { QuoteTurnoverHistoryRequirement } from "./ta-batch-volume-flow-turnover.js";
import type {
  TechnicalPriceDecoration,
  CalendarRegionHistoryRequirement
} from "./catalog-expansion/calendar-geometry.js";

export interface CatalogExpansionParameters
  extends
    AnchoredStudyParameters,
    AverageStudyParameters,
    BandStudyParameters,
    BookerStudyParameters,
    ExternalStudyParameters,
    LevelStudyParameters,
    MomentumStudyParameters,
    SessionStudyParameters,
    TrendStudyParameters,
    VolumeStudyParameters {}

export type NumericValue = number | null;
export type NumericSeries = readonly NumericValue[];
export type TechnicalIndicatorId =
  | "sma"
  | "ema"
  | "rsi"
  | "macd"
  | "bollinger-bands"
  | "atr"
  | "stochastic"
  | "wma"
  | "vwma"
  | "dema"
  | "tema"
  | "hma"
  | "smma"
  | "momentum"
  | "roc"
  | "cci"
  | "williams-r"
  | "mfi"
  | "obv"
  | "adl"
  | "pvt"
  | "bollinger-percent-b"
  | "bollinger-bandwidth"
  | "historical-volatility"
  | "awesome-oscillator"
  | "balance-of-power"
  | "cmo"
  | "ultimate-oscillator"
  | "trix"
  | "aroon"
  | "aroon-oscillator"
  | "dmi"
  | "adx"
  | "vortex"
  | "choppiness-index"
  | VolumeFlowId
  | StateOscillatorId
  | TrendPriceId
  | ChannelPriceId
  | "keltner-channels"
  | RelativeRegisteredId
  | keyof CatalogExpansionParameters;
export type PriceSource = "open" | "high" | "low" | "close" | "hl2" | "hlc3" | "ohlc4" | "volume";
export interface TechnicalBar {
  readonly timestamp: number;
  readonly open: NumericValue;
  readonly high: NumericValue;
  readonly low: NumericValue;
  readonly close: NumericValue;
  readonly volume: NumericValue;
}
export interface TechnicalParameters
  extends ChannelPriceParameters, RelativeRegisteredParameters, CatalogExpansionParameters {
  "keltner-channels": KeltnerParameters;
  "parabolic-sar": { start: number; increment: number; maximum: number };
  supertrend: { atrLength: number; factor: number };
  tsi: { longLength: number; shortLength: number; signalLength: number };
  kst: {
    roc1Length: number;
    roc2Length: number;
    roc3Length: number;
    roc4Length: number;
    sma1Length: number;
    sma2Length: number;
    sma3Length: number;
    sma4Length: number;
    signalLength: number;
  };
  "fisher-transform": { length: number };
  cmf: { length: number };
  "chaikin-oscillator": { fastLength: number; slowLength: number };
  efi: { length: number };
  eom: { length: number; divisor: number };
  "volume-oscillator": {
    fastLength: number;
    slowLength: number;
    signalLength: number;
    oscillatorAverage: VolumeAverage;
    signalAverage: VolumeAverage;
  };
  nvi: { emaLength: number };
  pvi: { emaLength: number };
  aroon: { length: number };
  "aroon-oscillator": { length: number };
  dmi: { diLength: number; adxSmoothing: number };
  adx: { diLength: number; adxSmoothing: number };
  vortex: { length: number };
  "choppiness-index": { length: number };
  "bollinger-percent-b": { length: number; multiplier: number; source: PriceSource };
  "bollinger-bandwidth": {
    length: number;
    multiplier: number;
    source: PriceSource;
    expansionLength: number;
    contractionLength: number;
  };
  "historical-volatility": { length: number };
  "awesome-oscillator": Record<string, never>;
  "balance-of-power": Record<string, never>;
  cmo: { length: number; source: PriceSource };
  "ultimate-oscillator": { fastLength: number; middleLength: number; slowLength: number };
  trix: { length: number };
  momentum: { length: number; source: PriceSource };
  roc: { length: number; source: PriceSource };
  cci: { length: number; source: PriceSource };
  "williams-r": { length: number; source: PriceSource };
  mfi: { length: number };
  obv: Record<string, never>;
  adl: Record<string, never>;
  pvt: Record<string, never>;
  wma: { length: number; source: PriceSource };
  vwma: { length: number; source: PriceSource };
  dema: { length: number; source: PriceSource };
  tema: { length: number; source: PriceSource };
  hma: { length: number; source: PriceSource };
  smma: { length: number; source: PriceSource };
  sma: { length: number; source: PriceSource };
  ema: { length: number; source: PriceSource };
  rsi: { length: number; source: PriceSource };
  macd: { fastLength: number; slowLength: number; signalLength: number; source: PriceSource };
  "bollinger-bands": { length: number; multiplier: number; source: PriceSource };
  atr: { length: number };
  stochastic: { length: number; smoothK: number; smoothD: number };
}
export interface OutputStyle {
  color: string;
  width: number;
  visible: boolean;
  opacity?: number;
  lineStyle?: "solid" | "dashed" | "dotted";
}
export type IndicatorPane = { kind: "overlay" } | { kind: "pane"; id: string };
export type TechnicalIndicatorInstance = {
  [K in TechnicalIndicatorId]: {
    schemaVersion: 1;
    id: string;
    definitionId: K;
    params: TechnicalParameters[K];
    pane: IndicatorPane;
    visible: boolean;
    order: number;
    styles?: Record<string, OutputStyle>;
  };
}[TechnicalIndicatorId];
export type ParameterDefinition =
  | { key: string; type: "integer" | "number"; defaultValue: number; min: number; max: number }
  | { key: string; type: "source"; defaultValue: PriceSource }
  | { key: string; type: "text"; defaultValue: string; maxLength: number; format?: "time" }
  | { key: string; type: "boolean"; defaultValue: boolean }
  | { key: string; type: "choice"; defaultValue: string; choices: readonly [string, ...string[]] };
export interface TechnicalOutputDefinition {
  id: string;
  title: string;
  kind: "line" | "histogram";
  color: string;
}
export interface TechnicalIndicatorDefinition {
  schemaVersion: 1;
  id: TechnicalIndicatorId;
  title: string;
  shortTitle: string;
  status: "computed";
  defaultPane: "overlay" | "pane";
  parameters: readonly ParameterDefinition[];
  outputs: readonly TechnicalOutputDefinition[];
  levels: readonly number[];
  references: readonly string[];
  /** Runtime-only drawing metadata. Never serialized as indicator instance preferences. */
  presentation?: PresentationDefinition;
  priceRegionStyles?: readonly { id: string; title: string; color: string; opacity: number }[];
  attribution?: { line: string; url: string };
}
export interface UnsupportedIndicatorDefinition {
  schemaVersion: 1;
  id: string;
  title: string;
  status: "unsupported";
  reason: string;
  requiredData: readonly string[];
}
export interface TechnicalIndicatorResult {
  instanceId: string;
  definitionId: TechnicalIndicatorId;
  status: "computed";
  timestamps: readonly number[];
  series: Readonly<Record<string, NumericSeries>>;
  /** Minimum observations, not convergence history; null means no history can yield a finite output for these parameters. */
  warmupBars: number | null;
  /** Present only when the parameters make every output mathematically undefined. */
  alwaysUndefined?: true;
  /** Runtime only; absent from legacy and available results. Never an instance/backup field. */
  unavailableReason?: "volume-unavailable" | "calculation-limit" | "external-data-unavailable";
  barOffsets?: Readonly<Record<string, number>>;
  priceRegions?: readonly TechnicalPriceDecoration[];
  historyRequirement: TechnicalHistoryRequirement;
}
/** Explicit current-timeframe context; never persisted in indicator instances or inferred from bars. */
export interface TechnicalCalculationContext extends AnchoredIndicatorContext {
  readonly historicalVolatilityPeriodsPerYear: number;
  readonly chartInterval?: IntervalId;
  readonly exchangeTimeZone?: string;
  readonly priceStep?: number;
  readonly lastBarClosed?: boolean;
  readonly volumeStudies?: VolumeStudyData;
  readonly openInterest?: OpenInterestObservations;
}
export type LegacyRecursiveHistoryRequirement = {
  kind: "recursive";
  lookbackBars: null;
  seedBars: number;
  seedPolicy:
    | "first-non-null"
    | "sma-of-first-length"
    | "adjacent-change-wilder"
    | "first-value-ema-chain"
    | "true-range-wilder"
    | "prior-price-after-efficiency-window"
    | "first-nonzero"
    | "alternating-confirmed-extrema";
  convergence: "full-input-dependent";
};
export type TechnicalHistoryRequirement =
  | {
      kind: "finite";
      lookbackBars: number;
      seedPolicy: "window";
      convergence: "exact-after-lookback";
    }
  | LegacyRecursiveHistoryRequirement
  /** Reviewed accumulation policy; never substitute an EMA/recursive seed. */
  | CumulativeHistoryRequirement
  | VolumeFlowHistoryRequirement
  | StateOscillatorHistoryRequirement
  | TrendPriceHistoryRequirement
  | ChannelPriceHistoryRequirement
  | KeltnerHistoryRequirement
  | RelativeRegisteredHistory
  | RankCorrelationWindowHistory
  | AnchoredStudyHistory
  | CalendarRegionHistoryRequirement
  | RelativeVolumeHistoryRequirement
  | QuoteTurnoverHistoryRequirement;

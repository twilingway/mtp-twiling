import type { CumulativeHistoryRequirement } from "./momentum-volume/metadata.js";

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
  | "choppiness-index";
export type PriceSource = "open" | "high" | "low" | "close" | "hl2" | "hlc3" | "ohlc4" | "volume";
export interface TechnicalBar {
  readonly timestamp: number;
  readonly open: NumericValue;
  readonly high: NumericValue;
  readonly low: NumericValue;
  readonly close: NumericValue;
  readonly volume: NumericValue;
}
export interface TechnicalParameters {
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
  | { key: string; type: "source"; defaultValue: PriceSource };
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
  historyRequirement: TechnicalHistoryRequirement;
}
/** Explicit current-timeframe context; never persisted in indicator instances or inferred from bars. */
export interface TechnicalCalculationContext {
  readonly historicalVolatilityPeriodsPerYear: number;
}
export type TechnicalHistoryRequirement =
  | {
      kind: "finite";
      lookbackBars: number;
      seedPolicy: "window";
      convergence: "exact-after-lookback";
    }
  | {
      kind: "recursive";
      lookbackBars: null;
      seedBars: number;
      seedPolicy:
        | "first-non-null"
        | "sma-of-first-length"
        | "adjacent-change-wilder"
        | "first-value-ema-chain"
        | "true-range-wilder";
      convergence: "full-input-dependent";
    }
  /** Reviewed accumulation policy; never substitute an EMA/recursive seed. */
  | CumulativeHistoryRequirement;

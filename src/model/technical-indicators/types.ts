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
  | "smma";
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
  /** Minimum observations before every output can have a value; not convergence history. */
  warmupBars: number;
  historyRequirement: TechnicalHistoryRequirement;
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
    };

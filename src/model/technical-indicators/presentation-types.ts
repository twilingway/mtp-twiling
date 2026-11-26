import type { NumericSeries, OutputStyle } from "./types.js";

export type PlotSize = 1 | 2 | 3 | 4;
export type PlotPrecisionPolicy = "legacy-fixed-6" | "native-price" | "fixed-2";
export type PlotColorPolicy =
  | { readonly kind: "solid"; readonly color: string }
  | { readonly kind: "palette"; readonly id: "macd-sign-change-v1" | "ao-change-v1" };
export type PlotGeometry =
  | { readonly kind: "line"; readonly gaps: "legacy" | "break" }
  | { readonly kind: "columns"; readonly base: 0 }
  | {
      readonly kind: "cross";
      readonly size: { readonly unit: "pine-relative"; readonly value: PlotSize };
    };
export interface PresentationPlot {
  readonly id: string;
  readonly seriesKey: string;
  readonly geometry: PlotGeometry;
  readonly color: PlotColorPolicy;
  readonly width: PlotSize;
}
export interface PresentationFill {
  readonly id: string;
  readonly fromSeries: string;
  readonly toSeries: string;
  readonly color: string;
  readonly opacity: number;
  readonly gaps: "break";
  readonly extent?: "pane";
}
export interface PresentationReferenceLevel {
  readonly id: string;
  readonly title: string;
  readonly value: number;
  readonly color: string;
  readonly opacity: number;
  readonly width: PlotSize;
  readonly lineStyle: "solid" | "dashed" | "dotted";
}
export interface CompiledReferenceLevel extends PresentationReferenceLevel {
  readonly visible: boolean;
  readonly scale: "include-when-visible";
  readonly precisionPolicy: PlotPrecisionPolicy;
}
/** Runtime metadata only. This version is never an instance or backup schema version. */
export interface PresentationDefinition {
  readonly renderVersion: 2;
  /** Semantic owner/companion policy, independent of current pane or glyph. */
  readonly precisionPolicy?: PlotPrecisionPolicy;
  readonly plots: readonly PresentationPlot[];
  readonly fills: readonly PresentationFill[];
  readonly hiddenSeries: readonly string[];
  readonly constantSeries?: readonly { readonly seriesKey: string; readonly value: number }[];
  readonly referenceLevels?: readonly PresentationReferenceLevel[];
}
export interface PresentationInput {
  readonly timestamps: readonly number[];
  readonly series: Readonly<Record<string, NumericSeries>>;
  readonly styles?: Readonly<Record<string, OutputStyle>>;
  readonly visible: boolean;
  readonly collapsed: boolean;
}
export interface CompiledPresentationPlot extends PresentationPlot {
  readonly precisionPolicy: PlotPrecisionPolicy;
  readonly values: NumericSeries;
  readonly opacity: number;
  readonly lineStyle: "solid" | "dashed" | "dotted";
  readonly visible: boolean;
  readonly scale: "include-when-visible";
}
export interface CompiledPresentationFill extends PresentationFill {
  readonly precisionPolicy: PlotPrecisionPolicy;
  readonly from: NumericSeries;
  readonly to: NumericSeries;
  readonly visible: boolean;
  readonly scale: "none";
}
export interface CompiledPresentation {
  readonly renderVersion: 2;
  readonly timestamps: readonly number[];
  readonly plots: readonly CompiledPresentationPlot[];
  readonly fills: readonly CompiledPresentationFill[];
  readonly referenceLevels?: readonly CompiledReferenceLevel[];
}
export interface IndexedRun {
  readonly first: number;
  readonly last: number;
}

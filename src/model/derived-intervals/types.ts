/** Unix milliseconds; all ranges are half-open and minute-aligned. */
export interface MinuteRange {
  readonly start: number;
  readonly end: number;
}

export type DerivedMinuteTarget = 4 | 6 | 7 | 8 | 9 | 45 | 180;
export type SourceFinality = "final" | "forming" | "unknown";

/** Actual normalized source snapshots, never generated prices or missing-minute placeholders. */
export interface MinuteSourceBar {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly finality: SourceFinality;
}

export interface SuppliedMinuteSession extends MinuteRange {
  readonly anchor: number;
  readonly openWindows: readonly MinuteRange[];
}

export type CoverageEvidence = "exhaustive" | "partial" | "unknown";

export interface MinuteCoverage extends MinuteRange {
  readonly evidence: CoverageEvidence;
}

export interface DerivedMinuteRequest {
  readonly baseInterval: "1m";
  readonly targetMinutes: DerivedMinuteTarget;
  readonly bars: readonly MinuteSourceBar[];
  readonly sessions: readonly SuppliedMinuteSession[] | { readonly kind: "unknown" };
  readonly coverage: readonly MinuteCoverage[];
  /** Caller snapshot instant. Future starts and final source ends after asOf are rejected. */
  readonly asOf: number;
}

export interface DerivedMinuteQuality {
  readonly status: "open" | "complete" | "incomplete" | "unknown";
  readonly expectedMinutes: number;
  readonly sourceMinutes: number;
  readonly missingSourceMinutes: number;
  readonly exhaustiveMinutes: number;
  readonly partialCoverageMinutes: number;
  /** Includes explicitly unknown spans and minutes without any coverage evidence. */
  readonly unknownCoverageMinutes: number;
  readonly finalSourceMinutes: number;
  readonly formingSourceMinutes: number;
  readonly unknownFinalityMinutes: number;
}

export interface DerivedMinuteBar {
  readonly timestamp: number;
  readonly endTimestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly quality: DerivedMinuteQuality;
}

export type DerivedMinuteErrorCode =
  | "unsupported-source"
  | "unsupported-target"
  | "unsupported-session"
  | "invalid-input"
  | "invalid-time"
  | "invalid-order"
  | "invalid-source"
  | "outside-open-window"
  | "future-source"
  | "arithmetic-overflow"
  | "resource-limit";

export class DerivedMinuteError extends RangeError {
  constructor(
    readonly code: DerivedMinuteErrorCode,
    message: string
  ) {
    super(message);
    this.name = "DerivedMinuteError";
  }
}

/** Local work protection only; these are not provider request limits. */
export const DERIVED_MINUTE_LIMITS = Object.freeze({
  sourceBars: 250_000,
  sessions: 10_000,
  openWindows: 100_000,
  coverageSpans: 100_000,
  sessionMilliseconds: 366 * 86_400_000
});

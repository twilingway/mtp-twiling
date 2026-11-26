import {
  DERIVED_MINUTE_LIMITS,
  DerivedMinuteError,
  type DerivedMinuteErrorCode,
  type DerivedMinuteRequest,
  type MinuteRange,
  type SuppliedMinuteSession
} from "./types";

export const MINUTE_MS = 60_000;
const MAX_INSTANT = 8_640_000_000_000_000;

export function fail(code: DerivedMinuteErrorCode, message: string): never {
  throw new DerivedMinuteError(code, message);
}

export function safeInteger(value: number): number {
  if (!Number.isSafeInteger(value)) fail("arithmetic-overflow", "Unsafe timestamp arithmetic");
  return value;
}

function instant(value: number, aligned: boolean): void {
  if (
    !Number.isSafeInteger(value) ||
    Math.abs(value) > MAX_INSTANT ||
    (aligned && value % MINUTE_MS !== 0)
  )
    fail(
      "invalid-time",
      "Expected a valid Unix millisecond instant with required minute alignment"
    );
}

function range(value: MinuteRange): void {
  if (!value || typeof value !== "object") fail("invalid-input", "Expected a minute range");
  instant(value.start, true);
  instant(value.end, true);
  if (value.start >= value.end) fail("invalid-time", "Expected a nonempty half-open range");
  safeInteger(value.end - value.start);
}

function arrayLimit(value: readonly unknown[], maximum: number): void {
  if (!Array.isArray(value)) fail("invalid-input", "Expected an explicit array");
  if (value.length > maximum) fail("resource-limit", "Local input count limit exceeded");
}

/** Validates all inputs, including empty-source calls, without normalizing or mutating them. */
export function validateRequest(request: DerivedMinuteRequest): readonly SuppliedMinuteSession[] {
  if (!request || typeof request !== "object") fail("invalid-input", "Expected a request");
  if (request.baseInterval !== "1m")
    fail("unsupported-source", "Only normalized 1m source supported");
  if (![4, 6, 7, 8, 9, 45, 180].includes(request.targetMinutes))
    fail("unsupported-target", "Unsupported fixed-minute target");
  instant(request.asOf, false);
  if (!Array.isArray(request.sessions))
    fail("unsupported-session", "Explicit supplied sessions and open windows are required");
  const sessions: readonly SuppliedMinuteSession[] = request.sessions;
  arrayLimit(sessions, DERIVED_MINUTE_LIMITS.sessions);
  arrayLimit(request.bars, DERIVED_MINUTE_LIMITS.sourceBars);
  arrayLimit(request.coverage, DERIVED_MINUTE_LIMITS.coverageSpans);
  let previousEnd = -Infinity;
  let windowCount = 0;
  for (const session of sessions) {
    range(session);
    instant(session.anchor, true);
    if (session.start < previousEnd) fail("invalid-order", "Sessions must be sorted and disjoint");
    if (session.anchor > session.start)
      fail("invalid-time", "Anchor must not follow session start");
    safeInteger(session.start - session.anchor);
    safeInteger(session.end - session.anchor);
    if (session.end - session.start > DERIVED_MINUTE_LIMITS.sessionMilliseconds)
      fail("resource-limit", "Local session duration limit exceeded");
    arrayLimit(session.openWindows, DERIVED_MINUTE_LIMITS.openWindows);
    windowCount += session.openWindows.length;
    if (windowCount > DERIVED_MINUTE_LIMITS.openWindows)
      fail("resource-limit", "Local total open-window limit exceeded");
    let windowEnd = session.start;
    for (const window of session.openWindows) {
      range(window);
      if (window.start < session.start || window.end > session.end)
        fail("invalid-time", "Open windows must be contained in their supplied session");
      if (window.start < windowEnd)
        fail("invalid-order", "Open windows must be sorted and disjoint");
      windowEnd = window.end;
    }
    previousEnd = session.end;
  }
  previousEnd = -Infinity;
  for (const coverage of request.coverage) {
    range(coverage);
    if (coverage.start < previousEnd) fail("invalid-order", "Coverage must be sorted and disjoint");
    if (!["exhaustive", "partial", "unknown"].includes(coverage.evidence))
      fail("invalid-input", "Coverage evidence must be explicit");
    previousEnd = coverage.end;
  }
  let previousTimestamp = -Infinity;
  for (const bar of request.bars) {
    if (!bar || typeof bar !== "object") fail("invalid-source", "Expected a source snapshot");
    instant(bar.timestamp, true);
    if (bar.timestamp <= previousTimestamp)
      fail("invalid-order", "Source timestamps must be strictly ascending and unique");
    if (
      ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) ||
      bar.volume < 0 ||
      bar.high < Math.max(bar.open, bar.close, bar.low) ||
      bar.low > Math.min(bar.open, bar.close)
    )
      fail("invalid-source", "Invalid finite source OHLCV");
    if (!["final", "forming", "unknown"].includes(bar.finality))
      fail("invalid-source", "Source finality must be explicit");
    if (
      bar.timestamp > request.asOf ||
      (bar.finality === "final" && safeInteger(bar.timestamp + MINUTE_MS) > request.asOf)
    )
      fail("future-source", "Source snapshot contradicts the supplied asOf");
    previousTimestamp = bar.timestamp;
  }
  return sessions;
}

/** Index of the first range whose exclusive end is after timestamp. */
export function firstEndingAfter(ranges: readonly MinuteRange[], timestamp: number): number {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (ranges[middle]!.end <= timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

import type {
  DerivedMinuteBar,
  DerivedMinuteQuality,
  DerivedMinuteRequest,
  MinuteCoverage,
  MinuteSourceBar,
  SuppliedMinuteSession
} from "./types";
import { fail, firstEndingAfter, MINUTE_MS, safeInteger, validateRequest } from "./validation";

interface Bucket {
  readonly start: number;
  readonly end: number;
  readonly session: SuppliedMinuteSession;
  readonly first: MinuteSourceBar;
  last: MinuteSourceBar;
  high: number;
  low: number;
  volume: number;
  count: number;
  final: number;
  forming: number;
  unknown: number;
}

function quality(
  bucket: Bucket,
  coverage: readonly MinuteCoverage[],
  asOf: number
): DerivedMinuteQuality {
  let expected = 0;
  let exhaustive = 0;
  let partial = 0;
  const windows = bucket.session.openWindows;
  for (let i = firstEndingAfter(windows, bucket.start); i < windows.length; i++) {
    const window = windows[i]!;
    if (window.start >= bucket.end) break;
    const start = Math.max(bucket.start, window.start);
    const end = Math.min(bucket.end, window.end);
    expected += (end - start) / MINUTE_MS;
    for (let j = firstEndingAfter(coverage, start); j < coverage.length; j++) {
      const span = coverage[j]!;
      if (span.start >= end) break;
      const minutes = (Math.min(end, span.end) - Math.max(start, span.start)) / MINUTE_MS;
      if (span.evidence === "exhaustive") exhaustive += minutes;
      if (span.evidence === "partial") partial += minutes;
    }
  }
  const missing = expected - bucket.count;
  const unknownCoverage = expected - exhaustive - partial;
  let status: DerivedMinuteQuality["status"];
  if (bucket.end > asOf) status = "open";
  else if (missing > 0 || partial > 0 || bucket.forming > 0) status = "incomplete";
  else if (unknownCoverage > 0 || bucket.unknown > 0) status = "unknown";
  else status = "complete";
  return Object.freeze({
    status,
    expectedMinutes: expected,
    sourceMinutes: bucket.count,
    missingSourceMinutes: missing,
    exhaustiveMinutes: exhaustive,
    partialCoverageMinutes: partial,
    unknownCoverageMinutes: unknownCoverage,
    finalSourceMinutes: bucket.final,
    formingSourceMinutes: bucket.forming,
    unknownFinalityMinutes: bucket.unknown
  });
}

function finish(
  bucket: Bucket,
  coverage: readonly MinuteCoverage[],
  asOf: number
): DerivedMinuteBar {
  return Object.freeze({
    timestamp: bucket.start,
    endTimestamp: bucket.end,
    open: bucket.first.open,
    high: bucket.high,
    low: bucket.low,
    close: bucket.last.close,
    volume: bucket.volume,
    quality: quality(bucket, coverage, asOf)
  });
}

/** Pure fixed-minute math. No calendar, timezone, provider, clock, cache or network defaults. */
export function aggregateDerivedMinutes(
  request: DerivedMinuteRequest
): readonly DerivedMinuteBar[] {
  const sessions = validateRequest(request);
  const duration = request.targetMinutes * MINUTE_MS;
  const result: DerivedMinuteBar[] = [];
  let sessionIndex = 0;
  let bucket: Bucket | undefined;
  for (const bar of request.bars) {
    while (sessionIndex < sessions.length && sessions[sessionIndex]!.end <= bar.timestamp)
      sessionIndex++;
    const session = sessions[sessionIndex];
    if (!session || bar.timestamp < session.start)
      fail("unsupported-session", "Every source minute requires a supplied containing session");
    const window = session.openWindows[firstEndingAfter(session.openWindows, bar.timestamp)];
    if (!window || bar.timestamp < window.start || bar.timestamp + MINUTE_MS > window.end)
      fail("outside-open-window", "Every source minute must fit entirely in an open window");
    const offset = safeInteger(bar.timestamp - session.anchor);
    const gridStart = safeInteger(session.anchor + Math.floor(offset / duration) * duration);
    const start = Math.max(session.start, gridStart);
    // Clip before adding duration so a valid end near the timestamp limit cannot overflow.
    const end = safeInteger(gridStart + Math.min(duration, session.end - gridStart));
    if (!bucket || bucket.start !== start || bucket.session !== session) {
      if (bucket) result.push(finish(bucket, request.coverage, request.asOf));
      bucket = {
        start,
        end,
        session,
        first: bar,
        last: bar,
        high: bar.high,
        low: bar.low,
        volume: 0,
        count: 0,
        final: 0,
        forming: 0,
        unknown: 0
      };
    }
    const volume = bucket.volume + bar.volume;
    if (!Number.isFinite(volume)) fail("arithmetic-overflow", "Source volume sum overflow");
    bucket.volume = volume;
    bucket.high = Math.max(bucket.high, bar.high);
    bucket.low = Math.min(bucket.low, bar.low);
    bucket.last = bar;
    bucket.count++;
    if (bar.finality === "final") bucket.final++;
    else if (bar.finality === "forming") bucket.forming++;
    else bucket.unknown++;
  }
  if (bucket) result.push(finish(bucket, request.coverage, request.asOf));
  return Object.freeze(result);
}

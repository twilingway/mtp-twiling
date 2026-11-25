/** All timestamps and explicit asOf values are Unix milliseconds. */
export interface IntervalCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isComplete?: boolean;
}
export interface AggregatedCandle extends IntervalCandle {
  endTimestamp: number;
  sourceCount: number;
  hasGaps: boolean;
  isComplete: boolean;
}
export interface IntervalSession {
  start: number;
  end: number;
}
interface Bucket extends IntervalSession {
  expectedCount: number;
  sourceStep: number;
}
function normalized(candles: readonly IntervalCandle[]): IntervalCandle[] {
  const unique = new Map<number, IntervalCandle>();
  for (const candle of candles) {
    if (
      ![candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume].every(
        Number.isFinite
      ) ||
      candle.volume < 0 ||
      candle.high < Math.max(candle.open, candle.close, candle.low) ||
      candle.low > Math.min(candle.open, candle.close)
    )
      throw new RangeError("Invalid source candle");
    unique.set(candle.timestamp, candle);
  }
  return [...unique.values()].sort((a, b) => a.timestamp - b.timestamp);
}
function aggregate(
  candles: readonly IntervalCandle[],
  asOf: number,
  bucketFor: (timestamp: number) => Bucket,
  positionFor: (timestamp: number, bucket: Bucket) => number
): AggregatedCandle[] {
  if (!Number.isFinite(asOf)) throw new RangeError("asOf must be finite");
  const groups = new Map<
    number,
    { bucket: Bucket; candles: IntervalCandle[]; positions: Set<number> }
  >();
  for (const candle of normalized(candles)) {
    const bucket = bucketFor(candle.timestamp);
    const position = positionFor(candle.timestamp, bucket);
    if (!Number.isInteger(position) || position < 0 || position >= bucket.expectedCount)
      throw new RangeError("Source candle is not aligned to the requested bucket");
    let group = groups.get(bucket.start);
    if (!group) {
      group = { bucket, candles: [], positions: new Set() };
      groups.set(bucket.start, group);
    }
    if (group.bucket.end !== bucket.end || group.bucket.expectedCount !== bucket.expectedCount)
      throw new RangeError("Inconsistent trading session boundaries");
    group.candles.push(candle);
    group.positions.add(position);
  }
  return [...groups.values()]
    .map(({ bucket, candles: source, positions }) => {
      const first = source[0]!,
        last = source.at(-1)!;
      const hasGaps = positions.size !== bucket.expectedCount;
      return {
        timestamp: bucket.start,
        endTimestamp: bucket.end,
        open: first.open,
        high: Math.max(...source.map((c) => c.high)),
        low: Math.min(...source.map((c) => c.low)),
        close: last.close,
        volume: source.reduce((sum, c) => sum + c.volume, 0),
        sourceCount: source.length,
        hasGaps,
        isComplete: !hasGaps && bucket.end <= asOf && source.every((c) => c.isComplete !== false)
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}
/** Calendar quarters, half-years and years start in January, at UTC midnight. */
export function aggregateCalendarMonths(
  candles: readonly IntervalCandle[],
  months: 3 | 6 | 12,
  options: { asOf: number }
): AggregatedCandle[] {
  if (![3, 6, 12].includes(months)) throw new RangeError("Unsupported calendar interval");
  return aggregate(
    candles,
    options.asOf,
    (timestamp) => {
      const date = new Date(timestamp),
        year = date.getUTCFullYear(),
        month = date.getUTCMonth();
      if (timestamp !== Date.UTC(year, month, 1))
        throw new RangeError("Expected native UTC monthly source candles");
      const startMonth = Math.floor(month / months) * months;
      return {
        start: Date.UTC(year, startMonth, 1),
        end: Date.UTC(year, startMonth + months, 1),
        expectedCount: months,
        sourceStep: 0
      };
    },
    (timestamp, bucket) => new Date(timestamp).getUTCMonth() - new Date(bucket.start).getUTCMonth()
  );
}
/** No default UTC anchor: callers must supply the actual source-aligned trading session. */
export function aggregateSessionCandles(
  candles: readonly IntervalCandle[],
  interval: "45m" | "3h",
  options: { asOf: number; sessionFor: (timestamp: number) => IntervalSession | null }
): AggregatedCandle[] {
  if (interval !== "45m" && interval !== "3h") throw new RangeError("Unsupported session interval");
  const duration = (interval === "45m" ? 45 : 180) * 60_000,
    sourceStep = (interval === "45m" ? 15 : 60) * 60_000;
  return aggregate(
    candles,
    options.asOf,
    (timestamp) => {
      const session = options.sessionFor(timestamp);
      if (
        !session ||
        !Number.isFinite(session.start) ||
        !Number.isFinite(session.end) ||
        session.start > timestamp ||
        timestamp >= session.end ||
        session.end <= session.start
      )
        throw new RangeError("An explicit trading session is required for every source candle");
      const start = session.start + Math.floor((timestamp - session.start) / duration) * duration;
      const end = Math.min(start + duration, session.end);
      return { start, end, expectedCount: Math.ceil((end - start) / sourceStep), sourceStep };
    },
    (timestamp, bucket) => (timestamp - bucket.start) / bucket.sourceStep
  );
}

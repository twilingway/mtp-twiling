const minSeconds = -62_135_596_800;
const maxSeconds = 253_402_300_799;

function integer(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?\d+$/.test(value)))
    return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
/** protobuf JSON uses RFC3339; generated clients may expose {seconds,nanos}. */
export function serverTimestamp(value: unknown): number | null {
  if (typeof value === "string") {
    const match =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(
        value
      );
    if (!match) return null;
    const year = Number(match[1]),
      month = Number(match[2]),
      day = Number(match[3]);
    const monthEnd = new Date(0);
    monthEnd.setUTCFullYear(year, month, 0);
    if (
      year < 1 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > monthEnd.getUTCDate() ||
      Number(match[4]) > 23 ||
      Number(match[5]) > 59 ||
      Number(match[6]) > 59 ||
      Number(match[8] ?? 0) > 23 ||
      Number(match[9] ?? 0) > 59
    )
      return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) &&
      parsed >= minSeconds * 1000 &&
      parsed < (maxSeconds + 1) * 1000
      ? parsed
      : null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const seconds = integer(raw.seconds),
    nanos = integer(raw.nanos ?? 0);
  if (
    seconds === null ||
    seconds < minSeconds ||
    seconds > maxSeconds ||
    nanos === null ||
    nanos < 0 ||
    nanos >= 1_000_000_000
  )
    return null;
  return seconds * 1000 + nanos / 1_000_000;
}

/** Receive-time estimate, not NTP: unknown one-way delivery latency remains in the samples. */
export class ServerClock {
  private readonly samples: number[] = [];
  observe(timestamp: unknown, receivedAt: number): boolean {
    const serverAt = serverTimestamp(timestamp);
    if (serverAt === null || !Number.isFinite(receivedAt)) return false;
    const offset = serverAt - receivedAt;
    if (!Number.isFinite(offset)) return false;
    this.samples.push(offset);
    if (this.samples.length > 9) this.samples.shift();
    return true;
  }
  get offset(): number | null {
    if (!this.samples.length) return null;
    const sorted = [...this.samples].sort((a, b) => a - b),
      middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
  now(localNow: number): number {
    return localNow + (this.offset ?? 0);
  }
  reset(): void {
    this.samples.length = 0;
  }
}

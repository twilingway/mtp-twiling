import { dayChange } from "../model/market-model.js";
import type { MarketRow } from "../model/types.js";
import { DAY_MS, priorDayBase, quoteDay, type DailyQuoteBase } from "./quote-day-base.js";
import { list, object } from "./types.js";

interface Requester {
  request(service: string, method: string, body: object): Promise<Record<string, unknown>>;
}
export const MISSING_DAY_BASE =
  "Предыдущее дневное закрытие недоступно. Изменение показано прочерком.";
const NEGATIVE_CACHE_MS = 60_000;
interface BaseEntry {
  day: string;
  result: Promise<DailyQuoteBase | null>;
  retryAfter?: number;
}

/** One immutable base per UID/last-quote day; tick updates never issue repeated history requests. */
export class QuoteDayBases {
  private closes = new Map<string, Record<string, unknown>>();
  private bases = new Map<string, BaseEntry>();
  private pending = new Set<Promise<void>>();
  private rowPending = new WeakMap<MarketRow, string>();
  private missingDays = new Set<string>();
  private generation = 0;
  constructor(
    private readonly client: Requester,
    private readonly now: () => number,
    private readonly active: (row: MarketRow) => boolean,
    private readonly changed: () => void,
    private readonly missing: () => void
  ) {}
  seed(values: unknown): void {
    for (const input of list(values)) {
      const value = object(input);
      if (value && typeof value.instrumentUid === "string")
        this.closes.set(value.instrumentUid, value);
    }
  }
  clear(): void {
    this.generation++;
    this.closes.clear();
    this.bases.clear();
    this.missingDays.clear();
    this.pending.clear();
    this.rowPending = new WeakMap();
  }
  async settled(): Promise<void> {
    await Promise.all(this.pending);
  }
  retryMissing(): void {
    for (const [uid, entry] of this.bases)
      if (entry.retryAfter !== undefined) this.bases.delete(uid);
  }
  invalidate(row: MarketRow): void {
    row.previousClose = null;
    row.closeTime = null;
    row.previousCloseDay = null;
    row.previousCloseSource = null;
    Object.assign(row, dayChange(row.price, null));
  }
  update(row: MarketRow): void {
    if (row.price === null || !Number.isFinite(row.price) || row.price <= 0) {
      this.invalidate(row);
      return;
    }
    const day = quoteDay(row.time, this.now());
    const existing = row.uid ? this.bases.get(row.uid) : undefined;
    const knownBase =
      row.previousClose !== null && Number.isFinite(row.previousClose) && row.previousClose > 0;
    if (
      day &&
      row.previousCloseDay === day &&
      (knownBase || (existing?.day === day && (existing.retryAfter ?? 0) > this.now()))
    ) {
      Object.assign(row, dayChange(row.price, row.previousClose));
      return;
    }
    this.invalidate(row);
    if (!day || !row.uid) {
      if (row.price !== null) this.reportMissing(day ?? "invalid-time");
      return;
    }
    const uid = row.uid;
    // Attach only once while a day is loading; the promise applies to the latest row price.
    if (this.rowPending.get(row) === day) return;
    this.rowPending.set(row, day);
    const generation = this.generation;
    const entry: BaseEntry =
      existing?.day === day &&
      (existing.retryAfter === undefined || existing.retryAfter > this.now())
        ? existing
        : { day, result: this.load(uid, row.time, day) };
    this.bases.set(uid, entry);
    const update = entry.result.then((base) => {
      if (!base && entry.retryAfter === undefined)
        entry.retryAfter = this.now() + NEGATIVE_CACHE_MS;
      if (
        generation !== this.generation ||
        !this.active(row) ||
        quoteDay(row.time, this.now()) !== day
      )
        return;
      row.previousClose = base?.price ?? null;
      row.closeTime = base?.time ?? null;
      row.previousCloseSource = base?.source ?? null;
      row.previousCloseDay = day;
      Object.assign(row, dayChange(row.price, row.previousClose));
      if (!base) this.reportMissing(day);
      this.changed();
    });
    this.pending.add(update);
    void update.finally(() => {
      this.pending.delete(update);
      if (generation === this.generation && this.rowPending.get(row) === day)
        this.rowPending.delete(row);
    });
  }
  private reportMissing(day: string): void {
    if (this.missingDays.has(day)) return;
    this.missingDays.add(day);
    this.missing();
  }
  private async load(uid: string, time: unknown, day: string): Promise<DailyQuoteBase | null> {
    const close = this.closes.get(uid);
    const direct = priorDayBase(time, close, [], this.now());
    if (direct) return direct;
    const boundary = Date.parse(day + "T00:00:00Z");
    try {
      const response = await this.client.request("MarketDataService", "GetCandles", {
        instrumentId: uid,
        interval: "CANDLE_INTERVAL_DAY",
        candleSourceType: "CANDLE_SOURCE_EXCHANGE",
        from: new Date(boundary - 32 * DAY_MS).toISOString(),
        to: new Date(boundary).toISOString()
      });
      return priorDayBase(time, undefined, response.candles, this.now());
    } catch {
      return null;
    }
  }
}

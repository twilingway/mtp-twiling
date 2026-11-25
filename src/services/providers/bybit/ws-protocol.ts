import {
  chronologicalCandles,
  intervalFromNative,
  nativeInterval,
  normaliseCandle,
  normaliseQuote
} from "./market.js";
import { BybitError, epochMs, instrumentRef, record, requiredText } from "./types.js";
import type { BybitCategory, BybitCandle, BybitQuote, InstrumentRef } from "./types.js";
import type { BybitInterval } from "./market.js";

export interface CandleSubscription {
  symbol: string;
  interval: BybitInterval;
}
export interface BybitSubscriptions {
  tickers: readonly string[];
  candles: readonly CandleSubscription[];
}
export type BybitStreamEvent =
  | { kind: "quote"; topic: string; quote: BybitQuote }
  | {
      kind: "candles";
      topic: string;
      ref: InstrumentRef;
      interval: BybitInterval;
      candles: BybitCandle[];
    }
  | { kind: "pong" }
  | { kind: "ack" };
export function subscriptionTopics(
  category: BybitCategory,
  subscriptions: BybitSubscriptions
): string[] {
  const topics = new Set<string>();
  for (const symbol of subscriptions.tickers)
    topics.add(`tickers.${instrumentRef(category, symbol).symbol}`);
  for (const item of subscriptions.candles)
    topics.add(
      `kline.${nativeInterval(item.interval)}.${instrumentRef(category, item.symbol).symbol}`
    );
  if (topics.size > 1000)
    throw new RangeError("Bybit stream supports at most 1000 topics per owner");
  return [...topics];
}
export function subscriptionBatches(
  op: "subscribe" | "unsubscribe",
  topics: readonly string[]
): string[] {
  const messages: string[] = [];
  for (let index = 0; index < topics.length; index += 10)
    messages.push(JSON.stringify({ op, args: topics.slice(index, index + 10) }));
  return messages;
}
export class BybitProtocol {
  private snapshots = new Map<string, Record<string, unknown>>();
  private timestamps = new Map<string, number>();
  constructor(private readonly category: BybitCategory) {}
  reset(): void {
    this.snapshots.clear();
    this.timestamps.clear();
  }
  forget(topic: string): void {
    this.snapshots.delete(topic);
    this.timestamps.delete(topic);
  }
  consume(text: unknown, topics: ReadonlySet<string>): BybitStreamEvent | null {
    if (typeof text !== "string") throw new BybitError("protocol", "Expected Bybit text frame");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new BybitError("protocol", "Invalid Bybit WS JSON");
    }
    const message = record(parsed);
    if (message.success === false)
      throw new BybitError("protocol", "Bybit subscription/control request rejected");
    if (message.op === "pong" || message.ret_msg === "pong" || message.retMsg === "pong")
      return { kind: "pong" };
    if (message.op === "subscribe" || message.op === "unsubscribe") return { kind: "ack" };
    const topic = requiredText(message.topic);
    if (!topics.has(topic)) return null;
    const timestamp = epochMs(message.ts);
    if (timestamp === null) throw new BybitError("protocol", "Missing Bybit WS timestamp");
    if (timestamp < (this.timestamps.get(topic) ?? 0)) return null;
    const parts = topic.split(".");
    if (parts[0] === "tickers" && parts.length === 2) {
      const symbol = requiredText(parts[1]),
        ref = instrumentRef(this.category, symbol),
        raw = record(message.data);
      if (
        (raw.symbol !== undefined && raw.symbol !== symbol) ||
        (message.type === "snapshot" && raw.symbol !== symbol)
      )
        throw new BybitError("protocol", "Bybit WS ticker symbol mismatch");
      if (message.type !== "snapshot" && message.type !== "delta")
        throw new BybitError("protocol", "Invalid Bybit ticker message type");
      if (this.category === "spot" && message.type !== "snapshot")
        throw new BybitError("protocol", "Spot Bybit ticker must be snapshot");
      const previous = this.snapshots.get(topic);
      if (message.type === "delta" && !previous) return null;
      const next = message.type === "snapshot" ? raw : { ...previous, ...raw };
      this.snapshots.set(topic, next);
      this.timestamps.set(topic, timestamp);
      return { kind: "quote", topic, quote: normaliseQuote(ref, next, timestamp) };
    }
    if (parts[0] === "kline" && parts.length === 3) {
      const native = requiredText(parts[1]),
        ref = instrumentRef(this.category, requiredText(parts[2]));
      if (message.type !== "snapshot" || !Array.isArray(message.data))
        throw new BybitError("protocol", "Invalid Bybit kline message");
      const candles = message.data.map((value) => {
        const item = record(value);
        if (item.interval !== native || typeof item.confirm !== "boolean")
          throw new BybitError("protocol", "Bybit kline interval/confirm mismatch");
        return normaliseCandle(
          [item.start, item.open, item.high, item.low, item.close, item.volume, item.turnover],
          item.confirm
        );
      });
      this.timestamps.set(topic, timestamp);
      return {
        kind: "candles",
        topic,
        ref,
        interval: intervalFromNative(native),
        candles: chronologicalCandles(candles)
      };
    }
    throw new BybitError("protocol", "Unsupported Bybit WS topic");
  }
}

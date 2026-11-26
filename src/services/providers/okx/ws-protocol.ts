import type { OkxProviderRef } from "../../../model/market-provider.js";
import { normaliseOkxCandle, normaliseOkxQuote } from "./market.js";
import type { OkxCandle, OkxQuote } from "./types.js";

export interface OkxTopic {
  channel: string;
  instId: string;
  ref: OkxProviderRef;
  timeframe?: string;
}

export type OkxOperation = "subscribe" | "unsubscribe";

export type OkxFrame =
  | { kind: "pong" }
  | { kind: "notice" }
  | { kind: "ack"; op: OkxOperation; key: string; id: string | undefined }
  | { kind: "data"; key: string; rows: unknown };

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function okxTopicKey(channel: string, instId: string): string {
  return `${channel}:${instId}`;
}

export function parseOkxFrame(data: unknown): OkxFrame {
  if (data === "pong") return { kind: "pong" };
  if (typeof data !== "string" || data.length > 1_048_576)
    throw new Error("Invalid OKX WebSocket text frame");
  let payload: ReturnType<typeof record>;
  try {
    payload = record(JSON.parse(data) as unknown);
  } catch {
    throw new Error("Invalid OKX WebSocket JSON");
  }
  if (!payload) throw new Error("Invalid OKX WebSocket message");
  if (payload.event === "error") throw new Error("OKX rejected a public subscription");
  if (payload.event === "notice") {
    if (payload.code === "64008") throw new Error("OKX announced a connection restart");
    return { kind: "notice" };
  }
  const arg = record(payload.arg);
  if (typeof arg?.channel !== "string" || typeof arg.instId !== "string")
    throw new Error("Missing OKX WebSocket channel or instrument");
  const key = okxTopicKey(arg.channel, arg.instId);
  if (payload.event === "subscribe" || payload.event === "unsubscribe") {
    if (payload.id !== undefined && typeof payload.id !== "string")
      throw new Error("Invalid OKX WebSocket request ID");
    return { kind: "ack", op: payload.event, id: payload.id, key };
  }
  if (payload.event !== undefined) throw new Error("Unexpected OKX WebSocket event");
  return { kind: "data", key, rows: payload.data };
}

export type OkxMarketFrame =
  | { kind: "quotes"; quotes: OkxQuote[] }
  | { kind: "candles"; ref: OkxProviderRef; timeframe: string; candles: OkxCandle[] };

function sameQuote(left: OkxQuote, right: OkxQuote): boolean {
  return (
    left.timestamp === right.timestamp &&
    left.lastPrice === right.lastPrice &&
    left.previousPrice24h === right.previousPrice24h &&
    left.changePercent24h === right.changePercent24h
  );
}

function sameCandle(left: OkxCandle, right: OkxCandle): boolean {
  return (
    left.open === right.open &&
    left.high === right.high &&
    left.low === right.low &&
    left.close === right.close &&
    left.baseVolume === right.baseVolume &&
    left.quoteTurnover === right.quoteTurnover &&
    left.confirmed === right.confirmed
  );
}

export class OkxMarketFrames {
  private readonly quotes = new Map<string, OkxQuote>();
  private readonly candles = new Map<string, Map<number, OkxCandle>>();

  forget(key: string): void {
    this.quotes.delete(key);
    this.candles.delete(key);
  }

  consume(topic: OkxTopic, data: unknown): OkxMarketFrame | undefined {
    if (!Array.isArray(data)) throw new Error("Expected an OKX WebSocket data array");
    const key = okxTopicKey(topic.channel, topic.instId);
    if (topic.timeframe === undefined) {
      const quotes = data.map((value: unknown) => normaliseOkxQuote(topic.ref, value));
      const accepted: OkxQuote[] = [];
      for (const quote of quotes) {
        const before = this.quotes.get(key);
        if (before && (quote.timestamp < before.timestamp || sameQuote(before, quote))) continue;
        this.quotes.set(key, quote);
        accepted.push(quote);
      }
      return accepted.length ? { kind: "quotes", quotes: accepted } : undefined;
    }
    const bars = data
      .map((value: unknown) => normaliseOkxCandle(value, topic.ref.category))
      .sort((left, right) => left.timestamp - right.timestamp);
    const recent = this.candles.get(key) ?? new Map<number, OkxCandle>();
    this.candles.set(key, recent);
    const accepted = new Map<number, OkxCandle>();
    for (const bar of bars) {
      const before = recent.get(bar.timestamp);
      if (before && ((before.confirmed && !bar.confirmed) || sameCandle(before, bar))) continue;
      if (!before && recent.size && bar.timestamp < Math.min(...recent.keys())) continue;
      recent.set(bar.timestamp, bar);
      accepted.set(bar.timestamp, bar);
      if (recent.size > 2) recent.delete(Math.min(...recent.keys()));
    }
    return accepted.size
      ? {
          kind: "candles",
          ref: topic.ref,
          timeframe: topic.timeframe,
          candles: [...accepted.values()]
        }
      : undefined;
  }
}

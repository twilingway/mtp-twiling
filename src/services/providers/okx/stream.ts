import { isProviderRef } from "../../../model/market-provider.js";
import type { OkxProviderRef } from "../../../model/market-provider.js";
import { okxNativeInterval } from "./market.js";
import type { OkxCandle, OkxQuote } from "./types.js";
import { OkxMarketFrames, okxTopicKey, parseOkxFrame } from "./ws-protocol.js";
import type { OkxFrame, OkxMarketFrame, OkxOperation, OkxTopic } from "./ws-protocol.js";

type OkxSocket = Pick<
  WebSocket,
  "readyState" | "onopen" | "onmessage" | "onclose" | "onerror" | "send" | "close"
>;
type Timer = ReturnType<typeof globalThis.setTimeout>;
type TimerName = "connect" | "ack" | "heartbeat" | "pong" | "retry";

export interface OkxStreamOptions {
  onQuote(quote: OkxQuote): void;
  onCandles(ref: OkxProviderRef, timeframe: string, bars: OkxCandle[]): void;
  onReconnect?(): void;
  onError?(error: Error): void;
  socket?: (url: string) => OkxSocket;
  clock?: {
    setTimeout(callback: () => void, milliseconds: number): Timer;
    clearTimeout(timer: Timer): void;
  };
}

export interface OkxSubscriptions {
  tickers: readonly OkxProviderRef[];
  candles: readonly { ref: OkxProviderRef; timeframe: string }[];
}

const channelLimits = {
  connect: 10_000,
  ack: 10_000,
  heartbeat: 20_000,
  pong: 8_000,
  retries: 5,
  topicsPerMessage: 100
};

interface PendingOperation {
  id: string;
  op: OkxOperation;
  topics: Map<string, OkxTopic>;
}

class OkxChannel {
  private readonly factory: NonNullable<OkxStreamOptions["socket"]>;
  private readonly clock: NonNullable<OkxStreamOptions["clock"]>;
  private readonly timers: Partial<Record<TimerName, Timer>> = {};
  private readonly marketFrames = new OkxMarketFrames();
  private desired = new Map<string, OkxTopic>();
  private readonly active = new Map<string, OkxTopic>();
  private pending: PendingOperation | undefined;
  private socket: OkxSocket | undefined;
  private requestId = 0;
  private retries = 0;
  private running = false;
  private opened = false;
  private ready = false;

  constructor(
    private readonly kind: "public" | "business",
    private readonly options: OkxStreamOptions
  ) {
    this.factory = options.socket ?? ((url) => new WebSocket(url));
    this.clock = options.clock ?? globalThis;
  }

  setTopics(next: Map<string, OkxTopic>): void {
    const added = [...next.keys()].some((key) => !this.desired.has(key));
    for (const key of this.desired.keys()) if (!next.has(key)) this.marketFrames.forget(key);
    this.desired = next;
    if (!next.size) {
      this.closeSocket();
      this.opened = false;
      this.retries = 0;
      return;
    }
    if (added && this.retries > channelLimits.retries) this.retries = 0;
    this.pump();
  }

  start(): void {
    this.running = true;
    this.pump();
  }

  wake(): void {
    if (this.retries <= channelLimits.retries) return;
    this.retries = 0;
    this.pump();
  }

  dispose(): void {
    this.running = false;
    for (const key of this.desired.keys()) this.marketFrames.forget(key);
    this.desired.clear();
    this.closeSocket();
  }

  private pump(): void {
    if (!this.running || !this.desired.size) return;
    const socket = this.socket;
    if (!socket) {
      if (this.timers.retry === undefined && this.retries <= channelLimits.retries) this.connect();
      return;
    }
    if (socket.readyState !== 1 || this.pending) return;
    const removed = [...this.active].filter(([key]) => !this.desired.has(key));
    const added = [...this.desired].filter(([key]) => !this.active.has(key));
    if (removed.length || added.length) {
      const op = removed.length ? "unsubscribe" : "subscribe";
      const topics = new Map(
        (removed.length ? removed : added).slice(0, channelLimits.topicsPerMessage)
      );
      const id = String(++this.requestId);
      this.pending = { op, id, topics };
      const args = [...topics.values()].map(({ channel, instId }) => ({ channel, instId }));
      if (this.send(socket, JSON.stringify({ id, op, args })))
        this.timeout(
          "ack",
          () => this.fail(new Error("OKX subscription acknowledgement timed out")),
          channelLimits.ack
        );
      return;
    }
    if (!this.ready) {
      this.ready = true;
      const reconnect = this.opened;
      this.opened = true;
      if (this.kind === "business" && reconnect) this.options.onReconnect?.();
    }
  }

  private connect(): void {
    let socket: OkxSocket;
    try {
      socket = this.factory(`wss://ws.okx.com/ws/v5/${this.kind}`);
    } catch {
      this.fail(new Error("Could not open OKX WebSocket"));
      return;
    }
    this.socket = socket;
    this.timeout(
      "connect",
      () => this.fail(new Error("OKX WebSocket connection timed out")),
      channelLimits.connect
    );
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.clear("connect");
      this.heartbeat(socket);
      this.pump();
    };
    socket.onmessage = ({ data }) => {
      if (this.socket !== socket) return;
      let frame: OkxFrame;
      let market: OkxMarketFrame | undefined;
      try {
        frame = parseOkxFrame(data as unknown);
        if (frame.kind === "data") {
          const topic = this.desired.get(frame.key);
          if (topic && this.active.has(frame.key))
            market = this.marketFrames.consume(topic, frame.rows);
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error("Invalid OKX WebSocket message"));
        return;
      }
      if (frame.kind === "pong") this.clear("pong");
      if (this.timers.pong === undefined) this.heartbeat(socket);
      if (frame.kind === "ack") this.acknowledge(frame);
      if (!market || frame.kind !== "data") return;
      if (this.ready) this.retries = 0;
      if (market.kind === "quotes") {
        for (const quote of market.quotes) {
          if (this.socket !== socket || !this.desired.has(frame.key)) break;
          this.options.onQuote(quote);
        }
      } else this.options.onCandles(market.ref, market.timeframe, market.candles);
    };
    socket.onclose = () => {
      if (this.socket === socket) this.fail(new Error("OKX WebSocket closed"));
    };
    socket.onerror = () => {
      if (this.socket === socket) this.fail(new Error("OKX WebSocket connection error"));
    };
  }

  private acknowledge(frame: Extract<OkxFrame, { kind: "ack" }>): void {
    const pending = this.pending;
    if (!pending || pending.op !== frame.op || (frame.id !== undefined && pending.id !== frame.id))
      return;
    const topic = pending.topics.get(frame.key);
    if (!topic) return;
    pending.topics.delete(frame.key);
    if (frame.op === "subscribe") this.active.set(frame.key, topic);
    else this.active.delete(frame.key);
    if (!pending.topics.size) {
      this.clear("ack");
      this.pending = undefined;
      this.pump();
    }
  }

  private heartbeat(socket: OkxSocket): void {
    this.timeout(
      "heartbeat",
      () => {
        if (this.socket === socket && this.send(socket, "ping"))
          this.timeout(
            "pong",
            () => this.fail(new Error("OKX WebSocket heartbeat timed out")),
            channelLimits.pong
          );
      },
      channelLimits.heartbeat
    );
  }

  private send(socket: OkxSocket, data: string): boolean {
    try {
      socket.send(data);
      return true;
    } catch {
      this.fail(new Error("Could not send OKX WebSocket request"));
      return false;
    }
  }

  private fail(error: Error): void {
    this.closeSocket();
    if (this.running && this.desired.size) {
      this.retries++;
      if (this.retries <= channelLimits.retries)
        this.timeout("retry", () => this.pump(), 1_000 * 2 ** (this.retries - 1));
      this.options.onError?.(error);
    }
  }

  private timeout(name: TimerName, callback: () => void, milliseconds: number): void {
    this.clear(name);
    this.timers[name] = this.clock.setTimeout(() => {
      delete this.timers[name];
      callback();
    }, milliseconds);
  }

  private clear(name: TimerName): void {
    const timer = this.timers[name];
    if (timer !== undefined) this.clock.clearTimeout(timer);
    delete this.timers[name];
  }

  private closeSocket(): void {
    for (const name of ["connect", "ack", "heartbeat", "pong", "retry"] as const) this.clear(name);
    this.active.clear();
    this.pending = undefined;
    this.ready = false;
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
    if (socket.readyState < 2) socket.close();
  }
}

function topicFor(ref: OkxProviderRef, timeframe?: string): OkxTopic {
  if (!isProviderRef(ref) || ref.provider !== "okx")
    throw new Error("Invalid OKX subscription reference");
  const channel = timeframe === undefined ? "tickers" : `candle${okxNativeInterval(timeframe)}`;
  return {
    channel,
    instId: ref.symbol,
    ref: { ...ref },
    ...(timeframe === undefined ? {} : { timeframe })
  };
}

/** Tickers and chart candles use separate public OKX WebSocket channels. */
export class OkxStream {
  private readonly tickers: OkxChannel;
  private readonly candles: OkxChannel;
  private readonly network = typeof window === "undefined" ? undefined : window;
  private started = false;
  private disposed = false;
  private signal: AbortSignal | undefined;
  private readonly abort = () => this.dispose();
  private readonly online = () => {
    this.tickers.wake();
    this.candles.wake();
  };

  constructor(options: OkxStreamOptions) {
    this.tickers = new OkxChannel("public", options);
    this.candles = new OkxChannel("business", options);
  }

  setSubscriptions(subscriptions: OkxSubscriptions): void {
    if (this.disposed) throw new Error("OKX stream is disposed");
    const tickers = new Map<string, OkxTopic>();
    for (const ref of subscriptions.tickers) {
      const topic = topicFor(ref);
      tickers.set(okxTopicKey(topic.channel, topic.instId), topic);
      if (tickers.size > 1_000) throw new Error("Too many OKX ticker subscriptions");
    }
    const candles = new Map<string, OkxTopic>();
    for (const { ref, timeframe } of subscriptions.candles) {
      const topic = topicFor(ref, timeframe);
      candles.set(okxTopicKey(topic.channel, topic.instId), topic);
      if (candles.size > 1_000) throw new Error("Too many OKX candle subscriptions");
    }
    this.tickers.setTopics(tickers);
    if (!this.disposed) this.candles.setTopics(candles);
  }

  start(signal?: AbortSignal): void {
    if (this.disposed) throw new Error("OKX stream is disposed");
    signal?.throwIfAborted();
    if (this.started) return;
    this.started = true;
    this.signal = signal;
    signal?.addEventListener("abort", this.abort, { once: true });
    this.network?.addEventListener("online", this.online);
    this.tickers.start();
    if (!this.disposed) this.candles.start();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.signal?.removeEventListener("abort", this.abort);
    this.network?.removeEventListener("online", this.online);
    this.signal = undefined;
    this.tickers.dispose();
    this.candles.dispose();
  }
}

import { BybitProtocol, subscriptionBatches, subscriptionTopics } from "./ws-protocol.js";
import type { BybitStreamEvent, BybitSubscriptions } from "./ws-protocol.js";
import { BybitError } from "./types.js";
import type { BybitCategory } from "./types.js";

export interface BybitSocket {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(text: string): void;
  close(): void;
}
type Timer = ReturnType<typeof globalThis.setTimeout>;
export interface BybitClock {
  setTimeout(callback: () => void, milliseconds: number): Timer;
  clearTimeout(timer: Timer): void;
}
export type BybitStreamState =
  "idle" | "connecting" | "open" | "reconnecting" | "closed" | "exhausted";
export interface BybitStreamOptions {
  socketFactory?: (url: string) => BybitSocket;
  clock?: BybitClock;
  connectTimeoutMs?: number;
  heartbeatMs?: number;
  pongTimeoutMs?: number;
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
  onEvent?: (event: BybitStreamEvent) => void;
  onState?: (state: BybitStreamState) => void;
  onError?: (error: BybitError) => void;
}
function browserSocket(url: string): BybitSocket {
  const native = new WebSocket(url);
  const socket: BybitSocket = {
    get readyState() {
      return native.readyState;
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: (text) => native.send(text),
    close: () => native.close()
  };
  native.onopen = () => socket.onopen?.();
  native.onmessage = (event) => socket.onmessage?.({ data: event.data as unknown });
  native.onclose = () => socket.onclose?.();
  native.onerror = () => socket.onerror?.();
  return socket;
}
const defaultClock: BybitClock = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (timer) => globalThis.clearTimeout(timer)
};
function duration(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < 1 || result > 60_000)
    throw new RangeError("Invalid Bybit stream timer");
  return result;
}
/** One public category/owner. Construction is inert; start/setSubscriptions opt into sockets. */
export class BybitStream {
  private readonly protocol: BybitProtocol;
  private readonly factory: (url: string) => BybitSocket;
  private readonly clock: BybitClock;
  private readonly connectMs: number;
  private readonly heartbeatMs: number;
  private readonly pongMs: number;
  private readonly retryMs: number;
  private readonly maxRetries: number;
  private topics = new Set<string>();
  private socket: BybitSocket | null = null;
  private connectTimer: Timer | null = null;
  private heartbeatTimer: Timer | null = null;
  private pongTimer: Timer | null = null;
  private retryTimer: Timer | null = null;
  private retries = 0;
  private running = false;
  private disposed = false;
  private abortSignal: AbortSignal | undefined;
  private readonly aborted = () => this.dispose();
  constructor(
    private readonly category: BybitCategory,
    private readonly options: BybitStreamOptions = {}
  ) {
    if (category !== "spot" && category !== "linear")
      throw new RangeError("Invalid Bybit stream category");
    this.protocol = new BybitProtocol(category);
    this.factory = options.socketFactory ?? browserSocket;
    this.clock = options.clock ?? defaultClock;
    this.connectMs = duration(options.connectTimeoutMs, 10_000);
    this.heartbeatMs = duration(options.heartbeatMs, 20_000);
    this.pongMs = duration(options.pongTimeoutMs, 10_000);
    this.retryMs = duration(options.reconnectDelayMs, 1_000);
    this.maxRetries = options.maxReconnectAttempts ?? 5;
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0 || this.maxRetries > 10)
      throw new RangeError("Invalid Bybit reconnect budget");
  }
  setSubscriptions(subscriptions: BybitSubscriptions): void {
    if (this.disposed) throw new Error("Bybit stream is disposed");
    const next = new Set(subscriptionTopics(this.category, subscriptions));
    const removed = [...this.topics].filter((topic) => !next.has(topic));
    const added = [...next].filter((topic) => !this.topics.has(topic));
    for (const topic of removed) this.protocol.forget(topic);
    this.topics = next;
    if (!next.size) {
      this.teardown();
      this.options.onState?.("idle");
    } else if (this.socket?.readyState === 1) {
      if (this.sendTopics("unsubscribe", removed)) this.sendTopics("subscribe", added);
    } else if (this.running && !this.socket && this.retryTimer === null) this.connect();
  }
  start(signal?: AbortSignal): void {
    if (this.disposed) throw new Error("Bybit stream is disposed");
    signal?.throwIfAborted();
    if (this.running) return;
    this.abortSignal?.removeEventListener("abort", this.aborted);
    this.retries = 0;
    this.running = true;
    this.abortSignal = signal;
    signal?.addEventListener("abort", this.aborted, { once: true });
    if (this.topics.size) this.connect();
    else this.options.onState?.("idle");
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    this.abortSignal?.removeEventListener("abort", this.aborted);
    this.abortSignal = undefined;
    this.teardown();
    this.topics.clear();
    this.options.onState?.("closed");
  }
  private current(socket: BybitSocket): boolean {
    return this.running && !this.disposed && this.socket === socket;
  }
  private connect(): void {
    if (!this.running || this.disposed || !this.topics.size) return;
    this.protocol.reset();
    this.options.onState?.("connecting");
    if (!this.running || this.disposed || !this.topics.size) return;
    let socket: BybitSocket;
    try {
      socket = this.factory(`wss://stream.bybit.com/v5/public/${this.category}`);
    } catch {
      this.retry(new BybitError("network", "Bybit socket creation failed"));
      return;
    }
    this.socket = socket;
    this.connectTimer = this.clock.setTimeout(() => {
      if (this.current(socket))
        this.retry(new BybitError("timeout", "Bybit socket connection timed out"));
    }, this.connectMs);
    socket.onopen = () => {
      if (!this.current(socket)) return;
      this.clearTimer("connectTimer");
      if (!this.sendTopics("subscribe", [...this.topics])) return;
      this.options.onState?.("open");
      this.heartbeat(socket);
    };
    socket.onmessage = (event) => {
      if (!this.current(socket)) return;
      try {
        if (typeof event.data === "string" && event.data.length > 1_048_576)
          throw new BybitError("protocol", "Oversized Bybit WS frame");
        const result = this.protocol.consume(event.data, this.topics);
        if (!result) return;
        if (result.kind === "pong") {
          this.clearTimer("pongTimer");
          this.heartbeat(socket);
        }
        if (result.kind === "quote" || result.kind === "candles") this.retries = 0;
        this.options.onEvent?.(result);
      } catch (error) {
        if (error instanceof BybitError) this.retry(error);
        else throw error;
      }
    };
    socket.onclose = () => {
      if (this.current(socket)) this.retry(new BybitError("network", "Bybit public socket closed"));
    };
    socket.onerror = () => {
      if (this.current(socket)) this.retry(new BybitError("network", "Bybit public socket error"));
    };
  }
  private send(text: string): boolean {
    try {
      if (!this.socket || this.socket.readyState !== 1) return false;
      this.socket.send(text);
      return true;
    } catch {
      this.retry(new BybitError("network", "Bybit public send failed"));
      return false;
    }
  }
  private sendTopics(op: "subscribe" | "unsubscribe", topics: readonly string[]): boolean {
    for (const message of subscriptionBatches(op, topics)) if (!this.send(message)) return false;
    return true;
  }
  private heartbeat(socket: BybitSocket): void {
    if (!this.current(socket)) return;
    this.clearTimer("heartbeatTimer");
    this.heartbeatTimer = this.clock.setTimeout(() => {
      this.heartbeatTimer = null;
      if (!this.current(socket) || !this.send(JSON.stringify({ op: "ping" }))) return;
      this.pongTimer = this.clock.setTimeout(() => {
        if (this.current(socket))
          this.retry(new BybitError("timeout", "Bybit heartbeat response timed out"));
      }, this.pongMs);
    }, this.heartbeatMs);
  }
  private retry(error: BybitError): void {
    this.teardown();
    this.options.onError?.(error);
    if (!this.running || this.disposed || !this.topics.size) return;
    if (this.retries >= this.maxRetries) {
      this.running = false;
      this.options.onState?.("exhausted");
      return;
    }
    const delay = Math.min(this.retryMs * 2 ** this.retries++, 30_000);
    this.options.onState?.("reconnecting");
    if (!this.running || this.disposed || !this.topics.size) return;
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }
  private clearTimer(name: "connectTimer" | "heartbeatTimer" | "pongTimer" | "retryTimer"): void {
    const timer = this[name];
    if (timer !== null) this.clock.clearTimeout(timer);
    this[name] = null;
  }
  private teardown(): void {
    for (const name of ["connectTimer", "heartbeatTimer", "pongTimer", "retryTimer"] as const)
      this.clearTimer(name);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try {
        socket.close();
      } catch {
        /* Only this owner's socket is best-effort closed. */
      }
    }
    this.protocol.reset();
  }
}

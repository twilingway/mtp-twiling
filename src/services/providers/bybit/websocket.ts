import { BybitProtocol, subscriptionBatches, subscriptionTopics } from "./ws-protocol.js";
import type { BybitStreamEvent, BybitSubscriptions } from "./ws-protocol.js";
import { BybitError } from "./types.js";
import type { BybitCategory } from "./types.js";

export interface BybitSocket {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event?: { code: number; wasClean: boolean }) => void) | null;
  onerror: (() => void) | null;
  send(text: string): void;
  close(): void;
}
type Timer = ReturnType<typeof globalThis.setTimeout>;
export interface BybitClock {
  now?: () => number;
  setTimeout(callback: () => void, milliseconds: number): Timer;
  clearTimeout(timer: Timer): void;
}
export type BybitStreamState =
  "idle" | "connecting" | "open" | "reconnecting" | "closed" | "exhausted" | "offline";
export type BybitRecoveryReason = "online" | "visible";
export interface BybitRecovery {
  online(): boolean;
  listen(wake: (reason: BybitRecoveryReason) => void): () => void;
}
export type BybitStreamReason =
  | "socket-close"
  | "socket-error"
  | "socket-create"
  | "send-error"
  | "connect-timeout"
  | "pong-timeout"
  | "protocol"
  | "offline"
  | "online"
  | "visible";
export interface BybitStreamDiagnostic {
  category: BybitCategory;
  reason: BybitStreamReason;
  timestamp: number;
  retry: number;
  closeCode: number | null;
  wasClean: boolean | null;
}
export interface BybitStreamOptions {
  socketFactory?: (url: string) => BybitSocket;
  clock?: BybitClock;
  recovery?: BybitRecovery;
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
  native.onclose = (event) => socket.onclose?.({ code: event.code, wasClean: event.wasClean });
  native.onerror = () => socket.onerror?.();
  return socket;
}
const defaultClock: BybitClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (timer) => globalThis.clearTimeout(timer)
};
const browserRecovery: BybitRecovery = {
  online: () => typeof navigator === "undefined" || navigator.onLine !== false,
  listen(wake) {
    if (typeof window === "undefined" || typeof document === "undefined") return () => {};
    const online = () => wake("online");
    const visible = () => {
      if (document.visibilityState === "visible") wake("visible");
    };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pageshow", visible);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pageshow", visible);
    };
  }
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
  private generation = 0;
  private connecting = false;
  private connectTimer: Timer | null = null;
  private heartbeatTimer: Timer | null = null;
  private pongTimer: Timer | null = null;
  private retryTimer: Timer | null = null;
  private errorTimer: Timer | null = null;
  private readonly recovery: BybitRecovery;
  private unlisten: (() => void) | undefined;
  private exhausted = false;
  private lastReceivedAt = -Infinity;
  private lastRecoveryAt = -Infinity;
  private readonly diagnostics: BybitStreamDiagnostic[] = [];
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
    this.recovery = options.recovery ?? browserRecovery;
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
      const generation = this.teardown();
      if (this.generation === generation && !this.disposed) this.options.onState?.("idle");
    } else if (this.socket?.readyState === 1) {
      if (this.sendTopics("unsubscribe", removed)) this.sendTopics("subscribe", added);
    } else if (this.running && !this.exhausted && !this.socket && this.retryTimer === null)
      this.connect();
  }
  start(signal?: AbortSignal): void {
    if (this.disposed) throw new Error("Bybit stream is disposed");
    signal?.throwIfAborted();
    if (this.running) return;
    this.abortSignal?.removeEventListener("abort", this.aborted);
    this.retries = 0;
    this.exhausted = false;
    this.running = true;
    this.abortSignal = signal;
    signal?.addEventListener("abort", this.aborted, { once: true });
    const unlisten = this.recovery.listen((reason) => this.recover(reason));
    if (this.disposed) {
      unlisten();
      return;
    }
    this.unlisten = unlisten;
    if (this.topics.size) this.connect();
    else this.options.onState?.("idle");
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    this.abortSignal?.removeEventListener("abort", this.aborted);
    this.abortSignal = undefined;
    this.unlisten?.();
    this.unlisten = undefined;
    this.teardown();
    this.topics.clear();
    this.diagnostics.length = 0;
    this.options.onState?.("closed");
  }
  getDiagnostics(): readonly BybitStreamDiagnostic[] {
    return this.diagnostics.map((entry) => ({ ...entry }));
  }
  private now(): number {
    return this.clock.now?.() ?? Date.now();
  }
  private diagnose(reason: BybitStreamReason, close?: { code: number; wasClean: boolean }): void {
    this.diagnostics.push({
      category: this.category,
      reason,
      timestamp: this.now(),
      retry: this.retries,
      closeCode: close && Number.isInteger(close.code) ? close.code : null,
      wasClean: close?.wasClean ?? null
    });
    if (this.diagnostics.length > 64) this.diagnostics.shift();
  }
  private recover(reason: BybitRecoveryReason): void {
    if (!this.running || this.disposed || !this.topics.size || !this.recovery.online()) return;
    if (this.connecting || this.retryTimer !== null || this.socket?.readyState === 0) return;
    const now = this.now();
    if (this.socket?.readyState === 1 && now - this.lastReceivedAt < this.heartbeatMs + this.pongMs)
      return;
    if (this.exhausted || this.socket) {
      const remaining = 30_000 - (now - this.lastRecoveryAt);
      if (remaining > 0) {
        const generation = this.generation;
        this.retryTimer = this.clock.setTimeout(() => {
          if (!this.active(generation)) return;
          this.retryTimer = null;
          this.recover(reason);
        }, remaining);
        return;
      }
      this.lastRecoveryAt = now;
    }
    this.diagnose(reason);
    const generation = this.teardown();
    if (!this.active(generation)) return;
    if (this.exhausted) this.retries = 0;
    this.exhausted = false;
    this.connect();
  }
  private current(socket: BybitSocket): boolean {
    return this.running && !this.disposed && this.socket === socket;
  }
  private active(generation: number): boolean {
    return this.running && !this.disposed && this.topics.size > 0 && this.generation === generation;
  }
  private connect(): void {
    if (
      !this.running ||
      this.disposed ||
      this.exhausted ||
      !this.topics.size ||
      this.connecting ||
      this.socket ||
      this.retryTimer !== null
    )
      return;
    const generation = ++this.generation;
    this.connecting = true;
    if (!this.recovery.online()) {
      this.diagnose("offline");
      this.options.onState?.("offline");
      if (this.generation === generation) this.connecting = false;
      return;
    }
    this.protocol.reset();
    this.options.onState?.("connecting");
    if (!this.active(generation)) return;
    let socket: BybitSocket;
    try {
      socket = this.factory(`wss://stream.bybit.com/v5/public/${this.category}`);
    } catch {
      if (this.active(generation)) {
        this.connecting = false;
        this.retry(new BybitError("network", "Bybit socket creation failed"), "socket-create");
      }
      return;
    }
    if (!this.active(generation)) {
      this.closeSocket(socket);
      return;
    }
    this.connecting = false;
    this.socket = socket;
    this.connectTimer = this.clock.setTimeout(() => {
      if (this.current(socket))
        this.retry(
          new BybitError("timeout", "Bybit socket connection timed out"),
          "connect-timeout"
        );
    }, this.connectMs);
    socket.onopen = () => {
      if (!this.current(socket)) return;
      this.clearTimer("connectTimer");
      this.lastReceivedAt = this.now();
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
        this.lastReceivedAt = this.now();
        if (result.kind === "pong") {
          this.clearTimer("pongTimer");
          this.heartbeat(socket);
        }
        if (result.kind === "quote" || result.kind === "candles") this.retries = 0;
        this.options.onEvent?.(result);
      } catch (error) {
        if (error instanceof BybitError) {
          if (this.current(socket)) this.retry(error, "protocol");
        } else throw error;
      }
    };
    socket.onclose = (event) => {
      if (this.current(socket))
        this.retry(new BybitError("network", "Bybit public socket closed"), "socket-close", event);
    };
    socket.onerror = () => {
      if (!this.current(socket) || this.errorTimer !== null) return;
      this.errorTimer = this.clock.setTimeout(() => {
        this.errorTimer = null;
        if (this.current(socket))
          this.retry(new BybitError("network", "Bybit public socket error"), "socket-error");
      }, 250);
    };
  }
  private send(text: string): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return false;
    try {
      socket.send(text);
      return this.current(socket) && socket.readyState === 1;
    } catch {
      if (this.current(socket))
        this.retry(new BybitError("network", "Bybit public send failed"), "send-error");
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
          this.retry(
            new BybitError("timeout", "Bybit heartbeat response timed out"),
            "pong-timeout"
          );
      }, this.pongMs);
    }, this.heartbeatMs);
  }
  private retry(
    error: BybitError,
    reason: BybitStreamReason,
    close?: { code: number; wasClean: boolean }
  ): void {
    this.diagnose(reason, close);
    const generation = this.teardown();
    if (!this.active(generation)) return;
    this.exhausted = this.retries >= this.maxRetries;
    if (!this.exhausted) {
      const delay = Math.min(this.retryMs * 2 ** this.retries++, 30_000);
      // Reserve the retry before owner callbacks can synchronously sync subscriptions.
      this.retryTimer = this.clock.setTimeout(() => {
        if (!this.active(generation)) return;
        this.retryTimer = null;
        this.connect();
      }, delay);
    }
    this.options.onError?.(error);
    if (!this.active(generation)) return;
    this.options.onState?.(this.exhausted ? "exhausted" : "reconnecting");
  }
  private clearTimer(
    name: "connectTimer" | "heartbeatTimer" | "pongTimer" | "retryTimer" | "errorTimer"
  ): void {
    const timer = this[name];
    if (timer !== null) this.clock.clearTimeout(timer);
    this[name] = null;
  }
  private teardown(): number {
    const generation = ++this.generation;
    this.connecting = false;
    for (const name of [
      "connectTimer",
      "heartbeatTimer",
      "pongTimer",
      "retryTimer",
      "errorTimer"
    ] as const)
      this.clearTimer(name);
    const socket = this.socket;
    this.socket = null;
    this.protocol.reset();
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      this.closeSocket(socket);
    }
    return generation;
  }
  private closeSocket(socket: BybitSocket): void {
    try {
      socket.close();
    } catch {
      /* Only this owner's socket is best-effort closed. */
    }
  }
}

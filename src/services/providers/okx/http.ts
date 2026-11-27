import { OkxError, okxRecord } from "./types.js";

export interface OkxHttpOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

const publicPaths = new Set([
  "/api/v5/public/instruments",
  "/api/v5/market/tickers",
  "/api/v5/market/ticker",
  "/api/v5/market/history-candles",
  "/api/v5/market/history-trades"
]);

// History and single ticker paths have an IP limit of 20 requests per two seconds.
const historyRequestInterval = 110;

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      const reason: unknown = signal?.reason;
      reject(
        reason instanceof Error ? reason : new DOMException("OKX request aborted", "AbortError")
      );
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export class OkxHttp {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private nextHistoryStart = 0;
  private historySlot: Promise<void> = Promise.resolve();

  constructor(options: OkxHttpOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000)
      throw new RangeError("OKX timeout must be between 1 and 60000ms");
  }

  private waitForHistorySlot(signal?: AbortSignal): Promise<void> {
    const slot = this.historySlot.then(async () => {
      await wait(this.nextHistoryStart - performance.now(), signal);
      signal?.throwIfAborted();
      this.nextHistoryStart = performance.now() + historyRequestInterval;
    });
    this.historySlot = slot.catch(() => undefined);
    return slot;
  }

  async get(
    path: string,
    params: Record<string, string>,
    signal?: AbortSignal
  ): Promise<readonly unknown[]> {
    if (!publicPaths.has(path)) throw new OkxError("protocol", "Only public OKX data is allowed");
    signal?.throwIfAborted();
    if (
      path === "/api/v5/market/history-candles" ||
      path === "/api/v5/market/history-trades" ||
      path === "/api/v5/market/ticker"
    )
      await this.waitForHistorySlot(signal);
    signal?.throwIfAborted();
    const url = new URL(path, "https://openapi.okx.com");
    url.search = new URLSearchParams(params).toString();
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await this.fetcher(url, {
        method: "GET",
        credentials: "omit",
        redirect: "error",
        signal: requestSignal
      });
      if (!response.ok) {
        const kind =
          response.status === 403 ? "forbidden" : response.status === 429 ? "rate-limit" : "http";
        throw new OkxError(
          kind,
          `OKX HTTP ${response.status}`,
          response.status,
          null,
          response.headers.get("retry-after")
        );
      }
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new OkxError("protocol", "Invalid OKX JSON");
      }
      requestSignal.throwIfAborted();
      const envelope = okxRecord(value);
      if (typeof envelope.code !== "string") throw new OkxError("protocol", "Missing OKX code");
      if (envelope.code !== "0")
        throw new OkxError(
          envelope.code === "50011" || envelope.code === "50040" ? "rate-limit" : "api",
          "OKX public request rejected",
          response.status,
          envelope.code
        );
      if (!Array.isArray(envelope.data)) throw new OkxError("protocol", "Missing OKX data array");
      return envelope.data as readonly unknown[];
    } catch (error) {
      signal?.throwIfAborted();
      if (timeout.aborted) throw new OkxError("timeout", "OKX public request timed out");
      if (error instanceof OkxError) throw error;
      throw new OkxError("network", "OKX public network request failed");
    }
  }
}

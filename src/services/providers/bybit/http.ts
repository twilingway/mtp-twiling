import { BybitError, epochMs, record } from "./types.js";

export interface PublicResponse {
  result: Record<string, unknown>;
  time: number;
}
export interface BybitHttpOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}
export class BybitHttp {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  constructor(options: BybitHttpOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000)
      throw new RangeError("Bybit timeout must be between 1 and 60000ms");
  }
  async get(
    path: string,
    params: Record<string, string>,
    signal?: AbortSignal
  ): Promise<PublicResponse> {
    if (!/^\/v5\/market\/[a-z-]+$/.test(path))
      throw new BybitError("protocol", "Only public Bybit market endpoints are allowed");
    signal?.throwIfAborted();
    const url = new URL(path, "https://api.bybit.com");
    url.search = new URLSearchParams(params).toString();
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        method: "GET",
        credentials: "omit",
        redirect: "error",
        signal: controller.signal
      });
      if (!response.ok) {
        const kind =
          response.status === 403 ? "forbidden" : response.status === 429 ? "rate-limit" : "http";
        throw new BybitError(
          kind,
          `Bybit HTTP ${response.status}`,
          response.status,
          null,
          response.headers.get("retry-after")
        );
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new BybitError("protocol", "Invalid Bybit JSON");
      }
      controller.signal.throwIfAborted();
      signal?.throwIfAborted();
      const data = record(raw);
      if (typeof data.retCode !== "number")
        throw new BybitError("protocol", "Missing Bybit result code");
      if (data.retCode !== 0)
        throw new BybitError(
          data.retCode === 10006 ? "rate-limit" : "api",
          "Bybit API request rejected",
          response.status,
          data.retCode
        );
      const time = epochMs(data.time);
      if (time === null) throw new BybitError("protocol", "Missing Bybit server time");
      return { result: record(data.result), time };
    } catch (error) {
      signal?.throwIfAborted();
      if (timedOut) throw new BybitError("timeout", "Bybit request timed out");
      if (error instanceof BybitError) throw error;
      throw new BybitError("network", "Bybit public network request failed");
    } finally {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
}

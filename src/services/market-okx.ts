import type { OkxProviderRef } from "../model/market-provider.js";
import type { HistoryRange, Timeframe } from "../model/types.js";
import { loadOkxCatalog } from "./providers/okx/catalog.js";
import { OkxHttp } from "./providers/okx/http.js";
import { loadOkxHistory, loadOkxQuotes } from "./providers/okx/market.js";
import { OkxStream } from "./providers/okx/stream.js";
import type { OkxInstrument } from "./providers/okx/types.js";

type StreamOptions = NonNullable<ConstructorParameters<typeof OkxStream>[0]>;
type Stream = Pick<OkxStream, "setSubscriptions" | "start" | "dispose">;

export const PUBLIC_CATALOG_MAX_AGE_MS = 60_000;

export interface OkxMarketOptions {
  http?: Pick<OkxHttp, "get">;
  stream?: (options: StreamOptions) => Stream;
}

export class OkxMarket {
  private readonly http: Pick<OkxHttp, "get">;
  private readonly makeStream: (options: StreamOptions) => Stream;
  private catalogEntries: readonly OkxInstrument[] = [];
  private catalogReceivedAt: number | undefined;
  private catalogRequest: Promise<readonly OkxInstrument[]> | undefined;
  private stream: Stream | undefined;

  constructor(
    private readonly signal: AbortSignal,
    private readonly events: StreamOptions,
    options: OkxMarketOptions = {}
  ) {
    this.http = options.http ?? new OkxHttp();
    this.makeStream = options.stream ?? ((value) => new OkxStream(value));
  }

  catalog(refresh = false): Promise<readonly OkxInstrument[]> {
    if (this.catalogRequest) return this.catalogRequest;
    if (
      !refresh &&
      this.catalogReceivedAt !== undefined &&
      Date.now() - this.catalogReceivedAt < PUBLIC_CATALOG_MAX_AGE_MS
    )
      return Promise.resolve(this.catalogEntries);
    this.catalogRequest = loadOkxCatalog(this.http, this.signal)
      .then((entries) => {
        this.catalogEntries = entries;
        this.catalogReceivedAt = Date.now();
        return entries;
      })
      .finally(() => {
        this.catalogRequest = undefined;
      });
    return this.catalogRequest;
  }

  sync(
    tickers: readonly OkxProviderRef[],
    candle: { ref: OkxProviderRef; timeframe: string } | null
  ): void {
    if (this.signal.aborted) return;
    if (!tickers.length && !candle) {
      this.close();
      return;
    }
    this.stream ??= this.makeStream(this.events);
    this.stream.setSubscriptions({ tickers, candle });
    this.stream.start(this.signal);
  }

  async snapshot(refs: readonly OkxProviderRef[]): Promise<void> {
    const categories = new Set(refs.map((ref) => ref.category));
    await Promise.all(
      [...categories].map(async (category) => {
        try {
          const quotes = await loadOkxQuotes(this.http, category, this.signal);
          if (this.signal.aborted) return;
          for (const quote of quotes) this.events.onQuote(quote);
        } catch (error) {
          if (!this.signal.aborted)
            this.events.onError?.(error instanceof Error ? error : new Error("OKX недоступна."));
        }
      })
    );
  }

  history(
    ref: OkxProviderRef,
    timeframe: Timeframe,
    range: HistoryRange & { maxPages?: number },
    signal: AbortSignal
  ) {
    return loadOkxHistory(this.http, ref, timeframe, range, signal);
  }

  close(): void {
    this.stream?.dispose();
    this.stream = undefined;
  }
}

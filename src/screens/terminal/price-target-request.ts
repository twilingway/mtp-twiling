import type { PriceTargetStudyInput } from "../../model/technical-indicators/catalog-expansion/price-target.js";
import type { DetailsClient } from "../../services/instrument-details/repository.js";
import type { TbankPriceTarget } from "../../services/instrument-details/tbank-price-target.js";

export type PriceTargetLoader = (
  client: DetailsClient,
  instrumentUid: string,
  asOf: number,
  signal: AbortSignal
) => Promise<TbankPriceTarget | null>;

export interface ChartPriceTarget {
  readonly status: "hidden" | "unsupported" | "loading" | "ready" | "empty" | "error";
  readonly currency?: string;
  readonly priceTarget?: PriceTargetStudyInput;
}

interface ObservationOptions {
  readonly client: DetailsClient;
  readonly uid: string;
  readonly load: PriceTargetLoader;
  now(): number;
  active(): boolean;
  publish(result: ChartPriceTarget): void;
}

const REFRESH_MS = 15 * 60_000;
const RETRY_MS = 60_000;
const REQUEST_DEADLINE_MS = 45_000;

/** One response at a time, owned by the visible study's active bank session. */
export function observePriceTarget(options: ObservationOptions): () => void {
  const lifetime = new AbortController();
  const owner = options.client.owner;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const active = () =>
    !lifetime.signal.aborted &&
    options.client.authenticated &&
    !options.client.closed &&
    options.client.owner === owner &&
    options.active();
  const update = async () => {
    if (!active()) return;
    const asOf = options.now();
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(REQUEST_DEADLINE_MS)]);
    let delay = REFRESH_MS;
    try {
      const target = await options.load(options.client, options.uid, asOf, signal);
      if (!active()) return;
      signal.throwIfAborted();
      if (target) {
        if (
          target.forecast.instrumentKey !== options.uid ||
          target.referenceClose.instrumentKey !== options.uid
        )
          throw new Error("Price target instrument mismatch");
        options.publish({
          status: "ready",
          currency: target.forecast.currency,
          priceTarget: { ...target, asOf }
        });
      } else options.publish({ status: "empty" });
    } catch {
      if (!active()) return;
      delay = RETRY_MS;
      options.publish({ status: "error" });
    }
    if (active()) timer = setTimeout(() => void update(), delay);
  };
  void update();
  return () => {
    lifetime.abort();
    clearTimeout(timer);
  };
}

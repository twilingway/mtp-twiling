import type { MarketClient } from "../../services/market-client.js";

type LoadCandles = MarketClient["loadCandles"];
const maxConcurrentHistory = 4;
const historyQueues = new WeakMap<MarketClient, { running: number; waiters: (() => void)[] }>();

export function loadPanelCandles(
  market: MarketClient,
  ...args: Parameters<LoadCandles>
): ReturnType<LoadCandles> {
  let queue = historyQueues.get(market);
  if (!queue) {
    queue = { running: 0, waiters: [] };
    historyQueues.set(market, queue);
  }
  const pending = queue;
  const signal = args[3]?.signal;
  return new Promise((resolve, reject) => {
    const cancel = () => {
      const index = pending.waiters.indexOf(start);
      if (index !== -1) pending.waiters.splice(index, 1);
      reject(new DOMException("Отменено", "AbortError"));
    };
    function start() {
      signal?.removeEventListener("abort", cancel);
      if (signal?.aborted) {
        cancel();
        return;
      }
      pending.running++;
      void Promise.resolve()
        .then(() => {
          signal?.throwIfAborted();
          return market.loadCandles(...args);
        })
        .then(resolve, reject)
        .finally(() => {
          pending.running--;
          pending.waiters.shift()?.();
        });
    }
    if (pending.running < maxConcurrentHistory || signal?.aborted) start();
    else {
      pending.waiters.push(start);
      signal?.addEventListener("abort", cancel, { once: true });
    }
  });
}

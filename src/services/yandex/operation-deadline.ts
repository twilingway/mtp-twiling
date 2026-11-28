import { YandexError } from "./types.js";

/** A ceiling for the entire action, including a queued writer lock; never a minimum delay. */
export function yandexOperationDeadline(signals: readonly AbortSignal[], milliseconds: number) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1)
    throw new RangeError("Invalid Yandex operation timeout");
  const deadline = new AbortController(),
    signal = AbortSignal.any([...signals, deadline.signal]),
    timer = setTimeout(() => deadline.abort(new YandexError("network")), milliseconds);
  return {
    signal,
    async wait<T>(action: Promise<T>): Promise<T> {
      let cancel: (() => void) | undefined;
      try {
        return await Promise.race([
          action,
          new Promise<never>((_, reject) => {
            cancel = () =>
              reject(signal.reason instanceof Error ? signal.reason : new YandexError("network"));
            if (signal.aborted) cancel();
            else signal.addEventListener("abort", cancel, { once: true });
          })
        ]);
      } finally {
        if (cancel) signal.removeEventListener("abort", cancel);
      }
    },
    dispose: () => clearTimeout(timer)
  };
}

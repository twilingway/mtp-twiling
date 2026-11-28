import type { BybitStreamState } from "./websocket.js";
import type { BybitStreamEvent } from "./ws-protocol.js";
import type { BybitCategory } from "./types.js";

/** Per-owner notices; repeated retry attempts do not flood the shared notice area. */
export function bybitStreamNotices(category: BybitCategory, notice: (message: string) => void) {
  let interrupted = false;
  const source = `Bybit (${category === "spot" ? "спот" : "контракты"})`;
  return {
    event(event: BybitStreamEvent): void {
      if (
        interrupted &&
        ((event.kind === "quote" && event.quote.lastPrice !== null) ||
          (event.kind === "candles" && event.candles.length > 0))
      ) {
        interrupted = false;
        notice(`Поток ${source} восстановлен; котировки снова обновляются.`);
      }
    },
    state(state: BybitStreamState): void {
      const firstRetry = state === "reconnecting" && !interrupted;
      if (state === "reconnecting" || state === "exhausted" || state === "offline")
        interrupted = true;
      if (firstRetry) notice(`Поток ${source} прерван; переподключаемся. Источник сохранён.`);
      if (state === "exhausted")
        notice(
          `Обновления ${source} остановлены. Повторим подключение при возвращении сети или вкладки; источник сохранён.`
        );
      if (state === "offline")
        notice(`Нет сети; обновления ${source} остановлены до её возвращения.`);
    }
  };
}

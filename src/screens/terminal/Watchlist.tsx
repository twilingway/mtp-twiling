import { selectPreferences, selectWatchlistState } from "./terminal-state-selection.js";
import { shallowEqual } from "./snapshot-selector.js";
import { t, systemText } from "../../i18n/messages.js";
import { timeZoneOffset } from "../../i18n/timezones.js";
import { useState } from "react";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { precision } from "../../charts/adapter.js";
import { useTerminal, useTerminalState } from "./context.js";
import { number, signClass, timeLabel } from "./state.js";
import { WatchlistSectionsTable } from "./WatchlistSectionsTable.js";
import { watchlistStartupNotice } from "./WatchlistStartupStatus.js";
import { matchesWatchlistFlag } from "../../model/watchlist-flags.js";
import { WatchlistFlagFilter } from "./WatchlistFlagFilter.js";
import { InstrumentIcon } from "./WatchlistQuoteRow.js";
import { InstrumentDetails } from "./InstrumentDetails.js";
import { DetailsDivider } from "./DetailsDivider.js";
import { providerLabel } from "./provider-label.js";
import type { TerminalController } from "./controller.js";
export { InstrumentIcon } from "./WatchlistQuoteRow.js";
type SortKey = "symbol" | "price" | "change" | "changePercent";
export function Watchlist({ chartEditor }: { chartEditor?: TerminalController } = {}) {
  const { controller, state } = useTerminal(selectWatchlistState, shallowEqual);
  const editor = chartEditor ?? controller;
  const chartPreferences = useTerminalState(editor, selectPreferences);
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState<SortKey | null>(null),
    [direction, setDirection] = useState(-1);
  const startup = watchlistStartupNotice(state);
  const selected = startup ? undefined : selectedMarketRow(state.rows, chartPreferences);
  const source = selected?.providerRef ? providerLabel(selected.providerRef) : null;
  const visible = state.rows.filter(
    (row) =>
      matchesWatchlistFlag(
        row,
        state.preferences.watchlistFlags,
        state.preferences.watchlistFlagFilter
      ) &&
      `${row.symbol} ${row.ticker} ${row.name}`
        .toLocaleLowerCase("ru-RU")
        .includes(query.trim().toLocaleLowerCase("ru-RU"))
  );
  return (
    <aside className="watchlist-panel" aria-label={t("Список котировок")}>
      <div className="watchlist-list-region">
        <div className="watchlist-heading">
          <WatchlistFlagFilter />
          <button
            id="add-instrument"
            title={t("Добавить инструмент")}
            aria-label={t("Добавить инструмент")}
            onClick={() =>
              state.ready ? editor.setDialog("instruments") : controller.setDialog("account")
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            id="reset-order"
            title={t("Сбросить сортировку")}
            onClick={() => {
              setSort(null);
              setQuery("");
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M20 12a8 8 0 1 1-2.35-5.65M20 5v6h-6" />
            </svg>
          </button>
        </div>
        <div className="watchlist-search">
          <svg className="watchlist-search-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m15.5 15.5 5 5" />
          </svg>
          <input
            id="search"
            type="search"
            placeholder={t("Найти инструмент")}
            aria-label={t("Поиск в списке")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>/</kbd>
        </div>
        <WatchlistSectionsTable
          query={query}
          sort={sort}
          direction={direction}
          onSort={(key) => {
            setDirection(sort === key ? -direction : -1);
            setSort(key);
          }}
          onManualOrder={() => setSort(null)}
          chartEditor={editor}
          activeInstrument={selected ?? null}
        />
        {!startup && (
          <div className="watchlist-meta">
            <span id="quote-count">
              {visible.length} {t("из")}
              {state.rows.length} · {state.rows.filter((row) => row.price != null).length}{" "}
              {t("с ценой")}
            </span>
            <span>{t("WebSocket · напрямую")}</span>
          </div>
        )}
      </div>
      {selected && (
        <>
          <DetailsDivider />
          <section className="details watchlist-resizable-details">
            <div className="detail-symbol">
              <InstrumentIcon key={selected.uid} row={selected} id="detail-icon" />
              <h3 id="detail-symbol">{selected.ticker}</h3>
              <span className="market-tag" id="detail-type">
                {selected.providerRef
                  ? selected.type === "tokenized-stock"
                    ? t("Токенизированная акция")
                    : selected.assetClass === "crypto"
                      ? t("Криптовалюта")
                      : `${t("Контракт")} · ${source}`
                  : selected.type === "future"
                    ? t("Фьючерс")
                    : selected.type === "index"
                      ? t("Индекс")
                      : selected.type === "currency"
                        ? t("Валюта")
                        : t("Акция")}
              </span>
            </div>
            <p id="detail-name">{selected.name}</p>
            <div className="detail-quote">
              <strong id="detail-price">{number(selected.price, precision(selected))}</strong>
              <span id="detail-currency">{selected.currency.toUpperCase()}</span>
            </div>
            <p
              className={`detail-change ${signClass(selected.change)}`}
              id="detail-change"
              title={
                selected.comparisonBasis === "rolling-24h" && source
                  ? `${t("Изменение за последние 24 часа")} · ${source}`
                  : t(
                      selected.type === "future"
                        ? "К предыдущему закрытию Т-Банка"
                        : "К предыдущему дневному закрытию"
                    )
              }
            >
              {selected.change == null || selected.changePercent == null
                ? "—"
                : `${number(selected.change, precision(selected), true)} (${number(selected.changePercent, 2, true)}%)`}
            </p>
            <div className="detail-facts">
              <div>
                <span>
                  {t(selected.providerRef ? "База изменения" : "Предыдущее дневное закрытие")}
                </span>
                <b id="detail-close">
                  {selected.providerRef
                    ? t("Последние 24 часа")
                    : number(selected.previousClose, precision(selected))}
                </b>
              </div>
              <div>
                <span>{t("Время последней сделки")}</span>
                <b id="detail-time">
                  {timeLabel(selected.time)}{" "}
                  {selected.time
                    ? timeZoneOffset(
                        state.preferences.timeZone ?? "Europe/Moscow",
                        new Date(selected.time).getTime()
                      )
                    : ""}
                </b>
              </div>
              <div>
                <span>{t("Источник")}</span>
                <b>{source ?? t("Т‑Инвестиции")}</b>
              </div>
            </div>
            <p className="detail-note" id="detail-note">
              {source
                ? `${source} · ${t("последняя сделка · изменение за 24ч")}`
                : t(
                    selected.previousClose == null
                      ? "Предыдущее закрытие недоступно"
                      : selected.type === "future"
                        ? "К предыдущему закрытию Т-Банка"
                        : "К предыдущему дневному закрытию"
                  )}
              {selected.note ? " · " + systemText(selected.note) : ""}
            </p>
            <InstrumentDetails row={selected} />
          </section>
        </>
      )}
      <div className="private-note">
        <span>◈</span> {t("Личное пространство")}
      </div>
    </aside>
  );
}

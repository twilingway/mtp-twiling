import { t, systemText } from "../../i18n/messages.js";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogInstrument, InstrumentSearchKind, MarketRow } from "../../model/types.js";
import { useTerminal } from "./context.js";
import { Modal } from "./Modal.js";
import { intlLocale } from "../../i18n/preferences.js";
import { providerAttributes } from "../../model/market-provider.js";
import { orderedWatchlistRows } from "../../model/watchlist-sections.js";
import { publishWorkspaceInstrument } from "./workspace-sync-controller.js";
import { searchInstrumentUid, searchWatchlistRow } from "../../model/instrument-search-identity.js";
import {
  instrumentSearchHighlight,
  instrumentSearchSource,
  instrumentSearchVenue,
  INSTRUMENT_SEARCH_ORDERS,
  sortInstrumentSearch
} from "../../model/instrument-search-sort.js";
import type { InstrumentSearchOrder } from "../../model/instrument-search-sort.js";
import { instrumentSearchQuoteId } from "../../services/instrument-search-prices.js";
import { catalogInstrumentKind } from "../../model/currency-search.js";
import { chartPriceFormat } from "../../charts/price-format.js";
import { quotation } from "../../model/market-model.js";
import { number } from "./state.js";
import { useInstrumentSearchPrices } from "./use-instrument-search-prices.js";
import type { TerminalController } from "./controller.js";
type Kind = InstrumentSearchKind;
const KINDS: { kind: Kind; label: string }[] = [
  { kind: "all", label: "Все" },
  { kind: "share", label: "Акции" },
  { kind: "future", label: "Фьючерсы" },
  { kind: "index", label: "Индексы" },
  { kind: "currency", label: "Валюты" },
  { kind: "crypto", label: "Криптовалюты" },
  { kind: "tokenized-stock", label: "Токенизированные акции" }
];
const SORT_LABELS: Record<InstrumentSearchOrder, string> = {
  relevance: "По релевантности",
  ticker: "По тикеру",
  source: "По источнику"
};
const noResults: CatalogInstrument[] = [];
interface SearchRequest {
  query: string;
  kind: Kind;
  revision: number;
}
interface SearchResponse {
  revision: number;
  owner: string;
  items: CatalogInstrument[];
  error: string;
}
function CatalogLogo({ item }: { item: CatalogInstrument }) {
  const [failed, setFailed] = useState(false);
  const name = item.brand?.logoName;
  const url =
    typeof name === "string" && /^[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp)$/i.test(name)
      ? "https://invest-brands.cdn-tinkoff.ru/" + name.replace(/\.(png|jpg|jpeg|webp)$/i, "x160.$1")
      : null;
  return (
    <span className="instrument-search-logo" aria-hidden="true">
      {url && !failed ? (
        <img src={url} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      ) : (
        item.ticker.slice(0, 1)
      )}
    </span>
  );
}
function kindLabel(item: CatalogInstrument): string {
  if (item.providerRef) {
    if (item.kind === "tokenized-stock") return t("Токенизированная акция");
    if (item.kind === "crypto") return t("Криптовалюта");
    return item.assetClass === "stock" || item.assetClass === "etf"
      ? t("Контракт на акцию/ETF")
      : t("Контракт");
  }
  const kind = catalogInstrumentKind(item);
  return kind === "currency"
    ? t("Валюта")
    : kind === "future"
      ? t("Фьючерс")
      : kind === "index"
        ? t("Индекс")
        : kind === "share"
          ? t("Акция")
          : t("Инструмент");
}
function metadata(item: CatalogInstrument): string {
  const source = t(instrumentSearchSource(item));
  const mode = item.providerRef
    ? item.providerRef.category === "spot"
      ? t("Спот")
      : t("USDT perpetual")
    : t(instrumentSearchVenue(item) ?? "Площадка не указана");
  const fields = [source, mode, item.classCode, item.marketRegion].filter(Boolean);
  if (item.expirationDate) {
    const expiration = new Date(item.expirationDate);
    if (Number.isFinite(expiration.getTime()))
      fields.push(t("до ") + expiration.toLocaleDateString(intlLocale(), { timeZone: "UTC" }));
  }
  return fields.join(" · ");
}
function Highlight({ text, query }: { text: string; query: string }) {
  return instrumentSearchHighlight(text, query).map((part, index) =>
    index % 2 ? (
      <mark key={index} className="instrument-search-match">
        {part}
      </mark>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    )
  );
}
function priceLabel(
  item: CatalogInstrument,
  row: MarketRow | undefined,
  fallback?: number
): string {
  const last = row?.price;
  const price = last != null && Number.isFinite(last) && last > 0 ? last : fallback;
  const { precision } = chartPriceFormat(
    row
      ? { ...row, price }
      : {
          symbol: item.ticker,
          step: quotation(item.minPriceIncrement),
          ...(item.nativePriceStep !== undefined && { nativePriceStep: item.nativePriceStep }),
          price
        }
  );
  const currency = (row?.currency || item.currency || item.quoteCoin)?.toUpperCase();
  return `${number(price, Math.min(precision, 9))}${currency ? ` ${currency}` : ""}`;
}
function instrumentKey(item: CatalogInstrument): string {
  return searchInstrumentUid(item) ?? item.figi ?? `${item.ticker}:${item.classCode ?? ""}`;
}
function watchlistInstrument(row: MarketRow): CatalogInstrument {
  return {
    ...providerAttributes({ ...row }),
    ticker: row.ticker,
    name: row.name,
    currency: row.currency,
    ...(row.classCode ? { classCode: row.classCode } : {}),
    ...(row.exchange ? { exchange: row.exchange } : {}),
    ...(row.realExchange ? { realExchange: row.realExchange } : {}),
    ...(row.brand !== undefined ? { brand: row.brand } : {}),
    kind: row.type ?? "share",
    ...(row.uid ? { uid: row.uid } : {}),
    ...(row.figi ? { figi: row.figi } : {}),
    ...(row.expirationDate ? { expirationDate: row.expirationDate } : {})
  };
}
export function InstrumentSearch({
  watchlistController
}: {
  watchlistController?: Pick<TerminalController, "addToWatchlist" | "removeInstrument">;
}) {
  const { controller, state } = useTerminal(),
    [{ query, kind, revision }, setSearch] = useState<SearchRequest>({
      query: "",
      kind: "all",
      revision: 0
    }),
    [response, setResponse] = useState<SearchResponse>({
      revision: -1,
      owner: "",
      items: [],
      error: ""
    }),
    [pending, setPending] = useState<string | null>(null),
    [order, setOrder] = useState<InstrumentSearchOrder>("relevance");
  const watchlist = watchlistController ?? controller;
  const input = useRef<HTMLInputElement>(null);
  const cleanQuery = query.trim();
  const current = response.revision === revision && response.owner === state.owner;
  const busy = !!cleanQuery && !current;
  const displayed = orderedWatchlistRows(state.rows, state.preferences.watchlistSections);
  const locale = intlLocale();
  const matched = useMemo(
    () =>
      cleanQuery && current
        ? sortInstrumentSearch(response.items, cleanQuery, order, locale)
        : noResults,
    [current, cleanQuery, response.items, order, locale]
  );
  const results = cleanQuery ? matched : displayed.map(watchlistInstrument);
  const priceClient =
    cleanQuery && (state.authenticated || state.marketReady) ? controller.sessionKey() : null;
  const { list, prices } = useInstrumentSearchPrices(
    priceClient,
    state.owner,
    revision,
    matched,
    state.rows
  );
  const error = current ? response.error : "";
  useEffect(() => {
    if (!cleanQuery) return;
    const abort = new AbortController();
    const owner = state.owner;
    const timer = setTimeout(() => {
      void controller
        .searchInstruments(cleanQuery, kind, abort.signal)
        .then((items) => {
          if (!abort.signal.aborted) setResponse({ revision, owner, items, error: "" });
        })
        .catch((error: unknown) => {
          if (!abort.signal.aborted)
            setResponse({
              revision,
              owner,
              items: [],
              error: error instanceof Error ? error.message : t("Поиск недоступен")
            });
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [controller, cleanQuery, kind, revision, state.owner]);
  const changeQuery = (query: string) =>
    setSearch((request) => ({ ...request, query, revision: request.revision + 1 }));
  function run(key: string, action: () => Promise<unknown>, failure: string) {
    if (pending !== null) return;
    const { owner } = state;
    setPending(key);
    void action()
      .catch((error: unknown) => {
        if (controller.getSnapshot().owner === owner)
          controller.notify(error instanceof Error ? error.message : t(failure));
      })
      .finally(() => setPending(null));
  }
  function select(item: CatalogInstrument, key: string, row?: MarketRow) {
    const { owner } = state;
    run(
      key,
      async () => {
        if (window.matchMedia("(max-width: 800px)").matches) controller.panel.closeMobile();
        if (row) {
          const selection = controller.setPreferences({
            symbol: row.symbol,
            instrumentUid: row.uid
          });
          controller.setDialog(null);
          await selection;
        } else await controller.addInstrument(item);
        if (controller.getSnapshot().owner === owner)
          publishWorkspaceInstrument(controller, row?.uid ?? searchInstrumentUid(item));
      },
      "Не удалось добавить"
    );
  }
  return (
    <Modal
      id="instrument-dialog"
      title={t("Поиск инструментов")}
      onClose={() => controller.setDialog(null)}
    >
      <div className="instrument-search-input">
        <input
          ref={input}
          id="instrument-query"
          type="search"
          aria-label={t("Тикер или название")}
          aria-controls="instrument-results"
          aria-describedby="instrument-search-help"
          placeholder={t("Тикер или часть названия")}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={query}
          onChange={(event) => changeQuery(event.currentTarget.value)}
        />
        {query && (
          <button
            type="button"
            className="instrument-search-clear"
            aria-label={t("Очистить поиск")}
            title={t("Очистить поиск")}
            onClick={() => {
              changeQuery("");
              input.current?.focus();
            }}
          >
            ×
          </button>
        )}
      </div>
      <div className="instrument-search-filters" hidden={!cleanQuery}>
        <div
          id="instrument-kind"
          className="instrument-search-kinds"
          role="group"
          aria-label={t("Тип инструмента")}
        >
          {KINDS.map((item) => (
            <button
              key={item.kind}
              type="button"
              aria-pressed={kind === item.kind}
              onClick={() => {
                if (kind !== item.kind)
                  setSearch((request) => ({
                    ...request,
                    kind: item.kind,
                    revision: request.revision + 1
                  }));
              }}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
        <select
          className="instrument-search-order"
          aria-label={t("Сортировка результатов")}
          value={order}
          onChange={(event) => {
            const next = INSTRUMENT_SEARCH_ORDERS.find((value) => value === event.target.value);
            if (next !== undefined) setOrder(next);
          }}
        >
          {INSTRUMENT_SEARCH_ORDERS.map((value) => (
            <option value={value} key={value}>
              {t(SORT_LABELS[value])}
            </option>
          ))}
        </select>
      </div>
      <div id="instrument-results" ref={list} aria-busy={busy}>
        {cleanQuery && error ? (
          <p role="alert">{systemText(error)}</p>
        ) : busy ? (
          <p role="status">{t("Поиск…")}</p>
        ) : !results.length ? (
          <p role="status">
            {cleanQuery
              ? t("Инструменты не найдены.")
              : t("Введите часть тикера или названия, например NG или газ.")}
          </p>
        ) : (
          results.map((item, index) => {
            const key = `${instrumentKey(item)}:${index}`;
            const row = cleanQuery ? searchWatchlistRow(state.rows, item) : displayed[index];
            const details = metadata(item);
            const action = t(row ? "Удалить из списка котировок" : "Добавить в список котировок");
            const quoteUid = instrumentSearchQuoteId(item);
            const price = priceLabel(item, row, quoteUid ? prices.get(quoteUid) : undefined);
            return (
              <div key={key} className="instrument-result" data-search-quote-uid={quoteUid}>
                <button
                  type="button"
                  className="instrument-result-select"
                  data-select-instrument={index}
                  aria-disabled={pending !== null || undefined}
                  onClick={() => select(item, key, row)}
                >
                  <CatalogLogo item={item} />
                  <span className="instrument-result-copy">
                    <span className="instrument-result-title">
                      <strong>
                        <Highlight text={item.ticker} query={cleanQuery} />
                      </strong>
                      <span className="instrument-kind-badge">{kindLabel(item)}</span>
                    </span>
                    <span className="instrument-result-summary">
                      <span className="instrument-result-name">
                        <Highlight text={item.name} query={cleanQuery} />
                      </span>
                      <span className="instrument-result-price" title={t("Последняя цена")}>
                        {price}
                      </span>
                    </span>
                    {details && <small className="instrument-result-meta">{details}</small>}
                  </span>
                </button>
                <button
                  type="button"
                  className="instrument-result-action"
                  data-add-instrument={row ? undefined : index}
                  data-remove-instrument={row ? index : undefined}
                  aria-label={`${action} · ${item.ticker} · ${item.name} · ${details}`}
                  title={action}
                  aria-disabled={pending !== null || undefined}
                  aria-busy={pending === key || undefined}
                  onClick={() =>
                    run(
                      key,
                      () =>
                        row
                          ? watchlist.removeInstrument({ uid: row.uid, symbol: row.symbol })
                          : watchlist.addToWatchlist(item),
                      row ? "Не удалось удалить инструмент." : "Не удалось добавить"
                    )
                  }
                >
                  {pending === key ? (
                    "…"
                  ) : row ? (
                    <svg
                      aria-hidden="true"
                      width="18"
                      height="18"
                      viewBox="0 0 18 18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 5h12M7 5V3h4v2m3 0-.8 10H4.8L4 5m3 3v4m4-4v4" />
                    </svg>
                  ) : (
                    <span aria-hidden="true">+</span>
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>
      <small id="instrument-search-help">
        {t(
          "Bybit и OKX · публичные котировки без ключа. Т‑Банк · личный ключ для российских инструментов. USDT-контракт и токенизированная акция не являются обычной акцией."
        )}
      </small>
    </Modal>
  );
}

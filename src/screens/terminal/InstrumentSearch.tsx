import { t, systemText } from "../../i18n/messages.js";
import { useEffect, useState } from "react";
import type { CatalogInstrument, InstrumentSearchKind, MarketRow } from "../../model/types.js";
import { useTerminal } from "./context.js";
import { Modal } from "./Modal.js";
import { intlLocale } from "../../i18n/preferences.js";
import { providerAttributes } from "../../model/market-provider.js";
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
    if (item.kind === "crypto")
      return item.productKind === "spot" ? t("Крипто · Спот") : t("Крипто · USDT perpetual");
    return item.assetClass === "stock" || item.assetClass === "etf"
      ? t("Контракт на акцию/ETF")
      : t("USDT perpetual");
  }
  const kind = item.kind ?? item.instrumentType;
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
  if (item.providerRef)
    return [
      "Bybit",
      item.providerRef.category === "spot" ? "Spot" : "USDT perpetual",
      item.marketRegion,
      item.currency
    ]
      .filter(Boolean)
      .join(" · ");
  const source =
    item.exchange === "moex_close"
      ? t("MOEX · данные закрытия")
      : item.exchange === "dealer_fx_otc"
        ? t("Дилер · внебиржевой")
        : item.realExchange === "REAL_EXCHANGE_DEALER" || item.exchange?.startsWith("dealer")
          ? t("Дилер")
          : item.realExchange === "REAL_EXCHANGE_MOEX" || /^(moex|forts)/i.test(item.exchange ?? "")
            ? "MOEX"
            : null;
  const fields = [item.classCode, source, item.currency?.toUpperCase()].filter(Boolean);
  if (item.expirationDate) {
    const expiration = new Date(item.expirationDate);
    if (Number.isFinite(expiration.getTime()))
      fields.push(t("до ") + expiration.toLocaleDateString(intlLocale(), { timeZone: "UTC" }));
  }
  return fields.join(" · ");
}
function instrumentKey(item: CatalogInstrument): string {
  return item.uid ?? item.instrumentUid ?? item.figi ?? `${item.ticker}:${item.classCode ?? ""}`;
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
export function InstrumentSearch() {
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
    [adding, setAdding] = useState<string | null>(null);
  const cleanQuery = query.trim();
  const current = response.revision === revision && response.owner === state.owner;
  const busy = !!cleanQuery && !current;
  const results = cleanQuery
    ? current
      ? response.items
      : []
    : state.rows.map(watchlistInstrument);
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
  return (
    <Modal
      id="instrument-dialog"
      title={t("Поиск инструментов")}
      onClose={() => controller.setDialog(null)}
    >
      <div className="instrument-search-input">
        <input
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
          onChange={(event) => {
            const query = event.currentTarget.value;
            setSearch((request) => ({
              ...request,
              query,
              revision: request.revision + 1
            }));
          }}
        />
      </div>
      <div
        id="instrument-kind"
        className="instrument-search-kinds"
        role="group"
        aria-label={t("Тип инструмента")}
        hidden={!cleanQuery}
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
      <div id="instrument-results" aria-busy={busy}>
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
            const key = instrumentKey(item);
            const row = cleanQuery ? undefined : state.rows[index];
            const added =
              !!row ||
              state.rows.some(
                (row) => row.uid != null && row.uid === (item.uid ?? item.instrumentUid)
              );
            const details = metadata(item);
            return (
              <button
                key={`${key}:${index}`}
                type="button"
                className="instrument-result"
                data-add-instrument={index}
                disabled={adding != null}
                onClick={() => {
                  const owner = state.owner;
                  setAdding(key);
                  if (window.matchMedia("(max-width: 800px)").matches)
                    controller.panel.closeMobile();
                  const action = row
                    ? controller.setPreferences({ symbol: row.symbol, instrumentUid: row.uid })
                    : controller.addInstrument(item);
                  if (row) controller.setDialog(null);
                  void action
                    .catch((error: unknown) => {
                      if (controller.getSnapshot().owner === owner)
                        controller.notify(
                          error instanceof Error ? error.message : t("Не удалось добавить")
                        );
                    })
                    .finally(() => setAdding(null));
                }}
              >
                <CatalogLogo item={item} />
                <span className="instrument-result-copy">
                  <span className="instrument-result-title">
                    <strong>{item.ticker}</strong>
                    <span className="instrument-kind-badge">{kindLabel(item)}</span>
                  </span>
                  <span className="instrument-result-name">{item.name}</span>
                  {details && <small className="instrument-result-meta">{details}</small>}
                </span>
                <span
                  className="instrument-result-action"
                  aria-label={
                    adding === key ? t("Добавление") : added ? t("Открыть") : t("Добавить")
                  }
                >
                  {adding === key ? "…" : added ? t("Открыть") : "＋"}
                </span>
              </button>
            );
          })
        )}
      </div>
      <small id="instrument-search-help">
        {t(
          "Bybit · публичные котировки без ключа. Т‑Банк · личный ключ для российских инструментов. USDT-контракт и токенизированная акция не являются обычной акцией."
        )}
      </small>
    </Modal>
  );
}

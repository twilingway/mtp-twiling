import { useEffect, useState } from "react";
import type { CatalogInstrument, MarketRow } from "../../model/types.js";
import { useTerminal } from "./context.js";
import { Modal } from "./Modal.js";
type Kind = "all" | "share" | "future" | "index";
const KINDS: { kind: Kind; label: string }[] = [
  { kind: "all", label: "Все" },
  { kind: "share", label: "Акции" },
  { kind: "future", label: "Фьючерсы" },
  { kind: "index", label: "Индексы" }
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
  const kind = item.kind ?? item.instrumentType;
  return kind === "future"
    ? "Фьючерс"
    : kind === "index"
      ? "Индекс"
      : kind === "share"
        ? "Акция"
        : "Инструмент";
}
function metadata(item: CatalogInstrument): string {
  const fields = [item.classCode, item.currency?.toUpperCase()].filter(Boolean);
  if (item.expirationDate) {
    const expiration = new Date(item.expirationDate);
    if (Number.isFinite(expiration.getTime()))
      fields.push("до " + expiration.toLocaleDateString("ru-RU"));
  }
  return fields.join(" · ");
}
function instrumentKey(item: CatalogInstrument): string {
  return item.uid ?? item.instrumentUid ?? item.figi ?? `${item.ticker}:${item.classCode ?? ""}`;
}
function watchlistInstrument(row: MarketRow): CatalogInstrument {
  return {
    ticker: row.ticker,
    name: row.name,
    currency: row.currency,
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
              error: error instanceof Error ? error.message : "Поиск недоступен"
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
      title="Поиск инструментов"
      onClose={() => controller.setDialog(null)}
    >
      <div className="instrument-search-input">
        <input
          id="instrument-query"
          type="search"
          aria-label="Тикер или название"
          aria-controls="instrument-results"
          aria-describedby="instrument-search-help"
          placeholder="Тикер или часть названия"
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
        aria-label="Тип инструмента"
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
            {item.label}
          </button>
        ))}
      </div>
      <div id="instrument-results" aria-busy={busy}>
        {cleanQuery && error ? (
          <p role="alert">{error}</p>
        ) : busy ? (
          <p role="status">Поиск…</p>
        ) : !results.length ? (
          <p role="status">
            {cleanQuery
              ? "Инструменты не найдены."
              : "Введите часть тикера или названия, например NG или газ."}
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
                          error instanceof Error ? error.message : "Не удалось добавить"
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
                  aria-label={adding === key ? "Добавление" : added ? "Открыть" : "Добавить"}
                >
                  {adding === key ? "…" : added ? "Открыть" : "＋"}
                </span>
              </button>
            );
          })
        )}
      </div>
      <small id="instrument-search-help">
        Каталог Т‑Банка · для фьючерса выбирайте срок контракта.
      </small>
    </Modal>
  );
}

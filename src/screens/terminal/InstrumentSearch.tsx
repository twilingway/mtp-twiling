import { useEffect, useState } from "react";
import type { CatalogInstrument } from "../../model/types.js";
import { useTerminal } from "./context.js";
import { Modal } from "./Modal.js";
type Kind = "all" | "share" | "future" | "index";
export function InstrumentSearch() {
  const { controller, state } = useTerminal(),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState<Kind>("all"),
    [results, setResults] = useState<CatalogInstrument[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [adding, setAdding] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      setBusy(true);
      setError("");
      void controller
        .searchInstruments(query, kind, abort.signal)
        .then((items) => {
          if (!abort.signal.aborted) setResults(items);
        })
        .catch((e: unknown) => {
          if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Поиск недоступен");
        })
        .finally(() => {
          if (!abort.signal.aborted) setBusy(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [controller, query, kind]);
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
          placeholder="Тикер или часть названия"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          id="instrument-kind"
          aria-label="Тип инструмента"
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
        >
          <option value="all">Все</option>
          <option value="share">Акции</option>
          <option value="future">Фьючерсы</option>
          <option value="index">Индексы</option>
        </select>
      </div>
      <div id="instrument-results">
        {error ? (
          <p role="alert">{error}</p>
        ) : busy ? (
          <p>Поиск…</p>
        ) : !query ? (
          <p>Введите часть тикера или названия, например NG или газ.</p>
        ) : !results.length ? (
          <p>Инструменты не найдены.</p>
        ) : (
          results.map((item, index) => (
            <button
              key={item.uid ?? index}
              className="instrument-result"
              data-add-instrument={index}
              disabled={adding != null}
              onClick={() => {
                setAdding(item.uid ?? item.ticker);
                void controller
                  .addInstrument(item)
                  .catch((e: unknown) =>
                    controller.notify(e instanceof Error ? e.message : "Не удалось добавить")
                  )
                  .finally(() => setAdding(null));
              }}
            >
              <strong>{item.ticker}</strong>
              <span>{item.name}</span>
              <small>
                {item.kind === "future" ? "Фьючерс" : item.kind === "index" ? "Индекс" : "Акция"}
                {item.expirationDate
                  ? " · до " + new Date(item.expirationDate).toLocaleDateString("ru-RU")
                  : ""}
              </small>
              <b>{state.rows.some((row) => row.uid === item.uid) ? "Открыть" : "＋"}</b>
            </button>
          ))
        )}
      </div>
      <small>Каталог Т‑Банка · поиск по вхождению · для фьючерса выбирайте срок контракта.</small>
    </Modal>
  );
}

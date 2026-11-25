import { t, systemText } from "../../i18n/messages.js";
import { timeZoneOffset } from "../../i18n/timezones.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import type { MarketRow } from "../../model/types.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { WatchlistPosition } from "../../services/watchlist-order.js";
import { precision } from "../../charts/adapter.js";
import { useTerminal } from "./context.js";
import { number, signClass, timeLabel } from "./state.js";
import { WatchlistMenu } from "./WatchlistMenu.js";
import { matchesWatchlistFlag } from "../../model/watchlist-flags.js";
import { WatchlistFlagFilter } from "./WatchlistFlagFilter.js";
import { InstrumentIcon, QuoteRow } from "./WatchlistQuoteRow.js";
export { InstrumentIcon } from "./WatchlistQuoteRow.js";
type SortKey = "symbol" | "price" | "change" | "changePercent";
export function Watchlist() {
  const { controller, state } = useTerminal();
  const drag = useRef<{ owner: string; source: WatchlistPosition } | null>(null);
  const suppressClickUntil = useRef(0);
  const [dragSource, setDragSource] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    index: number;
    placement: "before" | "after";
  } | null>(null);
  const [menu, setMenu] = useState<{
    row: MarketRow;
    x: number;
    y: number;
    owner: string;
    mode?: "flag";
  } | null>(null);
  useEffect(() => {
    setMenu(null);
    drag.current = null;
    setDragSource(null);
    setDropTarget(null);
  }, [state.owner, state.chartRevision, state.importingBackup, state.importRecoveryRequired]);
  const closeMenu = useCallback(() => setMenu(null), []);
  const remove = (row: MarketRow) => {
    closeMenu();
    void controller
      .removeInstrument(row)
      .catch((error: unknown) =>
        controller.notify(
          error instanceof Error ? error.message : t("Не удалось удалить инструмент.")
        )
      );
  };
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState<SortKey | null>(null),
    [direction, setDirection] = useState(-1);
  const endDrag = () => {
    if (drag.current) suppressClickUntil.current = Date.now() + 250;
    drag.current = null;
    setDragSource(null);
    setDropTarget(null);
  };
  const placementAt = (event: DragEvent<HTMLTableRowElement>): "before" | "after" => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
  };
  const startDrag = (event: DragEvent<HTMLTableRowElement>, source: WatchlistPosition) => {
    if (event.target instanceof Element && event.target.closest("button")) {
      event.preventDefault();
      return;
    }
    closeMenu();
    drag.current = { owner: state.owner, source };
    setDragSource(source.index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-mtp-watchlist", String(source.index));
  };
  const overRow = (event: DragEvent<HTMLTableRowElement>, target: WatchlistPosition) => {
    const current = drag.current;
    if (!current || current.owner !== state.owner) return;
    if (current.source.index === target.index) {
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({ index: target.index, placement: placementAt(event) });
  };
  const dropRow = (event: DragEvent<HTMLTableRowElement>, target: WatchlistPosition) => {
    const current = drag.current;
    if (!current || current.owner !== state.owner) return;
    event.preventDefault();
    const placement = placementAt(event);
    endDrag();
    if (current.source.index === target.index) return;
    void controller
      .reorderWatchlist({ source: current.source, target, placement }, current.owner)
      .then((changed) => {
        if (changed && controller.getSnapshot().owner === current.owner) setSort(null);
      })
      .catch((error: unknown) => {
        if (controller.getSnapshot().owner === current.owner)
          controller.notify(
            error instanceof Error ? error.message : t("Не удалось сохранить порядок.")
          );
      });
  };
  const visible = state.rows
    .map((row, index) => ({ row, position: { index, uid: row.uid, symbol: row.symbol } }))
    .filter(({ row }) =>
      matchesWatchlistFlag(
        row,
        state.preferences.watchlistFlags,
        state.preferences.watchlistFlagFilter
      )
    )
    .filter(({ row }) =>
      `${row.symbol} ${row.ticker} ${row.name}`
        .toLocaleLowerCase("ru-RU")
        .includes(query.trim().toLocaleLowerCase("ru-RU"))
    );
  if (sort)
    visible.sort((a, b) => {
      const x = a.row[sort],
        y = b.row[sort];
      if (x == null) return y == null ? 0 : 1;
      if (y == null) return -1;
      return (
        direction *
        (typeof x === "string" && typeof y === "string"
          ? x.localeCompare(y)
          : Number(x) - Number(y))
      );
    });
  const selected = selectedMarketRow(state.rows, state.preferences),
    select = (symbol: string, instrumentUid: string | null) => {
      if (drag.current || Date.now() < suppressClickUntil.current) return;
      const owner = state.owner;
      if (window.matchMedia("(max-width: 800px)").matches) controller.panel.closeMobile();
      void controller.setPreferences({ symbol, instrumentUid }).catch((error: unknown) => {
        if (controller.getSnapshot().owner === owner)
          controller.notify(
            error instanceof Error ? error.message : t("Не удалось открыть инструмент.")
          );
      });
    };
  return (
    <aside className="watchlist-panel" aria-label={t("Список котировок")}>
      <div className="watchlist-heading">
        <h2>
          {t("Список котировок")}
          <span>{t("РФ")}</span>
        </h2>
        <button
          id="add-instrument"
          title={t("Добавить инструмент")}
          aria-label={t("Добавить инструмент")}
          onClick={() => controller.setDialog(state.authenticated ? "instruments" : "account")}
        >
          ＋
        </button>
        <button
          id="reset-order"
          title={t("Сбросить сортировку")}
          onClick={() => {
            setSort(null);
            setQuery("");
          }}
        >
          ↻
        </button>
      </div>
      <div className="watchlist-search">
        <span>⌕</span>
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
      <WatchlistFlagFilter />
      <div className="watchlist-scroll">
        <table>
          <thead>
            <tr>
              {(
                [
                  ["symbol", t("Инструмент")],
                  ["price", t("Посл. цена")],
                  ["change", t("Изм.")],
                  ["changePercent", t("Изм. %")]
                ] as [SortKey, string][]
              ).map(([key, label]) => (
                <th key={key}>
                  <button
                    data-sort={key}
                    onClick={() => {
                      setDirection(sort === key ? -direction : -1);
                      setSort(key);
                    }}
                  >
                    {t(label)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody
            id="quotes"
            onDragLeave={(event) => {
              if (
                !(event.relatedTarget instanceof Node) ||
                !event.currentTarget.contains(event.relatedTarget)
              )
                setDropTarget(null);
            }}
          >
            {visible.map(({ row, position }) => (
              <QuoteRow
                key={`${row.uid ?? row.symbol}:${position.index}`}
                row={row}
                position={position}
                dragClass={`${dragSource === position.index ? "dragging" : ""} ${dropTarget?.index === position.index ? `drop-${dropTarget.placement}` : ""}`}
                onDragStart={startDrag}
                onDragOver={overRow}
                onDrop={dropRow}
                onDragEnd={endDrag}
                selected={row === selected}
                direction={state.pricesDirection.get(row.symbol) ?? ""}
                onSelect={select}
                onRemove={remove}
                onFlag={(event, row) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  controller.setContext(null);
                  setMenu({
                    row,
                    x: rect.left,
                    y: rect.bottom + 4,
                    owner: state.owner,
                    mode: "flag"
                  });
                }}
                onContext={(event, row) => {
                  event.preventDefault();
                  controller.setContext(null);
                  setMenu({ row, x: event.clientX, y: event.clientY, owner: state.owner });
                }}
              />
            ))}
          </tbody>
        </table>
        {!visible.length && (
          <p id="empty-search">
            {state.rows.length
              ? t("Инструменты не найдены")
              : t("Список пуст. Добавьте инструмент кнопкой +.")}
          </p>
        )}
      </div>
      <div className="watchlist-meta">
        <span id="quote-count">
          {visible.length} {t("из")}
          {state.rows.length} · {state.rows.filter((row) => row.price != null).length}{" "}
          {t("с ценой")}
        </span>
        <span>{t("WebSocket · напрямую")}</span>
      </div>
      {menu && menu.owner === state.owner && <WatchlistMenu {...menu} onClose={closeMenu} />}
      {selected && (
        <section className="details">
          <div className="detail-symbol">
            <InstrumentIcon key={selected.uid} row={selected} id="detail-icon" />
            <h3 id="detail-symbol">{selected.ticker}</h3>
            <span className="market-tag" id="detail-type">
              {selected.type === "future"
                ? t("Фьючерс")
                : selected.type === "index"
                  ? t("Индекс")
                  : t("Акция")}
            </span>
          </div>
          <p id="detail-name">{selected.name}</p>
          <div className="detail-quote">
            <strong id="detail-price">{number(selected.price, precision(selected))}</strong>
            <span id="detail-currency">{selected.currency.toUpperCase()}</span>
          </div>
          <p className={`detail-change ${signClass(selected.change)}`} id="detail-change">
            {number(selected.change, precision(selected), true)} (
            {number(selected.changePercent, 2, true)}%)
          </p>
          <div className="detail-facts">
            <div>
              <span>{t("Закрытие сессии")}</span>
              <b id="detail-close">{number(selected.previousClose, precision(selected))}</b>
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
              <b>{t("Т‑Инвестиции")}</b>
            </div>
          </div>
          <p className="detail-note" id="detail-note">
            {selected.note
              ? systemText(selected.note)
              : t(
                  "Изменение — к закрытию сессии из API. При закрытом рынке показывается последняя сделка."
                )}
          </p>
        </section>
      )}
      <div className="private-note">
        <span>◈</span> {t("Личное пространство")}
      </div>
    </aside>
  );
}

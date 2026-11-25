import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import type { MarketRow } from "../../model/types.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { WatchlistPosition } from "../../services/watchlist-order.js";
import { precision } from "../../charts/adapter.js";
import { useTerminal } from "./context.js";
import { logoUrl, number, signClass, timeLabel } from "./state.js";
import { DeleteIcon } from "./VisibilityIcon.js";
import { WatchlistMenu } from "./WatchlistMenu.js";
export function InstrumentIcon({ row, id }: { row: MarketRow; id?: string }) {
  const url = logoUrl(row),
    [failed, setFailed] = useState(false);
  return (
    <span className="instrument-icon" id={id} style={{ background: row.color }}>
      {url && !failed ? (
        <img src={url} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      ) : (
        row.mark
      )}
    </span>
  );
}
const QuoteRow = memo(function QuoteRow({
  row,
  selected,
  direction,
  onSelect,
  onRemove,
  onContext,
  position,
  dragClass,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: {
  row: MarketRow;
  selected: boolean;
  direction: string;
  onSelect: (symbol: string, uid: string | null) => void;
  onRemove: (row: MarketRow) => void;
  onContext: (event: MouseEvent, row: MarketRow) => void;
  position: WatchlistPosition;
  dragClass: string;
  onDragStart: (event: DragEvent<HTMLTableRowElement>, position: WatchlistPosition) => void;
  onDragOver: (event: DragEvent<HTMLTableRowElement>, position: WatchlistPosition) => void;
  onDrop: (event: DragEvent<HTMLTableRowElement>, position: WatchlistPosition) => void;
  onDragEnd: () => void;
}) {
  const digits = precision(row);
  return (
    <tr
      className={`quote-row ${selected ? "selected" : ""} ${row.availability === "unavailable" ? "unavailable" : ""} ${dragClass}`}
      data-symbol={row.symbol}
      data-watchlist-index={position.index}
      draggable
      tabIndex={0}
      aria-selected={selected}
      title={`${row.name}${row.time ? " · Сделка " + timeLabel(row.time) + " МСК" : ""}`}
      onClick={() => onSelect(row.symbol, row.uid)}
      onContextMenu={(event) => onContext(event, row)}
      onDragStart={(event) => onDragStart(event, position)}
      onDragOver={(event) => onDragOver(event, position)}
      onDrop={(event) => onDrop(event, position)}
      onDragEnd={onDragEnd}
      onKeyDown={(e) => {
        if (e.key === "Delete") {
          e.preventDefault();
          e.stopPropagation();
          onRemove(row);
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(row.symbol, row.uid);
        }
      }}
    >
      <td>
        <span className="quote-symbol">
          <InstrumentIcon key={row.brand?.logoName ?? row.symbol} row={row} />
          <b>{row.symbol}</b>
        </span>
      </td>
      <td className={direction}>{number(row.price, digits)}</td>
      <td className={signClass(row.change)}>{number(row.change, digits, true)}</td>
      <td className={signClass(row.changePercent)}>
        <span className="quote-percent">
          {number(row.changePercent, 2, true)}
          {row.changePercent != null ? "%" : ""}
        </span>
        <button
          className="quote-remove"
          draggable={false}
          onDragStart={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          title={`Удалить ${row.ticker} из списка`}
          aria-label={`Удалить ${row.ticker} из списка`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(row);
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <DeleteIcon />
        </button>
      </td>
    </tr>
  );
});
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
  const [menu, setMenu] = useState<{ row: MarketRow; x: number; y: number; owner: string } | null>(
    null
  );
  useEffect(() => {
    setMenu(null);
    drag.current = null;
    setDragSource(null);
    setDropTarget(null);
  }, [state.owner]);
  const closeMenu = useCallback(() => setMenu(null), []);
  const remove = (row: MarketRow) => {
    closeMenu();
    void controller
      .removeInstrument(row)
      .catch((error: unknown) =>
        controller.notify(error instanceof Error ? error.message : "Не удалось удалить инструмент.")
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
            error instanceof Error ? error.message : "Не удалось сохранить порядок."
          );
      });
  };
  const visible = state.rows
    .map((row, index) => ({ row, position: { index, uid: row.uid, symbol: row.symbol } }))
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
      void controller.setPreferences({ symbol, instrumentUid });
    };
  return (
    <aside className="watchlist-panel" aria-label="Список котировок">
      <div className="watchlist-heading">
        <h2>
          Список котировок <span>РФ</span>
        </h2>
        <button
          id="add-instrument"
          title="Добавить инструмент"
          aria-label="Добавить инструмент"
          onClick={() => controller.setDialog(state.authenticated ? "instruments" : "account")}
        >
          ＋
        </button>
        <button
          id="reset-order"
          title="Сбросить сортировку"
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
          placeholder="Найти инструмент"
          aria-label="Поиск в списке"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <kbd>/</kbd>
      </div>
      <div className="watchlist-scroll">
        <table>
          <thead>
            <tr>
              {(
                [
                  ["symbol", "Инструмент"],
                  ["price", "Посл. цена"],
                  ["change", "Изм."],
                  ["changePercent", "Изм. %"]
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
                    {label}
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
              ? "Инструменты не найдены"
              : "Список пуст. Добавьте инструмент кнопкой +."}
          </p>
        )}
      </div>
      <div className="watchlist-meta">
        <span id="quote-count">
          {visible.length} из {state.rows.length} ·{" "}
          {state.rows.filter((row) => row.price != null).length} с ценой
        </span>
        <span>WebSocket · напрямую</span>
      </div>
      {menu && menu.owner === state.owner && <WatchlistMenu {...menu} onClose={closeMenu} />}
      {selected && (
        <section className="details">
          <div className="detail-symbol">
            <InstrumentIcon key={selected.uid} row={selected} id="detail-icon" />
            <h3 id="detail-symbol">{selected.ticker}</h3>
            <span className="market-tag" id="detail-type">
              {selected.type === "future"
                ? "Фьючерс"
                : selected.type === "index"
                  ? "Индекс"
                  : "Акция"}
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
              <span>Закрытие сессии</span>
              <b id="detail-close">{number(selected.previousClose, precision(selected))}</b>
            </div>
            <div>
              <span>Время последней сделки</span>
              <b id="detail-time">{timeLabel(selected.time)} МСК</b>
            </div>
            <div>
              <span>Источник</span>
              <b>Т‑Инвестиции</b>
            </div>
          </div>
          <p className="detail-note" id="detail-note">
            {selected.note ||
              "Изменение — к закрытию сессии из API. При закрытом рынке показывается последняя сделка."}
          </p>
        </section>
      )}
      <div className="private-note">
        <span>◈</span> Личное пространство
      </div>
    </aside>
  );
}

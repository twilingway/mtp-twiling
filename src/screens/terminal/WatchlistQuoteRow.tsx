import { t } from "../../i18n/messages.js";
import { timeZoneOffset } from "../../i18n/timezones.js";
import { memo, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import type { MarketRow } from "../../model/types.js";
import type { WatchlistPosition } from "../../services/watchlist-order.js";
import { precision } from "../../charts/adapter.js";
import { useTerminal } from "./context.js";
import { logoUrl, number, signClass, timeLabel } from "./state.js";
import { DeleteIcon } from "./VisibilityIcon.js";
import { WatchlistFlag } from "./WatchlistFlag.js";
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
export const QuoteRow = memo(function QuoteRow({
  row,
  selected,
  direction,
  onSelect,
  onRemove,
  onContext,
  menuId,
  onFlag,
  position,
  dragClass,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onStep
}: {
  row: MarketRow;
  selected: boolean;
  direction: string;
  onSelect: (symbol: string, uid: string | null) => void;
  onRemove: (row: MarketRow) => void;
  onContext: (event: MouseEvent, row: MarketRow) => void;
  menuId: string | undefined;
  onFlag: (event: MouseEvent<HTMLButtonElement>, row: MarketRow) => void;
  position: WatchlistPosition;
  dragClass: string;
  onDragStart: (event: DragEvent<HTMLTableRowElement>, position: WatchlistPosition) => void;
  onDragOver: (event: DragEvent<HTMLTableRowElement>, position: WatchlistPosition) => void;
  onDrop: (event: DragEvent<HTMLTableRowElement>, position: WatchlistPosition) => void;
  onDragEnd: () => void;
  onStep?: (direction: -1 | 1) => void;
}) {
  const digits = precision(row);
  const { state } = useTerminal();
  const changeTitle = t(
    row.comparisonBasis === "rolling-24h"
      ? "Изменение за последние 24 часа · Bybit"
      : row.previousClose == null
        ? "Предыдущее закрытие недоступно"
        : row.type === "future"
          ? "К предыдущему закрытию Т-Банка"
          : "К предыдущему дневному закрытию"
  );
  return (
    <tr
      className={`quote-row ${selected ? "selected" : ""} ${row.availability === "unavailable" ? "unavailable" : ""} ${dragClass}`}
      data-symbol={row.symbol}
      data-watchlist-index={position.index}
      draggable
      tabIndex={0}
      aria-selected={selected}
      title={
        row.name +
        (row.time
          ? " " +
            t("· Сделка") +
            " " +
            timeLabel(row.time) +
            " " +
            timeZoneOffset(
              state.preferences.timeZone ?? "Europe/Moscow",
              new Date(row.time).getTime()
            )
          : "")
      }
      onClick={() => onSelect(row.symbol, row.uid)}
      onContextMenu={(event) => onContext(event, row)}
      onDragStart={(event) => onDragStart(event, position)}
      onDragOver={(event) => onDragOver(event, position)}
      onDrop={(event) => onDrop(event, position)}
      onDragEnd={onDragEnd}
      onKeyDown={(e) => {
        if (e.altKey && onStep && ["ArrowUp", "ArrowDown"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          onStep(e.key === "ArrowUp" ? -1 : 1);
          return;
        }
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
          <WatchlistFlag
            row={row}
            flags={state.preferences.watchlistFlags}
            disabled={!!(state.backupBusy || state.importingBackup || state.importRecoveryRequired)}
            onOpen={onFlag}
          />
          <InstrumentIcon key={row.brand?.logoName ?? row.symbol} row={row} />
          <b>{row.ticker}</b>
        </span>
      </td>
      <td className={direction}>{number(row.price, digits)}</td>
      <td className={signClass(row.change)} title={changeTitle}>
        {number(row.change, digits, true)}
      </td>
      <td className={signClass(row.changePercent)} title={changeTitle}>
        <div className="quote-row-actions">
          <span className="quote-percent">
            {number(row.changePercent, 2, true)}
            {row.changePercent != null ? "%" : ""}
          </span>
          <button
            type="button"
            className="quote-more"
            draggable={false}
            aria-label={t("Действия с инструментом") + " " + row.ticker}
            aria-haspopup="menu"
            aria-expanded={!!menuId}
            aria-controls={menuId}
            onPointerDown={(event) => {
              if (menuId) event.stopPropagation();
            }}
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              onContext(event, row);
            }}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <span aria-hidden="true">⋯</span>
          </button>
        </div>
        <button
          className="quote-remove"
          draggable={false}
          onDragStart={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          title={t("Удалить ") + row.ticker + t(" из списка")}
          aria-label={t("Удалить ") + row.ticker + t(" из списка")}
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

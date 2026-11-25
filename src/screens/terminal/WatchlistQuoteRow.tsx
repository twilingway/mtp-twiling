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
  onFlag,
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
  onFlag: (event: MouseEvent<HTMLButtonElement>, row: MarketRow) => void;
  position: WatchlistPosition;
  dragClass: string;
  onDragStart: (event: DragEvent<HTMLTableRowElement>, position: WatchlistPosition) => void;
  onDragOver: (event: DragEvent<HTMLTableRowElement>, position: WatchlistPosition) => void;
  onDrop: (event: DragEvent<HTMLTableRowElement>, position: WatchlistPosition) => void;
  onDragEnd: () => void;
}) {
  const digits = precision(row);
  const { state } = useTerminal();
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

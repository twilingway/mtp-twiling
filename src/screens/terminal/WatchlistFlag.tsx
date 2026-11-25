import type { CSSProperties, MouseEvent, SyntheticEvent } from "react";
import type { MarketRow } from "../../model/types.js";
import {
  watchlistFlag,
  watchlistFlagKey,
  WATCHLIST_FLAG_COLORS
} from "../../model/watchlist-flags.js";
import type { WatchlistFlags } from "../../model/watchlist-flags.js";
import { flagText } from "../../i18n/messages-watchlist-flags.js";

export function stopFlagEvent(event: SyntheticEvent) {
  event.stopPropagation();
}
export function FlagIcon() {
  return (
    <svg viewBox="0 0 14 12" aria-hidden="true" focusable="false">
      <path d="M14 12 10 6 14 0H0v12Z" />
    </svg>
  );
}
export function WatchlistFlag({
  row,
  flags,
  disabled,
  onOpen
}: {
  row: MarketRow;
  flags: WatchlistFlags | undefined;
  disabled: boolean;
  onOpen: (event: MouseEvent<HTMLButtonElement>, row: MarketRow) => void;
}) {
  const color = watchlistFlag(flags, row),
    label = `${flagText("mark")}: ${row.ticker}${color ? ` · ${flagText(color)}` : ""}`;
  return (
    <button
      type="button"
      className={`watchlist-flag ${color ? "is-marked" : ""}`}
      style={{ "--flag-color": color ? WATCHLIST_FLAG_COLORS[color] : undefined } as CSSProperties}
      title={label}
      aria-label={label}
      aria-haspopup="menu"
      disabled={disabled || !watchlistFlagKey(row)}
      draggable={false}
      onPointerDown={stopFlagEvent}
      onKeyDown={stopFlagEvent}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen(event, row);
      }}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(event, row);
      }}
    >
      <FlagIcon />
    </button>
  );
}

import type { CSSProperties, KeyboardEvent } from "react";
import { WATCHLIST_FLAG_COLORS } from "../../model/watchlist-flags.js";
import type { WatchlistFlagColor } from "../../model/watchlist-flags.js";
import { flagText } from "../../i18n/messages-watchlist-flags.js";
import { stopFlagEvent } from "./WatchlistFlag.js";

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  event.stopPropagation();
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")],
    index = buttons.indexOf(document.activeElement as HTMLButtonElement),
    next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowLeft" ? -1 : 1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}
export function WatchlistFlagPalette({
  value,
  disabled,
  onChange
}: {
  value: WatchlistFlagColor | undefined;
  disabled: boolean;
  onChange: (color: WatchlistFlagColor | null) => void;
}) {
  return (
    <div
      className="watchlist-flag-palette"
      role="radiogroup"
      aria-label={flagText("palette")}
      onKeyDown={(event) => {
        if (event.key === "Escape") return;
        moveFocus(event);
      }}
      onClick={stopFlagEvent}
      onPointerDown={stopFlagEvent}
    >
      {(Object.keys(WATCHLIST_FLAG_COLORS) as WatchlistFlagColor[]).map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={flagText(color)}
          title={flagText(color)}
          disabled={disabled}
          style={{ "--flag-color": WATCHLIST_FLAG_COLORS[color] } as CSSProperties}
          onClick={() => onChange(color)}
        >
          <span />
        </button>
      ))}
      <button
        type="button"
        className="watchlist-unflag"
        role="radio"
        aria-checked={!value}
        aria-label={flagText("clear")}
        title={flagText("clear")}
        disabled={disabled || !value}
        onClick={() => onChange(null)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="7" />
          <path d="m5 15 10-10" />
        </svg>
      </button>
    </div>
  );
}

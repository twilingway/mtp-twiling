import { selectWatchlistState } from "./terminal-state-selection.js";
import { shallowEqual } from "./snapshot-selector.js";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent } from "react";
import { t } from "../../i18n/messages.js";
import { useTerminal } from "./context.js";
import { flagText } from "../../i18n/messages-watchlist-flags.js";
import { WATCHLIST_FLAG_COLORS, watchlistFlagCounts } from "../../model/watchlist-flags.js";
import type {
  WatchlistFlagColor,
  WatchlistFlagFilter as Filter
} from "../../model/watchlist-flags.js";
import { persistWatchlistFlagChange } from "./watchlist-flag-preferences.js";
import { FlagIcon } from "./WatchlistFlag.js";

export function WatchlistFlagFilter() {
  const { controller, state } = useTerminal(selectWatchlistState, shallowEqual);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<{ owner: string; left: number; top: number } | null>(null);
  const flags = state.preferences.watchlistFlags;
  const counts = watchlistFlagCounts(state.rows, flags);
  const value = state.preferences.watchlistFlagFilter ?? "all";
  const disabled = !!(state.backupBusy || state.importingBackup || state.importRecoveryRequired);
  const open = !!opened && opened.owner === state.owner && !disabled;
  const choices: Filter[] = [
    "all",
    ...(Object.keys(WATCHLIST_FLAG_COLORS) as WatchlistFlagColor[])
  ];
  useEffect(
    () => setOpened(null),
    [state.owner, state.backupBusy, state.importingBackup, state.importRecoveryRequired]
  );
  function close(focus = false) {
    setOpened(null);
    if (focus) trigger.current?.focus();
  }
  function change(next: Filter | null) {
    const owner = state.owner;
    close(true);
    void persistWatchlistFlagChange(
      controller,
      next === null ? { clear: true } : { filter: next }
    ).catch((error: unknown) => {
      if (controller.getSnapshot().owner === owner)
        controller.notify(error instanceof Error ? error.message : flagText("failed"));
    });
  }
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpened(null);
    };
    const dismiss = () => setOpened(null);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [open]);
  function navigate(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(true);
      return;
    }
    const buttons = Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []
    );
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : event.key === "ArrowDown"
            ? (current + 1) % buttons.length
            : event.key === "ArrowUp"
              ? (current + buttons.length - 1) % buttons.length
              : null;
    if (next !== null) {
      event.preventDefault();
      buttons[next]?.focus();
    }
  }
  return (
    <div className="watchlist-list-picker">
      <button
        ref={trigger}
        type="button"
        id="watchlist-flag-filter"
        className="watchlist-list-trigger"
        aria-label={`${t("Список котировок")}: ${flagText(value)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "watchlist-lists-menu" : undefined}
        disabled={disabled}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          const rect = trigger.current?.getBoundingClientRect();
          if (rect)
            setOpened({
              owner: state.owner,
              left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)),
              top: rect.bottom + 5
            });
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            trigger.current?.click();
          }
        }}
      >
        {value !== "all" && (
          <span className="watchlist-list-marker" style={{ color: WATCHLIST_FLAG_COLORS[value] }}>
            <FlagIcon />
          </span>
        )}
        <span className="watchlist-list-title">
          {value === "all" ? t("Список котировок") : flagText(value)}
        </span>
        <svg className="watchlist-list-chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </button>
      {open &&
        opened &&
        createPortal(
          <div
            ref={menu}
            id="watchlist-lists-menu"
            className="watchlist-lists-menu"
            role="menu"
            aria-label={t("Список котировок")}
            style={{
              left: opened.left,
              top: opened.top,
              maxHeight: Math.max(120, window.innerHeight - opened.top - 8)
            }}
            onKeyDown={navigate}
          >
            {choices.map((color) => (
              <button
                key={color}
                type="button"
                role="menuitemradio"
                aria-checked={value === color}
                onClick={() => change(color)}
              >
                <span
                  className="watchlist-list-marker"
                  style={{ color: color === "all" ? undefined : WATCHLIST_FLAG_COLORS[color] }}
                >
                  {color === "all" ? (
                    <svg className="watchlist-all-icon" viewBox="0 0 14 12" aria-hidden="true">
                      <path d="M1 1h12v10H1ZM4 4h6M4 7h6" />
                    </svg>
                  ) : (
                    <FlagIcon />
                  )}
                </span>
                <span>{flagText(color)}</span>
                <span className="watchlist-list-count">
                  {color === "all" ? state.rows.length : counts[color]}
                </span>
              </button>
            ))}
            <div className="watchlist-lists-divider" role="separator" />
            <button
              type="button"
              role="menuitem"
              disabled={!Object.keys(flags ?? {}).length}
              onClick={() => change(null)}
            >
              {flagText("clearAll")}
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}

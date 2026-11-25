import { t } from "../../i18n/messages.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MarketRow } from "../../model/types.js";
import { useTerminal } from "./context.js";
import { DeleteIcon } from "./VisibilityIcon.js";
import { WatchlistFlagPalette } from "./WatchlistFlagPalette.js";
import { watchlistFlag } from "../../model/watchlist-flags.js";
import type { WatchlistFlagColor } from "../../model/watchlist-flags.js";
import { persistWatchlistFlagChange } from "./watchlist-flag-preferences.js";
import { flagText } from "../../i18n/messages-watchlist-flags.js";

export function WatchlistMenu({
  row,
  x,
  y,
  mode,
  onClose
}: {
  row: MarketRow;
  x: number;
  y: number;
  mode?: "flag";
  onClose: () => void;
}) {
  const { controller, state } = useTerminal();
  const menuWidth = Math.min(mode === "flag" ? 282 : 320, window.innerWidth - 12);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const disabled = !!(state.backupBusy || state.importingBackup || state.importRecoveryRequired);
  useLayoutEffect(() => {
    const place = () =>
      setPosition({
        left: Math.max(6, Math.min(x, window.innerWidth - menuWidth - 6)),
        top: Math.max(6, Math.min(y, window.innerHeight - (ref.current?.offsetHeight ?? 100) - 6))
      });
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [x, y, menuWidth]);
  const changeFlag = (color: WatchlistFlagColor | null) => {
    const owner = state.owner;
    onClose();
    void persistWatchlistFlagChange(controller, { row, color }).catch((error: unknown) => {
      if (controller.getSnapshot().owner === owner)
        controller.notify(error instanceof Error ? error.message : flagText("failed"));
    });
  };
  const remove = () => {
    const current = controller.getSnapshot();
    if (
      current.owner !== state.owner ||
      current.backupBusy ||
      current.importingBackup ||
      current.importRecoveryRequired
    )
      return;
    onClose();
    void controller
      .removeInstrument(row)
      .catch((error: unknown) =>
        controller.notify(
          error instanceof Error ? error.message : t("Не удалось удалить инструмент.")
        )
      );
  };
  useEffect(() => {
    const previous = document.activeElement,
      owner = controller.getSnapshot().owner,
      element = ref.current;
    (
      element?.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)') ??
      element?.querySelector<HTMLButtonElement>("button:not(:disabled)")
    )?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      if (
        controller.getSnapshot().owner === owner &&
        previous instanceof HTMLElement &&
        previous.isConnected &&
        (document.activeElement === document.body || element?.contains(document.activeElement))
      )
        previous.focus({ preventScroll: true });
    };
  }, [onClose, controller]);
  return (
    <div
      ref={ref}
      role="menu"
      className="chart-context-menu watchlist-context-menu"
      style={{
        left: position.left,
        width: menuWidth,
        top: position.top
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (event.key === "Delete" && !mode) {
          event.preventDefault();
          event.stopPropagation();
          remove();
        }
      }}
    >
      <WatchlistFlagPalette
        value={watchlistFlag(state.preferences.watchlistFlags, row)}
        disabled={disabled}
        onChange={changeFlag}
      />
      {!mode && (
        <button role="menuitem" onClick={remove} disabled={disabled}>
          <DeleteIcon />{" "}
          <span>
            {t("Удалить")}
            {row.ticker} {t("из списка")}
          </span>{" "}
          <kbd>Del</kbd>
        </button>
      )}
    </div>
  );
}

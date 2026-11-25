import { t } from "../../i18n/messages.js";
import { useEffect, useRef } from "react";
import type { MarketRow } from "../../model/types.js";
import { useTerminal } from "./context.js";
import { DeleteIcon } from "./VisibilityIcon.js";

export function WatchlistMenu({
  row,
  x,
  y,
  onClose
}: {
  row: MarketRow;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const { controller } = useTerminal();
  const menuWidth = Math.min(320, window.innerWidth - 12);
  const ref = useRef<HTMLDivElement>(null);
  const remove = () => {
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
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="menu"
      className="chart-context-menu watchlist-context-menu"
      style={{
        left: Math.max(6, Math.min(x, window.innerWidth - menuWidth - 6)),
        width: menuWidth,
        top: Math.max(6, Math.min(y, window.innerHeight - 64))
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (event.key === "Delete") {
          event.preventDefault();
          event.stopPropagation();
          remove();
        }
      }}
    >
      <button role="menuitem" onClick={remove}>
        <DeleteIcon />{" "}
        <span>
          {t("Удалить")}
          {row.ticker} {t("из списка")}
        </span>{" "}
        <kbd>Del</kbd>
      </button>
    </div>
  );
}

import { t } from "../../i18n/messages.js";
import type { TerminalController } from "./controller.js";

/** Primary destinations are single actions on desktop and mobile. */
export function MobileChartTools({
  controller,
  panelOpen,
  objectsOpen,
  mobile = true,
  disabled = false,
  onAction
}: {
  controller: TerminalController;
  panelOpen: boolean;
  objectsOpen: boolean;
  mobile?: boolean;
  disabled?: boolean;
  onAction?: () => void;
}) {
  const owner = controller.getSnapshot().owner;
  const select = (tab: "watchlist" | "objects") => {
    if (disabled || controller.getSnapshot().owner !== owner) return;
    onAction?.();
    void controller.panel.select(tab, false, mobile).catch((error: unknown) => {
      if (controller.getSnapshot().owner !== owner) return;
      controller.notify(error instanceof Error ? error.message : t("Не удалось изменить панель."));
    });
  };
  return (
    <nav className="terminal-brand-destinations" aria-label={t("Разделы правой панели")}>
      <button
        type="button"
        disabled={disabled}
        aria-controls="watchlist-view"
        aria-pressed={panelOpen && !objectsOpen}
        onClick={() => select("watchlist")}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 3h12v18l-6-4-6 4V3Z" />
          <path d="M9 7h6M9 10h6" />
        </svg>
        <span>{t("Список котировок")}</span>
        {panelOpen && !objectsOpen && (
          <span className="terminal-brand-current" aria-hidden="true">
            ✓
          </span>
        )}
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-controls="objects-view"
        aria-pressed={panelOpen && objectsOpen}
        onClick={() => select("objects")}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" />
        </svg>
        <span>{t("Дерево объектов")}</span>
        {panelOpen && objectsOpen && (
          <span className="terminal-brand-current" aria-hidden="true">
            ✓
          </span>
        )}
      </button>
    </nav>
  );
}

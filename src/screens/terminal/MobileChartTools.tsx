import { t } from "../../i18n/messages.js";
import { ClockZoneControl } from "./ClockZoneControl.js";
import type { TerminalController } from "./controller.js";
import { ChartRangeControl } from "./intervals/ChartRangeControl.js";

/** Workspace actions live in the account menu; layout has one header picker. */
export function MobileChartTools({
  controller,
  panelOpen,
  objectsOpen,
  disabled = false,
  onAction
}: {
  controller: TerminalController;
  panelOpen: boolean;
  objectsOpen: boolean;
  disabled?: boolean;
  onAction?: () => void;
}) {
  const select = (tab: "chart" | "watchlist" | "objects") => {
    if (disabled) return;
    onAction?.();
    if (tab === "chart") {
      controller.panel.closeMobile();
      return;
    }
    const owner = controller.getSnapshot().owner;
    void controller.panel.select(tab, false, true).catch((error: unknown) => {
      if (controller.getSnapshot().owner !== owner) return;
      controller.notify(error instanceof Error ? error.message : t("Не удалось изменить панель."));
    });
  };
  return (
    <fieldset className="mobile-workspace-options" disabled={disabled}>
      <legend>{t("Управление графиками")}</legend>
      <nav aria-label={t("Разделы правой панели")}>
        <button
          type="button"
          aria-controls="chart-workspace"
          aria-pressed={!panelOpen}
          onClick={() => select("chart")}
        >
          {t("График")}
        </button>
        <button
          type="button"
          aria-controls="watchlist-view"
          aria-pressed={panelOpen && !objectsOpen}
          onClick={() => select("watchlist")}
        >
          {t("Список котировок")}
        </button>
        <button
          type="button"
          aria-controls="objects-view"
          aria-pressed={panelOpen && objectsOpen}
          onClick={() => select("objects")}
        >
          {t("Дерево объектов")}
        </button>
      </nav>
      <ChartRangeControl placement="toolbar" />
      <div className="mobile-workspace-zone">
        <span>{t("Часовой пояс")}</span>
        <ClockZoneControl />
      </div>
    </fieldset>
  );
}

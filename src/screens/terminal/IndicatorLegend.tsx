import { useTerminal } from "./context.js";
import { INDICATOR_NAMES } from "./state.js";
import { VisibilityIcon } from "./VisibilityIcon.js";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { indicatorLegendKeys, indicatorShown } from "../../model/indicator-legend.js";
import { persistLegendCollapsed } from "./indicator-preferences.js";
import { t } from "../../i18n/messages.js";
import { TechnicalPriceLegend } from "./TechnicalIndicatorPanels.js";

export function IndicatorLegend({ slot = 1 }: { slot?: number } = {}) {
  const { controller, state } = useTerminal(),
    p = state.preferences;
  const keys = indicatorLegendKeys(p.chartSettings, p.indicators),
    count =
      keys.length +
      (p.technicalIndicators ?? []).filter((item) => item.pane.kind === "overlay").length,
    collapsed = p.chartSettings.legendCollapsed === true;
  const itemsId = slot === 1 ? "indicator-legend-items" : `indicator-legend-items-${slot}`;
  const blocked = !!(state.backupBusy || state.importingBackup || state.importRecoveryRequired);
  const indicatorsHidden = drawingToolbarSettings(p.chartSettings).indicatorsHidden;
  return (
    <div
      id={slot === 1 ? "indicator-legend" : `indicator-legend-${slot}`}
      className="indicator-legend"
      aria-label={t("Индикаторы графика")}
      hidden={p.chartSettings.showLegend === false}
    >
      <div id={itemsId} className="indicator-legend-list" hidden={collapsed}>
        <TechnicalPriceLegend />
        {keys.map((key) => {
          const shown = indicatorShown(p.chartSettings, p.indicators, key);
          const action = `${t(shown ? "Скрыть" : "Показать")} ${t(INDICATOR_NAMES[key])}`;
          return (
            <div
              key={key}
              className={`legend-row ${shown && !indicatorsHidden ? "" : "legend-hidden"}`}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                controller.setContext({
                  x: event.clientX,
                  y: event.clientY,
                  target: { kind: "indicator", key }
                });
              }}
            >
              <button
                data-legend-indicator={key}
                onClick={() => {
                  void controller.toggleIndicator(key);
                }}
                title={action}
              >
                {t(INDICATOR_NAMES[key])}
              </button>
              <button
                data-legend-indicator={key}
                onClick={() => {
                  void controller.toggleIndicator(key);
                }}
                aria-label={action}
              >
                <VisibilityIcon hidden={!shown} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="legend-collapse"
        disabled={blocked}
        aria-expanded={!collapsed}
        aria-controls={itemsId}
        aria-label={
          collapsed
            ? `${t("Показать названия индикаторов")} (${count})`
            : t("Свернуть названия индикаторов")
        }
        title={t(collapsed ? "Показать названия индикаторов" : "Свернуть названия индикаторов")}
        onClick={() => {
          void persistLegendCollapsed(controller, !collapsed).catch((error: unknown) =>
            controller.notify(
              error instanceof Error ? error.message : t("Не удалось сохранить список индикаторов.")
            )
          );
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d={collapsed ? "M4 6l4 4 4-4" : "M4 10l4-4 4 4"}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
        {collapsed ? <span aria-hidden="true">{count}</span> : null}
      </button>
    </div>
  );
}

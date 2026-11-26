import { t } from "../../i18n/messages.js";
import { TerminalContext, useTerminal } from "./context.js";
import type { TerminalController } from "./controller.js";
import { Watchlist } from "./Watchlist.js";
import { ObjectTree } from "./drawings/ObjectTree.js";
import { PanelDivider } from "./PanelDivider.js";
import { useMobileLayout } from "./use-mobile-layout.js";

export function RightPanel({ chartEditor }: { chartEditor?: TerminalController } = {}) {
  const { controller, state } = useTerminal();
  const mobile = useMobileLayout();
  const collapsed = !!state.preferences.rightPanelCollapsed || (mobile && !state.mobilePanelOpen);
  const select = (tab: "watchlist" | "objects") => {
    const owner = state.owner;
    void controller.panel.select(tab, true, mobile).catch((error: unknown) => {
      if (controller.getSnapshot().owner !== owner) return;
      controller.notify(error instanceof Error ? error.message : t("Не удалось изменить панель."));
    });
  };
  return (
    <aside className="right-panel" aria-label={t("Правая панель")}>
      <PanelDivider />
      <div
        id="watchlist-view"
        className="right-panel-view"
        role="tabpanel"
        aria-labelledby="watchlist-button"
        hidden={collapsed || state.objectPanel}
      >
        <Watchlist chartEditor={chartEditor ?? controller} />
      </div>
      <div
        id="objects-view"
        className="right-panel-view"
        role="tabpanel"
        aria-labelledby="objects-button"
        hidden={collapsed || !state.objectPanel}
      >
        <TerminalContext value={chartEditor ?? controller}>
          <ObjectTree />
        </TerminalContext>
      </div>
      <nav
        className="right-panel-tools"
        role="tablist"
        aria-label={t("Разделы правой панели")}
        aria-orientation={mobile ? "horizontal" : "vertical"}
      >
        {mobile && (
          <button
            className="mobile-panel-back"
            role="tab"
            aria-label={t("Вернуться к графику")}
            aria-selected={collapsed}
            aria-controls="chart-panel"
            onClick={() => controller.panel.closeMobile()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 4v16M2 8h6v7H2Zm12-6v20m-3-17h6v9h-6m8-5v11" />
            </svg>
            <span>{t("График")}</span>
          </button>
        )}
        <button
          id="watchlist-button"
          role="tab"
          aria-selected={!collapsed && !state.objectPanel}
          aria-expanded={!collapsed && !state.objectPanel}
          aria-controls="watchlist-view"
          title={t("Список котировок")}
          aria-label={t("Список котировок")}
          onClick={() => select("watchlist")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 3h14v18l-7-4-7 4Z" />
            <path d="M8 7h8M8 10h8" />
          </svg>
        </button>
        <button
          id="objects-button"
          role="tab"
          aria-selected={!collapsed && state.objectPanel}
          aria-expanded={!collapsed && state.objectPanel}
          aria-controls="objects-view"
          title={t("Дерево объектов")}
          aria-label={t("Дерево объектов")}
          onClick={() => select("objects")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m2 7 10-5 10 5-10 5Zm0 5 10 5 10-5M2 17l10 5 10-5" />
          </svg>
        </button>
      </nav>
    </aside>
  );
}

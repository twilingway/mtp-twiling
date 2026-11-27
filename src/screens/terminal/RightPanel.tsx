import { t } from "../../i18n/messages.js";
import { TerminalContext, useTerminal } from "./context.js";
import type { TerminalController } from "./controller.js";
import { Watchlist } from "./Watchlist.js";
import { ObjectTree } from "./drawings/ObjectTree.js";
import { PanelDivider } from "./PanelDivider.js";
import { useMobileLayout } from "./use-mobile-layout.js";
import { selectPanelState } from "./terminal-state-selection.js";
import { shallowEqual } from "./snapshot-selector.js";

export function RightPanel({ chartEditor }: { chartEditor?: TerminalController } = {}) {
  const { controller, state } = useTerminal(selectPanelState, shallowEqual);
  const mobile = useMobileLayout();
  const collapsed = !!state.rightPanelCollapsed || (mobile && !state.mobilePanelOpen);
  const select = (tab: "watchlist" | "objects") => {
    const owner = state.owner;
    void controller.panel.select(tab).catch((error: unknown) => {
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
        role={mobile ? "region" : "tabpanel"}
        aria-labelledby={mobile ? undefined : "watchlist-button"}
        aria-label={mobile ? t("Список котировок") : undefined}
        hidden={collapsed || state.objectPanel}
      >
        <Watchlist chartEditor={chartEditor ?? controller} />
      </div>
      <div
        id="objects-view"
        className="right-panel-view"
        role={mobile ? "region" : "tabpanel"}
        aria-labelledby={mobile ? undefined : "objects-button"}
        aria-label={mobile ? t("Дерево объектов") : undefined}
        hidden={collapsed || !state.objectPanel}
      >
        <TerminalContext value={chartEditor ?? controller}>
          <ObjectTree onClose={mobile ? controller.panel.closeMobile : undefined} />
        </TerminalContext>
      </div>
      {!mobile && (
        <nav
          className="right-panel-tools"
          role="tablist"
          aria-label={t("Разделы правой панели")}
          aria-orientation="vertical"
        >
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
      )}
    </aside>
  );
}

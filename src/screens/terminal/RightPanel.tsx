import { useTerminal } from "./context.js";
import { Watchlist } from "./Watchlist.js";
import { ObjectTree } from "./drawings/ObjectTree.js";
import { PanelDivider } from "./PanelDivider.js";

export function RightPanel() {
  const { controller, state } = useTerminal();
  return (
    <aside className="right-panel" aria-label="Правая панель">
      <PanelDivider />
      <div
        id="watchlist-view"
        className="right-panel-view"
        role="tabpanel"
        aria-labelledby="watchlist-button"
        hidden={state.objectPanel}
      >
        <Watchlist />
      </div>
      <div
        id="objects-view"
        className="right-panel-view"
        role="tabpanel"
        aria-labelledby="objects-button"
        hidden={!state.objectPanel}
      >
        <ObjectTree />
      </div>
      <nav
        className="right-panel-tools"
        role="tablist"
        aria-label="Разделы правой панели"
        aria-orientation="vertical"
      >
        <button
          id="watchlist-button"
          role="tab"
          aria-selected={!state.objectPanel}
          aria-controls="watchlist-view"
          title="Список котировок"
          aria-label="Список котировок"
          onClick={() => controller.update({ objectPanel: false, contextMenu: null })}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 3h14v18l-7-4-7 4Z" />
            <path d="M8 7h8M8 10h8" />
          </svg>
        </button>
        <button
          id="objects-button"
          role="tab"
          aria-selected={state.objectPanel}
          aria-controls="objects-view"
          title="Дерево объектов"
          aria-label="Дерево объектов"
          onClick={() => controller.update({ objectPanel: true, contextMenu: null })}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m2 7 10-5 10 5-10 5Zm0 5 10 5 10-5M2 17l10 5 10-5" />
          </svg>
        </button>
      </nav>
    </aside>
  );
}

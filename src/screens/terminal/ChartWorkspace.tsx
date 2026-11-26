import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { t } from "../../i18n/messages.js";
import { chartLayout, defaultChartLayout } from "../../model/chart-workspace-layout.js";
import type {
  ChartLayoutCount,
  ChartLayoutId,
  ChartLayoutPane
} from "../../model/chart-workspace-layout.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { MarketRow } from "../../model/types.js";
import { ChartPanel } from "./ChartPanel.js";
import { useTerminal } from "./context.js";
import type { TerminalController } from "./controller.js";
import type { TerminalState } from "./state.js";
import { WorkspacePanelRuntime } from "./WorkspacePanelRuntime.js";
import { WorkspaceGridDividers } from "./WorkspaceGridDividers.js";
import { WorkspacePanelController } from "./workspace-panel-controller.js";
import { loadWorkspaceInstrument, saveWorkspaceInstrument } from "./workspace-panel-preferences.js";
import type { WorkspaceSync } from "./workspace-sync.js";
import { registerWorkspaceSync } from "./workspace-sync-controller.js";

interface WorkspaceSelection {
  activeSlot: number;
  onActivate: (slot: number, controller: TerminalController) => void;
  sync?: WorkspaceSync | undefined;
}

type WorkspacePlacement = CSSProperties & {
  "--chart-pane-column": string;
  "--chart-pane-row": string;
};

function panePlacement({
  columnStart,
  columnEnd,
  rowStart,
  rowEnd
}: ChartLayoutPane): WorkspacePlacement {
  return {
    "--chart-pane-column": `${columnStart + 1} / ${columnEnd + 1}`,
    "--chart-pane-row": `${rowStart + 1} / ${rowEnd + 1}`
  };
}

function EmptyChartTitle({ slot, open }: { slot: number; open: () => void }) {
  return (
    <div className="workspace-empty-chart">
      <button
        type="button"
        className="chart-instrument-button"
        aria-label={`${t("Инструмент графика")} ${slot} · ${t("Выберите инструмент")}`}
        onClick={open}
      >
        <span aria-hidden="true">{slot} ·</span>
        <span>{t("Выберите инструмент")}</span>
      </button>
    </div>
  );
}

function ComparisonPanel({
  pane,
  initialUid,
  parent,
  parentState,
  activeSlot,
  onActivate,
  sync
}: WorkspaceSelection & {
  pane: ChartLayoutPane;
  initialUid: string;
  parent: TerminalController;
  parentState: TerminalState;
}) {
  const { slot } = pane;
  const [uid, setUid] = useState(
    () => loadWorkspaceInstrument(parentState.owner, slot) ?? initialUid
  );
  useEffect(() => {
    if (uid && loadWorkspaceInstrument(parentState.owner, slot) === undefined)
      saveWorkspaceInstrument(parentState.owner, slot, uid);
  }, [parentState.owner, slot, uid]);
  const [controller] = useState(
    () =>
      new WorkspacePanelController(parent, slot, (next) => {
        setUid(next);
        saveWorkspaceInstrument(parentState.owner, slot, next);
      })
  );
  useEffect(() => sync && registerWorkspaceSync(sync, slot, controller), [controller, slot, sync]);
  const row = parentState.rows.find(
    (candidate): candidate is MarketRow & { uid: string } =>
      !!candidate.uid &&
      candidate.uid === uid &&
      (parentState.authenticated || !!candidate.providerRef)
  );
  const activate = () => onActivate(slot, controller);
  return (
    <div
      className="auxiliary-chart"
      data-chart-slot={slot}
      data-chart-active={activeSlot === slot}
      style={panePlacement(pane)}
      onPointerDownCapture={activate}
      onFocusCapture={activate}
      onContextMenuCapture={activate}
    >
      <WorkspacePanelRuntime controller={controller} row={row} parentState={parentState}>
        {row ? (
          <ChartPanel slot={slot} active={activeSlot === slot} gridDepth />
        ) : (
          <EmptyChartTitle slot={slot} open={() => controller.setDialog("instruments")} />
        )}
      </WorkspacePanelRuntime>
    </div>
  );
}

export function ChartWorkspace({
  count,
  layoutId,
  activeSlot,
  onActivate,
  sync
}: WorkspaceSelection & { count: ChartLayoutCount; layoutId?: ChartLayoutId }) {
  const { controller, state } = useTerminal();
  useEffect(() => sync && registerWorkspaceSync(sync, 1, controller), [controller, sync]);
  const choice = chartLayout(layoutId);
  const layout = choice?.count === count ? choice : defaultChartLayout(count);
  const primaryUid = selectedMarketRow(state.rows, state.preferences)?.uid;
  const saved = Array.from({ length: count - 1 }, (_, i) =>
    loadWorkspaceInstrument(state.owner, i + 2)
  );
  const occupied = new Set([primaryUid, ...saved]);
  const alternatives = new Set<string>();
  const missing = saved.filter((uid) => uid === undefined).length;
  if (missing)
    for (const row of state.rows) {
      if (row.uid && !occupied.has(row.uid) && (state.authenticated || row.providerRef))
        alternatives.add(row.uid);
      if (alternatives.size === missing) break;
    }
  const suggested = [...alternatives];
  const instruments = saved.map((uid) => uid ?? suggested.shift() ?? "");
  const activatePrimary = () => onActivate(1, controller);
  return (
    <div
      id="chart-workspace"
      className="chart-workspace"
      data-chart-count={count}
      data-chart-layout={layout.id}
      data-chart-stacked={layout.id.endsWith("-stack") || undefined}
      style={panePlacement(layout.panes[0]!)}
      aria-label={t("График")}
    >
      {count > 1 && !primaryUid ? (
        <section
          id="chart-panel"
          className="auxiliary-chart"
          data-chart-slot={1}
          data-chart-active={activeSlot === 1}
          aria-label={t("График инструмента")}
          onPointerDownCapture={activatePrimary}
          onFocusCapture={activatePrimary}
        >
          <EmptyChartTitle
            slot={1}
            open={() => controller.setDialog(state.ready ? "instruments" : "account")}
          />
        </section>
      ) : (
        <ChartPanel active={activeSlot === 1} activate={activatePrimary} gridDepth={count > 1} />
      )}
      {layout.panes.slice(1).map((pane, index) => {
        return (
          <ComparisonPanel
            key={`${state.owner}:${pane.slot}`}
            pane={pane}
            initialUid={instruments[index] ?? ""}
            parent={controller}
            parentState={state}
            activeSlot={activeSlot}
            onActivate={onActivate}
            sync={sync}
          />
        );
      })}
      <WorkspaceGridDividers count={count} definition={layout} owner={state.owner} />
    </div>
  );
}

import { useEffect, useState } from "react";
import { t } from "../../i18n/messages.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { MarketRow } from "../../model/types.js";
import type { ChartLayoutCount } from "./ChartLayoutControl.js";
import { ChartPanel } from "./ChartPanel.js";
import { useTerminal } from "./context.js";
import type { TerminalController } from "./controller.js";
import type { TerminalState } from "./state.js";
import { WorkspacePanelRuntime } from "./WorkspacePanelRuntime.js";
import { WorkspaceGridDividers } from "./WorkspaceGridDividers.js";
import { WorkspacePanelController } from "./workspace-panel-controller.js";
import { loadWorkspaceInstrument, saveWorkspaceInstrument } from "./workspace-panel-preferences.js";

interface WorkspaceSelection {
  activeSlot: number;
  onActivate: (slot: number, controller: TerminalController) => void;
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
  slot,
  initialUid,
  parent,
  parentState,
  activeSlot,
  onActivate
}: WorkspaceSelection & {
  slot: number;
  initialUid: string;
  parent: TerminalController;
  parentState: TerminalState;
}) {
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
      onPointerDownCapture={activate}
      onFocusCapture={activate}
      onContextMenuCapture={activate}
    >
      <WorkspacePanelRuntime controller={controller} row={row} parentState={parentState}>
        {row ? (
          <ChartPanel slot={slot} active={activeSlot === slot} />
        ) : (
          <EmptyChartTitle slot={slot} open={() => controller.setDialog("instruments")} />
        )}
      </WorkspacePanelRuntime>
    </div>
  );
}

export function ChartWorkspace({
  count,
  activeSlot,
  onActivate
}: WorkspaceSelection & { count: ChartLayoutCount }) {
  const { controller, state } = useTerminal();
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
        <ChartPanel active={activeSlot === 1} activate={activatePrimary} />
      )}
      {instruments.map((initialUid, index) => {
        const slot = index + 2;
        return (
          <ComparisonPanel
            key={`${state.owner}:${slot}`}
            slot={slot}
            initialUid={initialUid}
            parent={controller}
            parentState={state}
            activeSlot={activeSlot}
            onActivate={onActivate}
          />
        );
      })}
      <WorkspaceGridDividers count={count} />
    </div>
  );
}

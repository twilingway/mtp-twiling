import { systemText } from "./i18n/messages.js";
import { useLayoutEffect, useMemo, useState } from "react";
import { TerminalContext, useTerminal } from "./screens/terminal/context.js";
import { TerminalController } from "./screens/terminal/controller.js";
import { Toolbar } from "./screens/terminal/Toolbar.js";
import { DrivePauseBanner } from "./screens/terminal/DrivePauseBanner.js";
import { RightPanel } from "./screens/terminal/RightPanel.js";
import { ChartWorkspace } from "./screens/terminal/ChartWorkspace.js";
import { chartLayout } from "./model/chart-workspace-layout.js";
import type { ChartLayoutId } from "./model/chart-workspace-layout.js";
import { DrawingToolbar } from "./screens/terminal/DrawingToolbar.js";
import { AccountDialog } from "./screens/terminal/AccountDialog.js";
import { DeleteObjectDialog } from "./screens/terminal/DeleteObjectDialog.js";
import { InstrumentSearch } from "./screens/terminal/InstrumentSearch.js";
import {
  ChartSettingsDialog,
  IndicatorSettingsDialog
} from "./screens/terminal/ChartSettingsDialog.js";
import { DrawingSettingsDialog } from "./screens/terminal/drawings/DrawingSettingsDialog.js";
import { ContextMenu } from "./screens/terminal/drawings/ContextMenu.js";
import { TerminalLifecycle, UpdateBanner } from "./screens/terminal/TerminalLifecycle.js";
import { ThemeEffect } from "./screens/terminal/ThemeEffect.js";
import { LocaleEffect } from "./screens/terminal/LocaleEffect.js";
import { TerminalIndicatorLibrary } from "./screens/terminal/TerminalIndicatorLibrary.js";
import { TechnicalIndicatorSettings } from "./screens/terminal/TechnicalIndicatorSettings.js";
import { MarketBreadthProvider } from "./screens/terminal/MarketBreadthContext.js";
import { setActiveWorkspaceChart } from "./screens/terminal/workspace-active-chart.js";
import { WorkspaceSync } from "./screens/terminal/workspace-sync.js";
import type { WorkspaceSyncFlags } from "./screens/terminal/workspace-sync.js";
import {
  loadWorkspacePresentation,
  saveWorkspacePresentation
} from "./screens/terminal/workspace-presentation.js";
import type { WorkspacePresentation } from "./screens/terminal/workspace-presentation.js";
function Terminal() {
  const { controller, state } = useTerminal();
  const [updated, setUpdated] = useState<{ owner: string; presentation: WorkspacePresentation }>();
  const owner = state.owner;
  const saved = useMemo(() => loadWorkspacePresentation(owner), [owner]);
  const presentation = updated?.owner === owner ? updated.presentation : saved;
  const chartCount = chartLayout(presentation.layoutId)?.count ?? 1;
  const sync = useMemo(() => ({ owner, coordinator: new WorkspaceSync() }), [owner]).coordinator;
  const [selection, setSelection] = useState<{
    owner: string;
    slot: number;
    editor: TerminalController;
  }>();
  const active =
    selection?.owner === state.owner && selection.slot <= chartCount && !state.profileTransition
      ? selection
      : undefined;
  const editor = active?.editor ?? controller;
  const activeSlot = active?.slot ?? 1;
  const layoutDisabled = !state.ready || !!state.profileTransition || !!state.importingBackup;
  useLayoutEffect(() => setActiveWorkspaceChart(controller, editor), [controller, editor]);
  useLayoutEffect(() => () => sync.reset(), [sync]);
  useLayoutEffect(
    () => sync.configure(presentation.flags, activeSlot),
    [sync, presentation.flags, activeSlot]
  );
  const select = (slot: number, next: TerminalController) => {
    if (editor === next || state.profileTransition || state.importingBackup) return;
    editor.editing.cancelGesture();
    editor.setTool(null);
    editor.setContext(null);
    if (editor.getSnapshot().dialog !== "account") editor.setDialog(null);
    setSelection(slot === 1 ? undefined : { owner: state.owner, slot, editor: next });
  };
  const updatePresentation = (next: WorkspacePresentation) => {
    const current = controller.getSnapshot();
    if (
      layoutDisabled ||
      current.owner !== owner ||
      current.profileTransition ||
      current.importingBackup
    )
      return;
    saveWorkspacePresentation(owner, next);
    setUpdated({ owner, presentation: next });
  };
  const chooseLayout = (layoutId: ChartLayoutId) => {
    const count = chartLayout(layoutId)?.count;
    if (count === undefined) return;
    if (active && active.slot > count) select(1, controller);
    updatePresentation({ ...presentation, layoutId });
  };
  const changeFlag = (key: keyof WorkspaceSyncFlags, enabled: boolean) => {
    updatePresentation({ ...presentation, flags: { ...presentation.flags, [key]: enabled } });
  };
  return (
    <>
      <ThemeEffect />
      <LocaleEffect />
      <TerminalContext value={editor}>
        <Toolbar
          layout={{
            ...presentation,
            disabled: layoutDisabled,
            onLayoutChange: chooseLayout,
            onFlagChange: changeFlag
          }}
          accountController={controller}
        />
      </TerminalContext>
      <DrivePauseBanner />
      <main
        className="workspace"
        data-right-panel-collapsed={!!state.preferences.rightPanelCollapsed}
        data-mobile-panel-open={!!state.mobilePanelOpen && !state.preferences.rightPanelCollapsed}
      >
        <TerminalContext value={editor}>
          <DrawingToolbar />
        </TerminalContext>
        <ChartWorkspace
          count={chartCount}
          layoutId={presentation.layoutId}
          activeSlot={activeSlot}
          onActivate={select}
          sync={sync}
        />
        <RightPanel chartEditor={editor} />
      </main>
      {state.dialog === "account" && <AccountDialog />}
      <TerminalContext value={editor}>
        <ChartDialogs />
      </TerminalContext>
      <UpdateBanner />
      <TerminalLifecycle chartEditor={editor} />
    </>
  );
}
function ChartDialogs() {
  const { state } = useTerminal();
  return (
    <>
      {state.dialog === "instruments" && <InstrumentSearch />}
      {state.dialog === "chart-settings" && <ChartSettingsDialog />}
      {state.dialog === "indicator-settings" && <IndicatorSettingsDialog />}
      {state.dialog === "indicator-library" && <TerminalIndicatorLibrary />}
      {state.dialog === "technical-settings" &&
        state.preferences.technicalIndicators
          ?.filter((item) => item.id === state.editingTechnicalIndicator)
          .map((instance) => <TechnicalIndicatorSettings key={instance.id} instance={instance} />)}
      <DrawingSettingsDialog />
      <DeleteObjectDialog />
      <ContextMenu />
      {state.toast && (
        <div id="toast" role="status">
          {systemText(state.toast)}
        </div>
      )}
    </>
  );
}
export function App() {
  const [controller] = useState(() => new TerminalController());
  return (
    <TerminalContext value={controller}>
      <MarketBreadthProvider>
        <Terminal />
      </MarketBreadthProvider>
    </TerminalContext>
  );
}

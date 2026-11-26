import { systemText } from "./i18n/messages.js";
import { useState } from "react";
import { TerminalContext, useTerminal } from "./screens/terminal/context.js";
import { TerminalController } from "./screens/terminal/controller.js";
import { Toolbar } from "./screens/terminal/Toolbar.js";
import { DrivePauseBanner } from "./screens/terminal/DrivePauseBanner.js";
import { RightPanel } from "./screens/terminal/RightPanel.js";
import { ChartWorkspace } from "./screens/terminal/ChartWorkspace.js";
import type { ChartLayoutCount } from "./screens/terminal/ChartLayoutControl.js";
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
function Terminal() {
  const { controller, state } = useTerminal();
  const [chartCount, setChartCount] = useState<ChartLayoutCount>(1);
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
  const select = (slot: number, next: TerminalController) => {
    if (editor === next || state.profileTransition || state.importingBackup) return;
    editor.editing.cancelGesture();
    editor.setTool(null);
    editor.setContext(null);
    if (editor.getSnapshot().dialog !== "account") editor.setDialog(null);
    setSelection(slot === 1 ? undefined : { owner: state.owner, slot, editor: next });
  };
  const resize = (count: ChartLayoutCount) => {
    if (active && active.slot > count) select(1, controller);
    setChartCount(count);
  };
  return (
    <>
      <ThemeEffect />
      <LocaleEffect />
      <TerminalContext value={editor}>
        <Toolbar
          chartCount={chartCount}
          onChartCountChange={resize}
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
        <ChartWorkspace count={chartCount} activeSlot={active?.slot ?? 1} onActivate={select} />
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

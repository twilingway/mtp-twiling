import { systemText } from "./i18n/messages.js";
import { useState } from "react";
import { TerminalContext, useTerminal } from "./screens/terminal/context.js";
import { TerminalController } from "./screens/terminal/controller.js";
import { Toolbar } from "./screens/terminal/Toolbar.js";
import { DrivePauseBanner } from "./screens/terminal/DrivePauseBanner.js";
import { RightPanel } from "./screens/terminal/RightPanel.js";
import { ChartPanel } from "./screens/terminal/ChartPanel.js";
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
function Terminal() {
  const { state } = useTerminal();
  return (
    <>
      <ThemeEffect />
      <LocaleEffect />
      <Toolbar />
      <DrivePauseBanner />
      <main
        className="workspace"
        data-right-panel-collapsed={!!state.preferences.rightPanelCollapsed}
        data-mobile-panel-open={!!state.mobilePanelOpen && !state.preferences.rightPanelCollapsed}
      >
        <DrawingToolbar />
        <ChartPanel />
        <RightPanel />
      </main>
      {state.dialog === "account" && <AccountDialog />}
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
      <UpdateBanner />
      <TerminalLifecycle />
    </>
  );
}
export function App() {
  const [controller] = useState(() => new TerminalController());
  return (
    <TerminalContext value={controller}>
      <Terminal />
    </TerminalContext>
  );
}

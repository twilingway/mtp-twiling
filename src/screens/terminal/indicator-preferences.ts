import type { TerminalController } from "./controller.js";
import type { IndicatorPaneLayout } from "../../model/types.js";
import { isIndicatorPaneLayout } from "../../model/indicator-layout.js";
import type { IndicatorKey } from "../../model/types.js";

export function openLegacyIndicatorSettings(
  controller: Pick<TerminalController, "update">,
  key: IndicatorKey
): void {
  controller.update({
    editingIndicator: key,
    dialog: key === "volume" ? "chart-settings" : "indicator-settings",
    contextMenu: null
  });
}

type Controller = Pick<TerminalController, "getSnapshot" | "setPreferences">;
export async function persistIndicatorPaneLayout(
  controller: Controller,
  layout: IndicatorPaneLayout,
  valid: () => boolean
): Promise<void> {
  if (!valid() || !isIndicatorPaneLayout(layout)) return;
  await controller.setPreferences({ indicatorPaneLayout: layout }, false, valid);
}
export async function persistLegendCollapsed(
  controller: Controller,
  collapsed: boolean
): Promise<void> {
  const initial = controller.getSnapshot(),
    settings = initial.preferences.chartSettings;
  const valid = () => {
    const current = controller.getSnapshot();
    return (
      current.owner === initial.owner &&
      current.chartRevision === initial.chartRevision &&
      !current.backupBusy &&
      !current.importingBackup &&
      !current.importRecoveryRequired &&
      current.preferences.chartSettings === settings
    );
  };
  if (!valid()) return;
  await controller.setPreferences(
    { chartSettings: { ...settings, legendCollapsed: collapsed } },
    false,
    valid
  );
}

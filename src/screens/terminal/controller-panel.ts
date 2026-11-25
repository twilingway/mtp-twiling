import type { TerminalController } from "./controller.js";

/** Serialize presentation toggles so repeated clicks operate on the latest state. */
export class TerminalPanel {
  private writes: Promise<void> = Promise.resolve();
  private mobileEpoch = 0;
  constructor(private readonly controller: TerminalController) {}
  closeMobile = (): void => {
    this.mobileEpoch++;
    this.controller.update({ mobilePanelOpen: false });
  };
  select = (tab: "watchlist" | "objects", toggle = true, mobile = false): Promise<void> => {
    const owner = this.controller.getSnapshot().owner;
    const epoch = this.mobileEpoch;
    const next = this.writes.then(async () => {
      const state = this.controller.getSnapshot();
      if (state.owner !== owner || epoch !== this.mobileEpoch) return;
      const selected =
        state.preferences.rightPanelTab ?? (state.objectPanel ? "objects" : "watchlist");
      const collapsed = state.preferences.rightPanelCollapsed || (mobile && !state.mobilePanelOpen);
      const nextCollapsed = toggle && selected === tab && !collapsed;
      await this.controller.setPreferences({
        rightPanelTab: tab,
        rightPanelCollapsed: nextCollapsed
      });
      if (this.controller.getSnapshot().owner === owner && epoch === this.mobileEpoch)
        this.controller.update({ mobilePanelOpen: !nextCollapsed });
    });
    this.writes = next.catch(() => {});
    return next;
  };
}

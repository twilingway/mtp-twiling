import type { TerminalController } from "./controller.js";
import type { TerminalPreferences } from "./state.js";
import type { IndicatorKey } from "../../model/types.js";
import {
  enableIndicatorFlags,
  indicatorEnabled,
  toggleIndicatorFlags
} from "../../model/indicator-flags.js";
import { importWritable } from "./controller-transfer-guard.js";

type Controller = Pick<
  TerminalController,
  | "getSnapshot"
  | "subscribe"
  | "sessionKey"
  | "setPreferences"
  | "loadHistory"
  | "scheduleOlderHistory"
>;

async function persist(
  controller: Controller,
  patch: Partial<TerminalPreferences>,
  refresh: "full" | "volume" | "none"
): Promise<void> {
  const initial = controller.getSnapshot(),
    client = controller.sessionKey();
  const boundary = () => {
    const current = controller.getSnapshot();
    return (
      importWritable(current, initial.owner) &&
      current.chartRevision === initial.chartRevision &&
      controller.sessionKey() === client
    );
  };
  if (!boundary()) return;
  let currentBoundary = true;
  const unsubscribe = controller.subscribe(() => {
    if (!boundary()) currentBoundary = false;
  });
  const valid = () =>
    currentBoundary && boundary() && controller.getSnapshot().preferences === initial.preferences;
  try {
    await controller.setPreferences(patch, false, valid);
    if (
      refresh !== "none" &&
      currentBoundary &&
      boundary() &&
      controller.getSnapshot().preferences.indicators === patch.indicators
    ) {
      if (refresh === "full") await controller.loadHistory(true);
      else controller.scheduleOlderHistory(true);
    }
  } finally {
    unsubscribe();
  }
}

export async function changeMenuIndicator(
  controller: Controller,
  key: IndicatorKey,
  addOnly = false
): Promise<void> {
  const initial = controller.getSnapshot();
  if (!importWritable(initial)) return;
  const previous = initial.preferences,
    indicators = addOnly
      ? enableIndicatorFlags(previous.indicators, key)
      : toggleIndicatorFlags(previous.indicators, key);
  const removed = previous.chartSettings.removedIndicators;
  const nextRemoved = removed?.filter((item) => !indicatorEnabled(indicators, item));
  const revealCombined = key === "mtpAll" && previous.chartSettings.mtpAllHidden === true;
  if (
    indicators === previous.indicators &&
    nextRemoved?.length === removed?.length &&
    !revealCombined
  )
    return;
  const chartSettings = {
    ...previous.chartSettings,
    ...(nextRemoved ? { removedIndicators: nextRemoved } : {})
  };
  if (revealCombined || !indicators.mtpAll) delete chartSettings.mtpAllHidden;
  const refresh =
    revealCombined && indicators === previous.indicators
      ? "none"
      : key !== "volume"
        ? "full"
        : indicators.volume && chartSettings.volumeAverage?.enabled
          ? "volume"
          : "none";
  await persist(controller, { indicators, chartSettings }, refresh);
}

export function toggleCombinedMtpVisibility(controller: Controller): Promise<void> {
  const chartSettings = { ...controller.getSnapshot().preferences.chartSettings };
  if (chartSettings.mtpAllHidden) delete chartSettings.mtpAllHidden;
  else chartSettings.mtpAllHidden = true;
  return persist(controller, { chartSettings }, "none");
}

export async function persistMtpMenuCollapsed(controller: Controller): Promise<void> {
  const settings = controller.getSnapshot().preferences.chartSettings;
  await persist(
    controller,
    { chartSettings: { ...settings, mtpMenuCollapsed: !settings.mtpMenuCollapsed } },
    "none"
  );
}

import { isProfilePreferences } from "../../model/backup-format.js";
import { THEME_PALETTES, terminalTheme } from "../../model/theme.js";
import type { ChartSettings, IndicatorFlags } from "../../model/types.js";
import type { TerminalPreferences } from "./state.js";

export type PanelPreferences = Pick<
  TerminalPreferences,
  | "timeframe"
  | "rangeDays"
  | "engine"
  | "favoriteIntervals"
  | "indicators"
  | "chartSettings"
  | "technicalIndicators"
  | "technicalPaneLayout"
  | "indicatorPaneLayout"
>;

const noIndicators: IndicatorFlags = {
  ma: false,
  ema: false,
  volume: false,
  mtp160: false,
  mtp440: false,
  mtp640: false
};

function storageKey(owner: string, slot: number, field: "instrument" | "preferences"): string {
  return `mtp:workspace:${JSON.stringify([owner, slot])}:${field}`;
}

function read(owner: string, slot: number, field: "instrument" | "preferences"): string | null {
  try {
    return globalThis.localStorage.getItem(storageKey(owner, slot, field));
  } catch {
    return null;
  }
}

function write(owner: string, slot: number, field: "instrument" | "preferences", value: string) {
  try {
    globalThis.localStorage.setItem(storageKey(owner, slot, field), value);
  } catch {
    // The live layout remains usable when storage is blocked or full.
  }
}

export function loadWorkspaceInstrument(owner: string, slot: number): string | undefined {
  const value = read(owner, slot, "instrument");
  return value !== null && value.length <= 200 && value.trim() === value ? value : undefined;
}

export function saveWorkspaceInstrument(owner: string, slot: number, uid: string): void {
  if (uid.length <= 200 && uid.trim() === uid) write(owner, slot, "instrument", uid);
}

export function panelChartSettings(settings: ChartSettings): ChartSettings {
  const appearance = { ...settings };
  delete appearance.theme;
  if (appearance.background?.toLowerCase() === THEME_PALETTES[terminalTheme(settings)].background)
    delete appearance.background;
  return appearance;
}

function initialSettings(settings: ChartSettings): ChartSettings {
  const appearance = panelChartSettings(settings);
  for (const key of [
    "drawingTools",
    "drawingTemplates",
    "removedIndicators",
    "indicatorOptions",
    "volumeAverage",
    "legendCollapsed",
    "mtpMenuCollapsed",
    "mtpAllHidden"
  ] as const)
    delete appearance[key];
  return appearance;
}

export function loadPanelPreferences(
  owner: string,
  slot: number,
  initial: TerminalPreferences
): PanelPreferences {
  let saved: unknown;
  try {
    saved = JSON.parse(read(owner, slot, "preferences") ?? "null");
  } catch {
    // A damaged local snapshot does not affect profile preferences.
  }
  const value = isProfilePreferences(saved) ? saved : null;
  const favorites = value?.favoriteIntervals ?? initial.favoriteIntervals;
  const appearance = value?.chartSettings
    ? { ...value.chartSettings }
    : initialSettings(initial.chartSettings);
  delete appearance.theme;
  return {
    timeframe: value?.timeframe ?? initial.timeframe,
    rangeDays: value?.rangeDays ?? initial.rangeDays,
    engine: value?.engine ?? initial.engine,
    indicators: { ...noIndicators, ...value?.indicators },
    chartSettings: appearance,
    ...(favorites && { favoriteIntervals: favorites }),
    ...(value?.technicalIndicators && { technicalIndicators: value.technicalIndicators }),
    ...(value?.technicalPaneLayout && { technicalPaneLayout: value.technicalPaneLayout }),
    ...(value?.indicatorPaneLayout && { indicatorPaneLayout: value.indicatorPaneLayout })
  };
}

export function savePanelPreferences(owner: string, slot: number, value: PanelPreferences): void {
  write(owner, slot, "preferences", JSON.stringify(value));
}

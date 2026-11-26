import {
  drawingHasLineText,
  drawingStyle,
  DEFAULT_FIB_LEVELS
} from "../../../model/drawing-model.js";
import type { ResolvedDrawingStyle } from "../../../model/drawing-model.js";
import type {
  Drawing,
  DrawingDraft,
  DrawingTool,
  DrawingVisibility,
  DrawingSettings,
  FibLevelStyle
} from "../../../model/types.js";
import { isDrawing } from "../../../model/backup-format.js";
export const VISIBILITY_GROUPS = [
  ["minutes", "Минуты", 59],
  ["hours", "Часы", 24],
  ["days", "Дни", 366],
  ["weeks", "Недели", 52]
] as const;
export const defaultVisibility = (): Required<DrawingVisibility> => ({
  minutes: { enabled: true, from: 1, to: 59 },
  hours: { enabled: true, from: 1, to: 24 },
  days: { enabled: true, from: 1, to: 366 },
  weeks: { enabled: true, from: 1, to: 52 }
});
export type DraftSettings = ResolvedDrawingStyle & {
  levelStyles: FibLevelStyle[];
  oneColor: boolean;
  extend: "none" | "left" | "right" | "both";
};
export interface SettingsDraft extends DrawingDraft {
  settings: DraftSettings;
  visibility: Required<DrawingVisibility>;
}
export const draftNumber = (value: string): number => (value.trim() ? Number(value) : NaN);
export function validSettingsDrawing(value: unknown): value is Drawing {
  return (
    isDrawing(value) &&
    value.points.every((point) => Number.isFinite(new Date(point.timestamp).getTime())) &&
    VISIBILITY_GROUPS.every(
      ([group, , max]) =>
        value.visibility?.[group] === undefined || value.visibility[group].to <= max
    )
  );
}
export function settingsCandidate(draft: SettingsDraft): Drawing | null {
  const { textColor, ...settings } = draft.settings;
  const item = {
    ...draft,
    title: draft.title?.trim() ?? "",
    settings: {
      ...settings,
      ...(textColor !== undefined && { textColor }),
      extendLeft: settings.extend === "left" || settings.extend === "both",
      extendRight: settings.extend === "right" || settings.extend === "both",
      levels: settings.levelStyles.filter((level) => level.enabled).map((level) => level.value)
    }
  };
  return validSettingsDrawing(item) ? item : null;
}
export function initialSettings(value: {
  name?: DrawingTool;
  settings?: DrawingSettings;
}): DraftSettings {
  const settings = drawingStyle(value);
  const legacyEmptyText =
    value.name !== undefined &&
    drawingHasLineText(value.name) &&
    !settings.text &&
    settings.textAlign === "center" &&
    settings.textVertical === "center";
  return {
    ...settings,
    ...(legacyEmptyText && { textAlign: "left", textVertical: "top" }),
    oneColor: settings.oneColor ?? false,
    levelStyles: structuredClone(
      settings.levelStyles ??
        (value.settings?.levels
          ? value.settings.levels.map((level) => ({
              value: level,
              enabled: true,
              color: "#787b86"
            }))
          : DEFAULT_FIB_LEVELS)
    ),
    extend: settings.extendLeft
      ? settings.extendRight
        ? "both"
        : "left"
      : settings.extendRight
        ? "right"
        : "none"
  };
}
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16) : "";
}

import { drawingStyle, DEFAULT_FIB_LEVELS } from "../../../model/drawing-model.js";
import type { ResolvedDrawingStyle } from "../../../model/drawing-model.js";
import type { DrawingVisibility, DrawingSettings, FibLevelStyle } from "../../../model/types.js";
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
export function initialSettings(value: { settings?: DrawingSettings }): DraftSettings {
  const settings = drawingStyle(value);
  return {
    ...settings,
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

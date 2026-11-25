import type { DrawingVisibility, Timeframe } from "../types.js";
/** Legacy visibility has no month group. A native month must not inherit the weekly rule. */
export function drawingVisibleOnInterval(
  visibility: DrawingVisibility | undefined,
  timeframe: Timeframe
): boolean {
  if (timeframe === "1M") return true;
  const group = timeframe.endsWith("m")
    ? "minutes"
    : timeframe.endsWith("h")
      ? "hours"
      : timeframe.endsWith("d")
        ? "days"
        : "weeks";
  const rule = visibility?.[group],
    count = Number.parseInt(timeframe);
  return !rule || (rule.enabled && count >= rule.from && count <= rule.to);
}

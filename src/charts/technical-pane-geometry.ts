import type {
  TechnicalIndicatorGroup,
  TechnicalPaneLayout,
  TechnicalPanePreference
} from "../model/technical-indicator-layout.js";
import type { TechnicalPaneMetric } from "./adapter.js";

export function technicalMinimumCanvasHeight(
  lowerCount: number,
  legacyVolume = false,
  timeAxisHeight = 28
): number {
  return 160 + Math.max(0, timeAxisHeight) + 31 * (Math.max(0, lowerCount) + Number(legacyVolume));
}
/** Targets only. Root's overflow host supplies minimum canvas height; preferences remain untouched. */
export function technicalPaneGeometry(
  height: number,
  groups: readonly TechnicalIndicatorGroup[],
  legacyVolume: { heightRatio: number | null } | null = null,
  timeAxisHeight = 28
) {
  const lower = groups.filter((group) => group.key !== "price");
  const count = lower.length + Number(legacyVolume !== null);
  const total = Math.max(160 + 30 * count, height - timeAxisHeight - count);
  const minimumPrice = Math.min(total, 160);
  const targets = lower.map((group) => ({
    key: group.key,
    height: group.preference?.collapsed
      ? 30
      : Math.max(30, total * (group.preference?.heightRatio ?? 0.18))
  }));
  const requested = targets.reduce((sum, item) => sum + item.height, 0);
  const reserveVolume = legacyVolume === null ? 0 : 30;
  const budget = Math.max(30 * lower.length, total - minimumPrice - reserveVolume);
  if (requested > budget) {
    const flexible = requested - 30 * lower.length;
    const available = Math.max(0, budget - 30 * lower.length);
    for (const item of targets)
      item.height = 30 + (item.height - 30) * (flexible > 0 ? available / flexible : 0);
  }
  const rest = total - targets.reduce((sum, item) => sum + item.height, 0);
  const volume =
    legacyVolume === null
      ? 0
      : Math.max(
          30,
          Math.min(
            rest - minimumPrice,
            legacyVolume.heightRatio === null ? 95 : rest * legacyVolume.heightRatio
          )
        );
  return [
    { key: "price", height: rest - volume },
    ...(legacyVolume === null ? [] : [{ key: "legacy:volume", height: volume }]),
    ...targets
  ];
}

/** A user separator edit changes only panes whose actual height changed, not viewport-normalized peers. */
export function capturedTechnicalLayout(
  layout: readonly TechnicalPanePreference[],
  before: readonly TechnicalPaneMetric[],
  after: readonly TechnicalPaneMetric[]
): TechnicalPaneLayout | null {
  const total = after.reduce((sum, item) => sum + item.height, 0);
  if (total <= 0) return null;
  const updates: TechnicalPanePreference[] = [];
  for (const item of after) {
    if (!item.key.startsWith("pane:")) continue;
    const old = before.find((entry) => entry.key === item.key);
    if (!old || Math.abs(item.height - old.height) < 1) continue;
    const paneId = item.key.slice(5),
      saved = layout.find((entry) => entry.paneId === paneId);
    updates.push({
      paneId,
      heightRatio: Math.max(0.05, Math.min(0.8, item.height / total)),
      collapsed: saved?.collapsed === true && item.height <= 31
    });
  }
  if (!updates.length) return null;
  const ids = new Set(updates.map((item) => item.paneId));
  const result = layout.map(
    (item) => updates.find((update) => update.paneId === item.paneId) ?? { ...item }
  );
  for (const item of updates)
    if (!result.some((saved) => saved.paneId === item.paneId)) result.push(item);
  // Bound explicit overrides to the instance contract; never persist render-only normalization.
  while (result.length > 100) {
    const index = result.findIndex((item) => !ids.has(item.paneId));
    result.splice(index >= 0 ? index : 0, 1);
  }
  return result;
}

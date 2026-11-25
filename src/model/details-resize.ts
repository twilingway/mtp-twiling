export const DEFAULT_DETAILS_RATIO = 0.45;
export const MIN_DETAILS_RATIO = 0.15;
export const MAX_DETAILS_RATIO = 0.85;

export function detailsRatio(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(MIN_DETAILS_RATIO, Math.min(MAX_DETAILS_RATIO, value))
    : DEFAULT_DETAILS_RATIO;
}

/** Clamp only rendered geometry; a smaller device must not rewrite the stored preference. */
export function detailsGeometry(available: number, listChrome: number, preferred: unknown) {
  const total = Math.max(0, Number.isFinite(available) ? available : 0);
  const chrome = Math.max(0, Number.isFinite(listChrome) ? listChrome : 0);
  const minimum = Math.min(96, total * 0.35);
  const maximum = Math.max(minimum, total - Math.min(chrome + 60, total * 0.65));
  return {
    total,
    minimum: Math.max(minimum, total * MIN_DETAILS_RATIO),
    maximum: Math.min(maximum, total * MAX_DETAILS_RATIO),
    height: Math.max(
      Math.max(minimum, total * MIN_DETAILS_RATIO),
      Math.min(Math.min(maximum, total * MAX_DETAILS_RATIO), total * detailsRatio(preferred))
    )
  };
}

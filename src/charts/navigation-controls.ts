export type NavigationDirection = -1 | 1;

export function zoomSpacing(
  spacing: number,
  direction: NavigationDirection,
  minimum: number,
  maximum: number
): number {
  return Math.max(minimum, Math.min(maximum, spacing * 1.25 ** direction));
}

/** Positive pixel distance moves candles right, revealing older history. */
export function navigationDistance(
  direction: NavigationDirection,
  width: number,
  firstX: number,
  lastX: number,
  fraction = 1
): number {
  if (
    ![width, firstX, lastX, fraction].every(Number.isFinite) ||
    width <= 0 ||
    firstX > lastX ||
    fraction <= 0
  )
    return 0;
  return Math.max(1 - lastX, Math.min(width - firstX - 1, (-direction * width * fraction) / 4));
}

export function navigationCenter(width: number, firstX: number, lastX: number): number {
  return Math.max(firstX, Math.min(lastX, width / 2));
}

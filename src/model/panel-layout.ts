export function panelWidth(preferred: number | undefined, viewport: number): number {
  const fallback = viewport >= 1700 ? 420 : viewport > 1200 ? 380 : 340;
  const maximum = Math.max(240, Math.min(720, viewport - 48 - 280));
  return Math.round(
    Math.max(
      240,
      Math.min(
        maximum,
        preferred !== undefined && Number.isFinite(preferred) ? preferred : fallback
      )
    )
  );
}

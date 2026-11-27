/** Hydrated before canonical UI adoption. Legacy owners always retain their own storage reads. */
const fallback = new Map<string, string>();
let persist: ((key: string, value: string) => void) | undefined;
export const isDevicePresentationKey = (key: string): boolean =>
  key === "mtp:workspace-presentation:device" ||
  key.startsWith('mtp:workspace:["device",') ||
  key.startsWith('mtp:workspace-grid:["device",');
export function hydrateDevicePresentation(
  entries: readonly { key: string; value: string }[],
  writer: (key: string, value: string) => void
): void {
  fallback.clear();
  for (const entry of entries) fallback.set(entry.key, entry.value);
  persist = writer;
}
export function readWorkspaceLocal(key: string): string | null {
  if (isDevicePresentationKey(key) && fallback.has(key)) return fallback.get(key)!;
  try {
    const value = globalThis.localStorage.getItem(key);
    if (value !== null) return value;
  } catch {
    /* The committed stage remains readable when localStorage is blocked. */
  }
  return isDevicePresentationKey(key) ? (fallback.get(key) ?? null) : null;
}
export function writeWorkspaceLocal(key: string, value: string): void {
  if (isDevicePresentationKey(key)) {
    fallback.set(key, value);
    persist?.(key, value);
  }
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    /* Durable fallback is written through the coordinator. */
  }
}

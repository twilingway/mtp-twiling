export function isTerminalFullscreen(target: Document): boolean {
  return target.fullscreenElement === target.documentElement;
}

/** Must run directly from a user gesture while the browser still grants activation. */
export async function enterTerminalFullscreen(target: Document): Promise<boolean> {
  const root = target.documentElement;
  if (!target.fullscreenEnabled || typeof root.requestFullscreen !== "function") return false;
  try {
    await root.requestFullscreen({ navigationUI: "hide" });
    return true;
  } catch {
    return false;
  }
}

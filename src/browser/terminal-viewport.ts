const property = "--terminal-viewport-bottom-edge";

/** Keep a top-anchored shell above browser UI/keyboard without following pinch zoom. */
export function installTerminalViewport(
  target: Pick<
    Window,
    | "visualViewport"
    | "innerHeight"
    | "requestAnimationFrame"
    | "cancelAnimationFrame"
    | "addEventListener"
    | "removeEventListener"
  > = window,
  style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty"> = document.documentElement
    .style
): () => void {
  const viewport = target.visualViewport;
  if (!viewport) return () => {};
  let frame = 0;
  let previous = "";
  const update = () => {
    frame = 0;
    // A zoomed visual viewport must pan over the existing layout, not resize it.
    if (!Number.isFinite(viewport.scale) || Math.abs(viewport.scale - 1) > 0.01) return;
    const { height, offsetTop } = viewport;
    const layoutHeight = target.innerHeight;
    if (
      ![height, offsetTop, layoutHeight].every(Number.isFinite) ||
      height <= 0 ||
      layoutHeight <= 0
    )
      return;
    // Keyboard focus can pan the visual viewport. The shell remains anchored at document top;
    // its bottom may reach offsetTop + height, never the obscured part of the layout viewport.
    const next = `${Math.min(layoutHeight, Math.max(0, offsetTop) + height)}px`;
    if (next === previous) return;
    previous = next;
    style.setProperty(property, next);
  };
  const schedule = () => {
    if (!frame) frame = target.requestAnimationFrame(update);
  };
  update();
  target.addEventListener("resize", schedule);
  viewport.addEventListener("resize", schedule);
  viewport.addEventListener("scroll", schedule);
  return () => {
    target.removeEventListener("resize", schedule);
    viewport.removeEventListener("resize", schedule);
    viewport.removeEventListener("scroll", schedule);
    if (frame) target.cancelAnimationFrame(frame);
    style.removeProperty(property);
  };
}

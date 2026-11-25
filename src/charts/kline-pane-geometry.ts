import { technicalPaneGeometry } from "./technical-pane-geometry.js";

/** KLine 9 compares canvas clientHeight (an integer) with native pane height before repainting. */
export function klinePaneGeometry(...args: Parameters<typeof technicalPaneGeometry>) {
  let cumulative = 0;
  return technicalPaneGeometry(...args).map((pane) => {
    const previous = Math.round(cumulative);
    cumulative += pane.height;
    return { ...pane, height: Math.round(cumulative) - previous };
  });
}

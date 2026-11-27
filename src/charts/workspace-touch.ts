/** Let a vertical swipe scroll the stacked layout while horizontal drags still pan the chart. */
export function observeWorkspaceTouchScroll(
  container: HTMLElement,
  apply: (allowChartDrag: boolean) => void,
  plotSize?: () => { width: number; height: number }
): () => void {
  const workspace = container.closest?.<HTMLElement>(".chart-workspace");
  if (!workspace || typeof matchMedia !== "function") return () => {};
  const narrow = matchMedia("(max-width: 1050px)");
  let previous = true,
    axisTouch = false;
  const update = () => {
    const allowChartDrag = axisTouch || !narrow.matches || workspace.dataset.chartCount === "1";
    if (previous === allowChartDrag) return;
    previous = allowChartDrag;
    apply(allowChartDrag);
  };
  const start = (event: TouchEvent) => {
    if (!plotSize || event.touches.length !== 1) return;
    const touch = event.touches[0]!,
      rect = container.getBoundingClientRect(),
      plot = plotSize(),
      x = touch.clientX - rect.left,
      y = touch.clientY - rect.top;
    // The library reads vertTouchDrag for both pane scrolling and price-axis scaling.
    axisTouch = x >= plot.width && x <= rect.width && y >= 0 && y < plot.height;
    update();
  };
  const end = () => {
    axisTouch = false;
    update();
  };
  const layout = new MutationObserver(update);
  layout.observe(workspace, { attributes: true, attributeFilter: ["data-chart-count"] });
  narrow.addEventListener("change", update);
  container.addEventListener?.("touchstart", start, { capture: true, passive: true });
  container.addEventListener?.("touchend", end, true);
  container.addEventListener?.("touchcancel", end, true);
  update();
  return () => {
    layout.disconnect();
    narrow.removeEventListener("change", update);
    container.removeEventListener?.("touchstart", start, true);
    container.removeEventListener?.("touchend", end, true);
    container.removeEventListener?.("touchcancel", end, true);
  };
}
import type { IChartApi } from "lightweight-charts";

export function observeLightweightTouchScroll(container: HTMLElement, chart: IChartApi) {
  return observeWorkspaceTouchScroll(
    container,
    (vertTouchDrag) => chart.applyOptions({ handleScroll: { vertTouchDrag } }),
    () => ({
      width: chart.timeScale().width(),
      height: container.clientHeight - chart.timeScale().height()
    })
  );
}

/** Let a vertical swipe scroll the stacked layout while horizontal drags still pan the chart. */
export function observeWorkspaceTouchScroll(
  container: HTMLElement,
  apply: (allowChartDrag: boolean) => void
): () => void {
  const workspace = container.closest?.<HTMLElement>(".chart-workspace");
  if (!workspace || typeof matchMedia !== "function") return () => {};
  const narrow = matchMedia("(max-width: 1050px)");
  let previous = true;
  const update = () => {
    const allowChartDrag = !narrow.matches || workspace.dataset.chartCount === "1";
    if (previous === allowChartDrag) return;
    previous = allowChartDrag;
    apply(allowChartDrag);
  };
  const layout = new MutationObserver(update);
  layout.observe(workspace, { attributes: true, attributeFilter: ["data-chart-count"] });
  narrow.addEventListener("change", update);
  update();
  return () => {
    layout.disconnect();
    narrow.removeEventListener("change", update);
  };
}

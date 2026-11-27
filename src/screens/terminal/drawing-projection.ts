import type { ChartAdapter, DrawingAxisLabels } from "../../charts/adapter.js";
import type { PixelPoint } from "../../model/types.js";

/** Seeds asynchronous/replaced adapters without scheduling another projection frame. */
export function bindDrawingAxisLabels(
  chart: () => ChartAdapter | null | undefined,
  projection: EventTarget,
  labels: DrawingAxisLabels
): () => void {
  let attached: ChartAdapter | null = null;
  const update = () => {
    const current = chart();
    const next = current && !current.retired ? current : null;
    if (next === attached) return;
    const previous = attached;
    attached = next;
    if (previous && !previous.retired) previous.setDrawingAxisLabels?.(null);
    attached?.setDrawingAxisLabels?.(labels);
  };
  projection.addEventListener("change", update);
  update();
  return () => {
    projection.removeEventListener("change", update);
    // Capture ownership: an old component must never clear its replacement's labels.
    if (attached && !attached.retired) attached.setDrawingAxisLabels?.(null);
  };
}

/** DOM annotations share the chart's completed projection, before the browser paints. */
export function bindImageProjection(
  element: Pick<HTMLDivElement, "style" | "hidden">,
  projection: EventTarget,
  project: () => PixelPoint | null,
  onPoint: (point: PixelPoint | null) => void,
  visible: boolean
): () => void {
  const update = () => {
    const candidate = project();
    const point =
      candidate && Number.isFinite(candidate.x) && Number.isFinite(candidate.y) ? candidate : null;
    onPoint(point);
    element.hidden = !point || !visible;
    if (point) element.style.transform = `translate(${point.x}px,${point.y}px)`;
  };
  projection.addEventListener("change", update);
  update();
  return () => projection.removeEventListener("change", update);
}

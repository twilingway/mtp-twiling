import type { Chart } from "klinecharts";

/** Recover KLine 9.8.12's dropped pixel-resize callback without changing axis ranges. */
export function attachKlineCanvasResize(
  chart: Pick<Chart, "getDom" | "setStyles">,
  axisWidth: () => number
): (() => void) & { refresh: () => void } {
  const root = chart.getDom();
  if (!root) return Object.assign(() => {}, { refresh() {} });
  const canvases = new Set<HTMLCanvasElement>();
  let frame = 0,
    disposed = false,
    repairing = false;
  const afterPaint = (callback: () => void) => {
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(callback);
    });
  };
  const check = () => {
    frame = 0;
    if (disposed) return;
    const ratio = window.devicePixelRatio || 1;
    const stale = [...canvases].some(
      (canvas) =>
        canvas.clientWidth > 0 &&
        canvas.clientHeight > 0 &&
        (Math.abs(canvas.width - canvas.clientWidth * ratio) > 1 ||
          Math.abs(canvas.height - canvas.clientHeight * ratio) > 1)
    );
    if (!stale) return;
    repairing = true;
    // An unchanged chart.resize() cannot re-emit the lost canvas ResizeObserver entry.
    // Public width changes resize both axis and plot canvases, preserving manual Y/camera.
    chart.setStyles({ yAxis: { size: axisWidth() + 1 } });
    afterPaint(() => {
      frame = 0;
      if (disposed) return;
      chart.setStyles({ yAxis: { size: axisWidth() } });
      repairing = false;
    });
  };
  const observer = new ResizeObserver(() => {
    if (!disposed && !repairing && !frame) afterPaint(check);
  });
  const refresh = () => {
    if (disposed) return;
    const current = new Set(root.querySelectorAll("canvas"));
    for (const canvas of canvases)
      if (!current.has(canvas)) {
        observer.unobserve(canvas);
        canvases.delete(canvas);
      }
    for (const canvas of current)
      if (!canvases.has(canvas)) {
        canvases.add(canvas);
        observer.observe(canvas);
      }
  };
  refresh();
  return Object.assign(
    () => {
      disposed = true;
      observer.disconnect();
      canvases.clear();
      cancelAnimationFrame(frame);
    },
    { refresh }
  );
}

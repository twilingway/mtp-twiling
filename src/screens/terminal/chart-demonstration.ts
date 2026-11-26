import type { PixelPoint } from "../../model/types.js";

interface PlotSize {
  width: number;
  height: number;
}

interface Stroke {
  points: PixelPoint[];
  finishedAt?: number;
}

const holdMs = 2_000;
const fadeMs = 1_000;
const maxStrokes = 16;
const maxPoints = 512;

export function demonstrationOpacity(elapsed: number, reducedMotion: boolean): number {
  if (elapsed < holdMs) return 1;
  if (elapsed >= holdMs + fadeMs) return 0;
  return reducedMotion ? 1 : 1 - (elapsed - holdMs) / fadeMs;
}

export function demonstrationPoint(
  clientX: number,
  clientY: number,
  plot: PlotSize & { left: number; top: number }
): PixelPoint | null {
  const x = clientX - plot.left;
  const y = clientY - plot.top;
  return Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    y >= 0 &&
    x < plot.width &&
    y < plot.height
    ? { x, y }
    : null;
}

function paintStroke(context: CanvasRenderingContext2D, stroke: Stroke, opacity: number): void {
  const first = stroke.points[0];
  if (!first) return;
  const path = new Path2D();
  path.moveTo(first.x, first.y);
  if (stroke.points.length === 1) {
    path.arc(first.x, first.y, 0.1, 0, Math.PI * 2);
  } else {
    for (let i = 1; i < stroke.points.length; i++) {
      const point = stroke.points[i]!;
      path.lineTo(point.x, point.y);
    }
  }
  context.globalAlpha = opacity;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 14;
  context.strokeStyle = "rgb(124 68 34 / 39%)";
  context.stroke(path);
  context.lineWidth = 10;
  context.strokeStyle = "rgb(255 182 76 / 65%)";
  context.stroke(path);
}

function consumes(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

const interactive = "button, input, select, textarea, a, [contenteditable], [role=button]";

export function startChartDemonstration(
  overlay: HTMLCanvasElement,
  host: HTMLElement,
  chart: HTMLElement,
  measure: () => PlotSize | undefined
): () => void {
  const overlayContext = overlay.getContext("2d");
  const ownerWindow = host.ownerDocument.defaultView;
  if (!overlayContext || !ownerWindow) return () => {};
  const context = overlayContext,
    view = ownerWindow;
  const document = host.ownerDocument;
  const motion = view.matchMedia("(prefers-reduced-motion: reduce)");
  const events = new AbortController();
  let strokes: Stroke[] = [];
  let live: { pointer: number; stroke: Stroke } | undefined;
  let consumedPointer: number | undefined;
  let frame: number | undefined;
  let timeout: number | undefined;

  function area() {
    const size = measure();
    const rect = chart.getBoundingClientRect();
    if (
      !size ||
      !Number.isFinite(size.width) ||
      !Number.isFinite(size.height) ||
      size.width <= 0 ||
      size.height <= 0 ||
      !rect.width ||
      !rect.height
    )
      return;
    return {
      left: rect.left,
      top: rect.top,
      width: Math.min(rect.width, size.width),
      height: Math.min(rect.height, size.height)
    };
  }

  function schedule() {
    if (timeout !== undefined) view.clearTimeout(timeout);
    timeout = undefined;
    frame ??= view.requestAnimationFrame(draw);
  }

  function draw(now: number) {
    frame = undefined;
    const plot = area();
    strokes = strokes.filter(
      ({ finishedAt }) =>
        finishedAt === undefined || demonstrationOpacity(now - finishedAt, motion.matches) > 0
    );
    if (!plot || !strokes.length) {
      overlay.width = 0;
      overlay.height = 0;
      return;
    }

    const ratio = Math.min(2, view.devicePixelRatio || 1);
    const width = Math.round(plot.width * ratio),
      height = Math.round(plot.height * ratio);
    if (overlay.width !== width || overlay.height !== height) {
      overlay.width = width;
      overlay.height = height;
      overlay.style.inlineSize = `${plot.width}px`;
      overlay.style.blockSize = `${plot.height}px`;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, plot.width, plot.height);
    let next = Infinity;
    for (const stroke of strokes) {
      const elapsed = stroke.finishedAt === undefined ? 0 : now - stroke.finishedAt;
      paintStroke(context, stroke, demonstrationOpacity(elapsed, motion.matches));
      if (stroke.finishedAt !== undefined) {
        const delay = motion.matches ? holdMs + fadeMs - elapsed : Math.max(0, holdMs - elapsed);
        next = Math.min(next, delay);
      }
    }
    if (next <= 0) schedule();
    else if (Number.isFinite(next)) timeout = view.setTimeout(schedule, next);
  }

  function finish() {
    if (!live) return;
    const { pointer, stroke } = live;
    live = undefined;
    stroke.finishedAt = view.performance.now();
    if (host.hasPointerCapture(pointer)) host.releasePointerCapture(pointer);
    schedule();
  }

  function append(point: PixelPoint): void {
    if (!live) return;
    const { stroke } = live;
    const last = stroke.points.at(-1);
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 1.5) return;
    if (stroke.points.length >= maxPoints)
      stroke.points = stroke.points.filter((_, index) => index % 2 === 0);
    stroke.points.push(point);
    schedule();
  }

  function down(event: PointerEvent) {
    if (!live && event.isPrimary) consumedPointer = undefined;
    if (
      live ||
      !event.isPrimary ||
      !event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.button !== 0 ||
      !(event.target instanceof Element) ||
      !chart.contains(event.target) ||
      event.target.closest(interactive)
    )
      return;
    const plot = area();
    const point = plot ? demonstrationPoint(event.clientX, event.clientY, plot) : null;
    if (!point) return;
    consumes(event);
    const cursor = host.querySelector<HTMLElement>(":scope > .drawing-pointer");
    if (cursor) cursor.style.display = "none";
    const stroke = { points: [point] };
    strokes = [...strokes.slice(-(maxStrokes - 1)), stroke];
    live = { pointer: event.pointerId, stroke };
    consumedPointer = event.pointerId;
    try {
      host.setPointerCapture(event.pointerId);
    } catch {
      // Document capture can still finish the gesture if native pointer capture is unavailable.
    }
    schedule();
  }

  function move(event: PointerEvent) {
    if (event.pointerId !== live?.pointer) return;
    consumes(event);
    const plot = area();
    const point = plot ? demonstrationPoint(event.clientX, event.clientY, plot) : null;
    if (!event.altKey || (event.buttons & 1) === 0 || !point) finish();
    else append(point);
  }

  function up(event: PointerEvent) {
    if (event.pointerId !== consumedPointer) return;
    consumes(event);
    const plot = area();
    const point = plot ? demonstrationPoint(event.clientX, event.clientY, plot) : null;
    if (event.altKey && point) append(point);
    finish();
  }

  function cancel(event: PointerEvent) {
    if (event.pointerId !== consumedPointer) return;
    consumes(event);
    finish();
  }

  function click(event: MouseEvent) {
    if (
      consumedPointer !== undefined &&
      event.button === 0 &&
      event.detail > 0 &&
      (!(event instanceof PointerEvent) || event.pointerId === consumedPointer) &&
      event.target instanceof Node &&
      host.contains(event.target)
    )
      consumes(event);
  }

  function keyup(event: KeyboardEvent) {
    if (event.key === "Alt") finish();
  }

  const capture = { capture: true, signal: events.signal };
  document.addEventListener("pointerdown", down, capture);
  document.addEventListener("pointermove", move, capture);
  document.addEventListener("pointerup", up, capture);
  document.addEventListener("pointercancel", cancel, capture);
  document.addEventListener("lostpointercapture", cancel, capture);
  document.addEventListener("click", click, capture);
  document.addEventListener("dblclick", click, capture);
  view.addEventListener("keyup", keyup, capture);
  view.addEventListener("blur", finish, { signal: events.signal });
  motion.addEventListener("change", schedule, { signal: events.signal });
  const resize = new ResizeObserver(() => {
    if (strokes.length) schedule();
  });
  resize.observe(chart);
  return () => {
    events.abort();
    resize.disconnect();
    finish();
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    if (timeout !== undefined) view.clearTimeout(timeout);
    overlay.width = 0;
    overlay.height = 0;
    overlay.style.removeProperty("inline-size");
    overlay.style.removeProperty("block-size");
  };
}

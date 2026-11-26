import type { PlotGeometry } from "../model/technical-indicators/presentation-types.js";

interface Point {
  x: number;
  y: number;
}

export interface FillPoint {
  x: number;
  from: number;
  to: number;
  fromBelow: boolean;
}

export function drawStudyMarker(
  context: CanvasRenderingContext2D,
  geometry: Extract<PlotGeometry, { kind: "marker" }>,
  point: Point,
  horizontalRatio = 1,
  verticalRatio = 1
): void {
  const radius = 2 + geometry.size.value;
  const distance =
    geometry.placement === "above" ? -radius - 1 : geometry.placement === "below" ? radius + 1 : 0;
  const x = point.x * horizontalRatio;
  const y = (point.y + distance) * verticalRatio;
  const dx = radius * horizontalRatio;
  const dy = radius * verticalRatio;
  if (geometry.shape === "dash") {
    const height = Math.max(1, geometry.size.value * verticalRatio);
    context.fillRect(x - dx, y - height / 2, dx * 2, height);
    return;
  }
  context.beginPath();
  if (geometry.shape === "circle") context.ellipse(x, y, dx, dy, 0, 0, Math.PI * 2);
  else {
    const tip = geometry.shape === "triangle-up" ? -dy : dy;
    context.moveTo(x, y + tip);
    context.lineTo(x + dx, y - tip);
    context.lineTo(x - dx, y - tip);
    context.closePath();
  }
  context.fill();
}

export function drawStudyRange(
  context: CanvasRenderingContext2D,
  point: Point,
  to: number,
  spacing: number,
  showEqual: boolean,
  horizontalRatio = 1,
  verticalRatio = 1
): void {
  const height = Math.abs(point.y - to) * verticalRatio;
  if (!height && !showEqual) return;
  const width = Math.max(1, spacing * 0.7 * horizontalRatio);
  const top = Math.min(point.y, to) * verticalRatio;
  context.fillRect(point.x * horizontalRatio - width / 2, top, width, Math.max(1, height));
}

export function drawStudyCandle(
  context: CanvasRenderingContext2D,
  candle: { x: number; open: number; high: number; low: number; close: number },
  spacing: number,
  wickWidth: number,
  horizontalRatio = 1,
  verticalRatio = 1
): void {
  const x = candle.x * horizontalRatio;
  const wick = Math.max(1, wickWidth * horizontalRatio);
  const height = Math.abs(candle.high - candle.low) * verticalRatio;
  if (height)
    context.fillRect(x - wick / 2, Math.min(candle.high, candle.low) * verticalRatio, wick, height);
  drawStudyRange(
    context,
    { x: candle.x, y: candle.open },
    candle.close,
    spacing,
    true,
    horizontalRatio,
    verticalRatio
  );
}

/** Split at a rendered intersection so a polygon never spans both directions. */
export function directionalFillRuns(points: readonly FillPoint[]) {
  const runs: { points: FillPoint[]; fromBelow: boolean }[] = [];
  let previous = points[0];
  if (!previous) return runs;
  let run = { points: [previous], fromBelow: previous.fromBelow };
  for (const point of points.slice(1)) {
    if (point.fromBelow !== previous.fromBelow) {
      const left = Math.abs(previous.from - previous.to);
      const right = Math.abs(point.from - point.to);
      const weight = left + right === 0 ? 0 : left / (left + right);
      const x = previous.x + (point.x - previous.x) * weight;
      const y = previous.from + (point.from - previous.from) * weight;
      const intersection = { x, from: y, to: y, fromBelow: point.fromBelow };
      run.points.push(intersection);
      runs.push(run);
      run = { points: [intersection], fromBelow: point.fromBelow };
    }
    run.points.push(point);
    previous = point;
  }
  runs.push(run);
  return runs;
}

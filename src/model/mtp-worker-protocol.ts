/** Same-origin, build-pinned protocol for the opt-in LW raster experiment. */
export const MTP_WORKER_PROTOCOL = 2;
export interface MtpPaintStyle {
  period: number;
  color: string;
  width: number;
  opacity: number;
}
export interface MtpWorkerFrame {
  dataKey: string;
  length: number;
  start: number;
  end: number;
  captureStart: number;
  captureEnd: number;
  sampleStep: number;
  x: Float64Array;
  priceOrigin: number;
  yOrigin: number;
  ySlope: number;
  styles: MtpPaintStyle[];
  width: number;
  height: number;
  padX: number;
  padY: number;
  horizontalRatio: number;
  verticalRatio: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  miterLimit: number;
  shadowColor: string;
}
export type MtpWorkerRequest =
  | { type: "hello"; protocol: number; build: string }
  | {
      type: "render";
      id: number;
      key: string;
      frame: MtpWorkerFrame;
      prefix?: Float64Array;
    };
export type MtpWorkerResponse =
  | { type: "ready"; protocol: number; build: string }
  | { type: "result"; id: number; key: string; bitmap: ImageBitmap }
  | { type: "failure"; reason: string };

type PaintContext = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "setLineDash"
  | "strokeStyle"
  | "lineWidth"
  | "globalAlpha"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "stroke"
>;

/** Exact MtpModel.draw traversal without its optional, unused-by-LW simplifier. */
export function paintMtpWorkerFrame(
  context: PaintContext,
  frame: MtpWorkerFrame,
  prefix: Float64Array
): void {
  paintRange(context, frame, prefix, false);
}

/** Continue the core's per-period sampling grid into the captured real history. */
export function paintMtpWorkerCapture(
  context: PaintContext,
  frame: MtpWorkerFrame,
  prefix: Float64Array
): void {
  paintRange(context, frame, prefix, true);
}

function paintRange(
  context: PaintContext,
  frame: MtpWorkerFrame,
  prefix: Float64Array,
  expanded: boolean
): void {
  const { start, end } = frame;
  const step = frame.sampleStep;
  context.save();
  context.setLineDash([]);
  context.strokeStyle = "#1e90ff";
  context.lineWidth = 1;
  for (const style of frame.styles) {
    const period = style.period;
    context.strokeStyle = style.color;
    context.lineWidth = style.width;
    context.globalAlpha = style.opacity;
    context.beginPath();
    let begun = false;
    const anchor = Math.max(start, period - 1);
    const first = expanded
      ? anchor + Math.ceil((Math.max(frame.captureStart, period - 1) - anchor) / step) * step
      : anchor;
    const last = expanded ? frame.captureEnd : end;
    for (let index = first; index <= last; index += step) {
      const value =
        index >= frame.length
          ? null
          : ((prefix[index + 1] ?? 0) - (prefix[index + 1 - period] ?? 0)) / period;
      const x = frame.x[index - frame.captureStart];
      const y = value === null ? null : frame.yOrigin + (value - frame.priceOrigin) * frame.ySlope;
      if (x === undefined || y === null || !Number.isFinite(x) || !Number.isFinite(y)) {
        begun = false;
        continue;
      }
      if (!begun) {
        context.moveTo(x, y);
        begun = true;
      } else context.lineTo(x, y);
    }
    context.stroke();
  }
  context.restore();
}

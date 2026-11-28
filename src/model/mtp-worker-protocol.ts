/** Same-origin, build-pinned protocol for the opt-in LW raster experiment. */
export const MTP_WORKER_PROTOCOL = 1;
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
  const { start, end } = frame;
  const step = Math.max(1, Math.ceil((end - start) / 3000));
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
    for (let index = Math.max(start, period - 1); index <= end; index += step) {
      const value =
        index >= frame.length
          ? null
          : ((prefix[index + 1] ?? 0) - (prefix[index + 1 - period] ?? 0)) / period;
      const x = frame.x[index - start];
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

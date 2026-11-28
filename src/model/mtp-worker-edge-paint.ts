import { paintMtpWorkerCapture } from "./mtp-worker-protocol.js";
import type { MtpWorkerFrame } from "./mtp-worker-protocol.js";

/** Replace only the physical side strips; the already-painted core stays untouched. */
export function paintMtpWorkerEdges(
  context: OffscreenCanvasRenderingContext2D,
  frame: MtpWorkerFrame,
  prefix: Float64Array
): void {
  if (frame.padX === 0 || (frame.captureStart === frame.start && frame.captureEnd === frame.end))
    return;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, frame.padX, frame.height);
  context.clearRect(frame.width - frame.padX, 0, frame.padX, frame.height);
  context.beginPath();
  context.rect(0, 0, frame.padX, frame.height);
  context.rect(frame.width - frame.padX, 0, frame.padX, frame.height);
  context.clip();
  context.setTransform(frame.horizontalRatio, 0, 0, frame.verticalRatio, frame.padX, frame.padY);
  paintMtpWorkerCapture(context, frame, prefix);
  context.restore();
}

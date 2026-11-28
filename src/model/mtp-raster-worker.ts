import { BUILD_ID } from "../generated/app-version.js";
import { MTP_WORKER_PROTOCOL, paintMtpWorkerFrame } from "./mtp-worker-protocol.js";
import type { MtpWorkerRequest, MtpWorkerResponse } from "./mtp-worker-protocol.js";

// DOM and Worker globals overlap in the project's browser TS lib; keep the boundary explicit.
interface RasterWorkerScope {
  onmessage: ((event: MessageEvent<MtpWorkerRequest>) => void) | null;
  postMessage(message: MtpWorkerResponse, transfer?: Transferable[]): void;
}
const scope = globalThis as unknown as RasterWorkerScope;
let accepted = false;
let prefix: Float64Array = new Float64Array(0);
let dataKey = "";
let surface: OffscreenCanvas | undefined;
scope.onmessage = ({ data }) => {
  try {
    if (data.type === "hello") {
      if (data.protocol !== MTP_WORKER_PROTOCOL || data.build !== BUILD_ID)
        throw new Error("Worker protocol/build mismatch");
      if (typeof OffscreenCanvas === "undefined") throw new Error("OffscreenCanvas unavailable");
      accepted = true;
      scope.postMessage({ type: "ready", protocol: MTP_WORKER_PROTOCOL, build: BUILD_ID });
      return;
    }
    if (!accepted) throw new Error("Missing worker handshake");
    const { frame } = data;
    if (data.prefix) {
      prefix = data.prefix;
      dataKey = frame.dataKey;
    }
    if (dataKey !== frame.dataKey || prefix.length !== frame.length + 1)
      throw new Error("Worker source revision mismatch");
    if (
      !Number.isInteger(frame.width) ||
      !Number.isInteger(frame.height) ||
      frame.width <= 0 ||
      frame.height <= 0 ||
      frame.width > 4096 ||
      frame.height > 4096 ||
      frame.width * frame.height > 4 * 1024 * 1024
    )
      throw new Error("Worker surface limit");
    surface ??= new OffscreenCanvas(0, 0);
    // Assigning dimensions also clears pixels and all context state between jobs.
    // Release the old backing before growing either axis; otherwise a tall-to-wide resize
    // can transiently allocate 4096x4096 despite both requested surfaces fitting the limit.
    surface.width = 0;
    surface.height = 0;
    surface.width = frame.width;
    surface.height = frame.height;
    const context = surface.getContext("2d");
    if (!context) throw new Error("Worker 2D context unavailable");
    context.setTransform(frame.horizontalRatio, 0, 0, frame.verticalRatio, 0, 0);
    context.lineCap = frame.lineCap;
    context.lineJoin = frame.lineJoin;
    context.miterLimit = frame.miterLimit;
    context.shadowColor = frame.shadowColor;
    paintMtpWorkerFrame(context, frame, prefix);
    const bitmap = surface.transferToImageBitmap();
    try {
      scope.postMessage({ type: "result", id: data.id, key: data.key, bitmap }, [bitmap]);
    } catch (error) {
      bitmap.close();
      throw error;
    }
  } catch (error) {
    scope.postMessage({
      type: "failure",
      reason: error instanceof Error ? error.message : "Worker render failed"
    });
  }
};

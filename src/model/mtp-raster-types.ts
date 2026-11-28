import type { MtpBitmapScope, MtpModel } from "./mtp.js";
import type { MtpWorkerRasterCache } from "./mtp-worker-raster-cache.js";

export interface MtpRasterMatrix {
  xScale: number;
  xOffset: number;
  yScale: number;
  yOffset: number;
}
/** Storage shape of the existing synchronous cache, shared only through erased type imports. */
export interface MtpRasterCached {
  surface: HTMLCanvasElement | OffscreenCanvas;
  signature: string;
  revision: number;
  resetRevision: number;
  length: number;
  firstTime: number | undefined;
  lastTime: number | undefined;
  lastClose: number | undefined;
  mode: number;
  width: number;
  height: number;
  horizontalRatio: number;
  verticalRatio: number;
  padX: number;
  padY: number;
  indices: number[];
  prices: number[];
  x: number[];
  y: number[];
  logicalFrom: number;
  logicalTo: number;
  priceLowY: number;
  priceHighY: number;
  fullHistory: boolean;
  previewOnly: boolean;
}
export interface MtpRasterEnvironment {
  canvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas | null;
  delay(action: () => void, milliseconds: number): unknown;
  cancel(timer: unknown): void;
  loadWorker?(): Promise<{ MtpWorkerRasterCache: typeof MtpWorkerRasterCache }>;
}
export interface MtpRasterFrame {
  scope: MtpBitmapScope;
  model: MtpModel;
  from: number;
  to: number;
  mode: number | undefined;
  /** Only the LW SDK's known uniform logical axis may use constant-cost camera probes. */
  uniformX?: "lightweight";
  xFor(index: number): number | null;
  yFor(price: number): number | null;
  paint(context: CanvasRenderingContext2D, from?: number, to?: number): void;
}

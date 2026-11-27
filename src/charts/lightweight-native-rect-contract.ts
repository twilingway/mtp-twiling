/** Opt-in hook inserted into the pinned SDK at build time; ordinary geometry stays native. */
export interface NativeRectContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, width: number, height: number): void;
}

export interface NativeRectScope {
  context: CanvasRenderingContext2D;
  bitmapSize: { width: number; height: number };
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
}

export type NativeRectHook = (
  scope: NativeRectScope,
  runNative: (context: NativeRectContext) => void,
  barSpacing: number
) => boolean;

declare module "lightweight-charts" {
  interface CandlestickStyleOptions {
    /** Internal opt-in renderer bridge, checked against the pinned SDK during build. */
    mtpNativeRectCull?: NativeRectHook;
  }
}

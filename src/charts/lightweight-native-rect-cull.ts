import { OpaqueRectCuller, OpaqueRectUnsupportedError } from "../model/opaque-rect-culler.js";
import type {
  NativeRectContext,
  NativeRectHook,
  NativeRectScope
} from "./lightweight-native-rect-contract.js";

const MAX_PIXELS = 4 * 1024 * 1024;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_STYLES = 255;
const MAX_PARSED_COLORS = 256;
const NAMED_COLORS = new Set(
  "black silver gray white maroon red purple fuchsia green lime olive yellow navy blue teal aqua orange rebeccapurple".split(
    " "
  )
);
const NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(%)?$/;

/** Accept a small, fully validated CSS subset; global/system/context colors stay native. */
function colorAlpha(style: string): 0 | 1 | null {
  for (let index = 0; index < style.length; index++) {
    const code = style.charCodeAt(index);
    if ((code < 32 || code > 126) && code !== 9 && code !== 10 && code !== 12 && code !== 13)
      return null;
  }
  const text = style.trim().toLowerCase();
  if (text === "transparent") return 0;
  if (NAMED_COLORS.has(text)) return 1;
  if (/^#[\da-f]{3}$|^#[\da-f]{6}$/.test(text)) return 1;
  if (/^#[\da-f]{4}$/.test(text)) return text.endsWith("0") ? 0 : text.endsWith("f") ? 1 : null;
  if (/^#[\da-f]{8}$/.test(text)) return text.endsWith("00") ? 0 : text.endsWith("ff") ? 1 : null;
  const rgb = /^(rgb|rgba)\(([^()]*)\)$/.exec(text);
  if (!rgb) return null;
  const parts = rgb[2]!.split(",").map((part) => part.trim());
  if (parts.length !== 3 && parts.length !== 4) return null;
  const percentage = parts[0]!.endsWith("%");
  for (const channel of parts.slice(0, 3)) {
    if (!NUMBER.test(channel) || channel.endsWith("%") !== percentage) return null;
    const value = Number(percentage ? channel.slice(0, -1) : channel);
    if (!Number.isFinite(value) || value < 0 || value > (percentage ? 100 : 255)) return null;
  }
  if (parts.length === 3) return rgb[1] === "rgb" ? 1 : null;
  const alpha = parts[3]!;
  if (/^[+-]?(?:0+(?:\.0+)?|\.0+)%?$/.test(alpha)) return 0;
  return /^\+?(?:1(?:\.0+)?|100(?:\.0+)?%)$/.test(alpha) ? 1 : null;
}

function supportedState(scope: NativeRectScope): boolean {
  const { context: ctx, bitmapSize, horizontalPixelRatio, verticalPixelRatio } = scope;
  const { width, height } = bitmapSize;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > MAX_PIXELS ||
    !Number.isFinite(horizontalPixelRatio) ||
    horizontalPixelRatio <= 0 ||
    !Number.isFinite(verticalPixelRatio) ||
    verticalPixelRatio <= 0 ||
    ctx.canvas.width !== width ||
    ctx.canvas.height !== height
  )
    return false;
  const matrix = ctx.getTransform();
  const attributes = ctx.getContextAttributes();
  const colorType = "colorType" in attributes ? attributes.colorType : undefined;
  const pixelFormat = "pixelFormat" in attributes ? attributes.pixelFormat : undefined;
  return (
    matrix.a === 1 &&
    matrix.b === 0 &&
    matrix.c === 0 &&
    matrix.d === 1 &&
    matrix.e === 0 &&
    matrix.f === 0 &&
    ctx.globalAlpha === 1 &&
    ctx.globalCompositeOperation === "source-over" &&
    ctx.filter === "none" &&
    ctx.shadowBlur === 0 &&
    ctx.shadowOffsetX === 0 &&
    ctx.shadowOffsetY === 0 &&
    colorAlpha(ctx.shadowColor) === 0 &&
    attributes.colorSpace === "srgb" &&
    (colorType === "unorm8" || pixelFormat === "rgba-unorm8") &&
    (colorType === undefined || colorType === "unorm8") &&
    (pixelFormat === undefined || pixelFormat === "rgba-unorm8")
  );
}

/** Record and cull completely before changing the native canvas; paint errors never trigger fallback. */
export function createLightweightNativeRectCull() {
  let core: OpaqueRectCuller | null = null;
  let bitmapWidth = 0,
    bitmapHeight = 0,
    disposed = false;
  const release = () => {
    core?.dispose();
    core = null;
    bitmapWidth = bitmapHeight = 0;
  };
  const hook: NativeRectHook = (scope, runNative, barSpacing) => {
    if (
      disposed ||
      !Number.isFinite(barSpacing) ||
      barSpacing <= 0 ||
      barSpacing >= 1 ||
      barSpacing * scope.horizontalPixelRatio >= 1
    ) {
      release();
      return false;
    }
    let finalStyle: NativeRectContext["fillStyle"] = "#000000";
    let paintCore: OpaqueRectCuller;
    const palette: string[] = [];
    try {
      if (!supportedState(scope)) {
        release();
        return false;
      }
      finalStyle = scope.context.fillStyle;
      const { width, height } = scope.bitmapSize;
      if (core && (bitmapWidth !== width || bitmapHeight !== height)) release();
      if (!core) {
        core = new OpaqueRectCuller(width, height);
        bitmapWidth = width;
        bitmapHeight = height;
      }
      const current = core;
      if (current.memoryBytes > MAX_BYTES) {
        release();
        return false;
      }
      current.begin();
      const styles = new Map<string, number>();
      const parsed = new Map<string, 0 | 1>();
      let styleId: number | undefined,
        tainted = false,
        active = true;
      const unsupported = (): never => {
        tainted = true;
        throw new OpaqueRectUnsupportedError("Unsupported native rectangle recording");
      };
      const selectStyle = (value: NativeRectContext["fillStyle"]): number => {
        if (!active || typeof value !== "string" || value.length > 128) return unsupported();
        let alpha = parsed.get(value);
        if (alpha === undefined) {
          if (parsed.size >= MAX_PARSED_COLORS) return unsupported();
          const result = colorAlpha(value);
          if (result === null) return unsupported();
          alpha = result;
          parsed.set(value, alpha);
        }
        if (alpha === 0) return 0;
        let id = styles.get(value);
        if (id === undefined) {
          if (palette.length >= MAX_STYLES) return unsupported();
          palette.push(value);
          id = palette.length;
          styles.set(value, id);
        }
        return id;
      };
      const recordRect = (x: number, y: number, w: number, h: number) => {
        if (!active) return unsupported();
        styleId ??= selectStyle(finalStyle);
        if (
          !Number.isSafeInteger(x) ||
          !Number.isSafeInteger(y) ||
          !Number.isSafeInteger(w) ||
          !Number.isSafeInteger(h)
        )
          return unsupported();
        if (styleId === 0) return;
        try {
          current.addRect(x, y, w, h, styleId);
        } catch (error: unknown) {
          tainted = true;
          throw error;
        }
      };
      const recorder = new Proxy(Object.create(null) as NativeRectContext, {
        get: (_target, key) => {
          if (key === "fillStyle") return finalStyle;
          if (key !== "fillRect") return unsupported();
          return recordRect;
        },
        set: (_target, key, value: unknown) => {
          if (key !== "fillStyle" || typeof value !== "string") return unsupported();
          styleId = selectStyle(value);
          finalStyle = value;
          return true;
        },
        defineProperty: () => unsupported(),
        deleteProperty: () => unsupported()
      });
      try {
        const result: unknown = runNative(recorder);
        if (result !== undefined || tainted || disposed || core !== current) unsupported();
      } finally {
        active = false;
      }
      current.cull();
      if (current.memoryBytes > MAX_BYTES) unsupported();
      paintCore = current;
    } catch {
      release();
      return false;
    }
    // Nothing below may return false: a failure could have already changed visible pixels.
    paintCore.paint({
      setStyle: (id) => {
        scope.context.fillStyle = palette[id - 1]!;
      },
      fillRect: (x, y, width, height) => scope.context.fillRect(x, y, width, height)
    });
    if (scope.context.fillStyle !== finalStyle) scope.context.fillStyle = finalStyle;
    return true;
  };
  return {
    hook,
    dispose: () => {
      disposed = true;
      release();
    }
  };
}

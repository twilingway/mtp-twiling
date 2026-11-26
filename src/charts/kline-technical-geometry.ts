import { registerFigure } from "klinecharts";
import type { Indicator, IndicatorDrawParams } from "klinecharts";
import type {
  TechnicalRenderFill,
  TechnicalRenderOutput,
  TechnicalRenderReference
} from "./technical-render-data.js";
import { presentationRuns } from "../model/technical-indicators/presentation-geometry.js";
import { presentationColor } from "../model/technical-indicators/presentation.js";
import { lineColor } from "../model/candle-palette.js";

export const klineTechnicalIndex = Symbol("technical-data-index");
export type KlineTechnicalRow = Record<string, number | undefined> & {
  [klineTechnicalIndex]?: number;
};
export interface KlineColumnsBase {
  readonly kind: "columns-base0";
  readonly key: string;
  readonly value: 0;
  readonly plots: readonly TechnicalRenderOutput[];
}
const columnsBaseType = "mtp-ta-columns-base0";
let columnsBaseRegistered = false;
/** Native-only scale semantic, never a quote or a compiled/user-visible output. */
export function klineColumnsBase(
  outputs: readonly TechnicalRenderOutput[]
): KlineColumnsBase | null {
  const plots = outputs.filter(
    (output) => output.style.visible && output.presentation?.geometry.kind === "columns"
  );
  if (!plots.length) return null;
  if (!columnsBaseRegistered) {
    registerFigure({ name: columnsBaseType, draw: () => {}, checkEventOn: () => false });
    columnsBaseRegistered = true;
  }
  let key = "__mtpColumnsBase0";
  while (outputs.some((output) => output.outputId === key)) key += "_";
  return { kind: "columns-base0", key, value: 0, plots };
}
/** Must precede styled figures: installed v9 eachFigures then skips this scale-only custom type. */
export function klineColumnsBaseFigure(base: KlineColumnsBase) {
  return { key: base.key, type: columnsBaseType };
}
export interface KlineTechnicalContext {
  rows: KlineTechnicalRow[];
  levels: number[];
  outputs: readonly TechnicalRenderOutput[];
  fills: readonly TechnicalRenderFill[];
  columnsBase: KlineColumnsBase | null;
  disposed: boolean;
  references?: readonly TechnicalRenderReference[];
}
const referenceType = "mtp-ta-reference-level";
let referenceRegistered = false;
export function klineReferenceFigures(
  references: readonly TechnicalRenderReference[],
  outputs: readonly TechnicalRenderOutput[]
) {
  if (!references.some((level) => level.visible)) return [];
  if (!referenceRegistered) {
    registerFigure({ name: referenceType, draw: () => {}, checkEventOn: () => false });
    referenceRegistered = true;
  }
  return references
    .filter((level) => level.visible)
    .map((level) => {
      let key = `__mtpReference_${level.id}`;
      while (outputs.some((output) => output.outputId === key)) key += "_";
      return { key, type: referenceType, level };
    });
}
export function klineTechnicalContext(
  indicator: Indicator<KlineTechnicalRow>
): KlineTechnicalContext | null {
  const value: unknown = indicator.extendData;
  return value && typeof value === "object" && "context" in value
    ? (value.context as KlineTechnicalContext)
    : null;
}
export function klineTechnicalColor(output: TechnicalRenderOutput, index: number): string {
  return lineColor(
    output.presentation
      ? (presentationColor(output.presentation, index) ?? output.style.color)
      : output.style.color,
    output.style.opacity
  );
}
type Params = IndicatorDrawParams<KlineTechnicalRow>;
function clipped(params: Params, paint: () => void): void {
  const { ctx, bounding } = params;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, bounding.width, bounding.height);
  ctx.clip();
  paint();
  ctx.restore();
}
function bounds(params: Params, count: number): [number, number] {
  return [
    Math.max(0, Math.floor(params.visibleRange.from) - 1),
    Math.min(count - 1, Math.ceil(params.visibleRange.to))
  ];
}
function point(params: Params, index: number, value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const x = params.xAxis.convertToPixel(index),
    y = params.yAxis.convertToPixel(value);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
function levels(params: Params, values: readonly number[]): void {
  const { ctx, bounding, yAxis } = params;
  ctx.strokeStyle = "#787b8666";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (const value of values) {
    const y = yAxis.convertToPixel(value);
    if (!Number.isFinite(y) || y < 0 || y > bounding.height) continue;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(bounding.width, y);
    ctx.stroke();
  }
}
function plot(params: Params, output: TechnicalRenderOutput): void {
  if (!output.style.visible) return;
  const { ctx } = params,
    geometry = output.presentation?.geometry,
    [first, last] = bounds(params, output.values.length);
  ctx.lineWidth = output.style.width;
  ctx.setLineDash(
    output.style.lineStyle === "dashed" ? [6, 4] : output.style.lineStyle === "dotted" ? [2, 3] : []
  );
  if (geometry?.kind === "cross") {
    // A shared, relative-size profile; exact Pine pixel calibration remains an engine QA gate.
    const arm = 2 + geometry.size.value;
    ctx.lineWidth = Math.max(1, geometry.size.value / 2);
    ctx.setLineDash([]);
    for (let i = first; i <= last; i++) {
      const p = point(params, i, output.values[i]);
      if (!p) continue;
      ctx.strokeStyle = klineTechnicalColor(output, i);
      ctx.beginPath();
      ctx.moveTo(p.x - arm, p.y);
      ctx.lineTo(p.x + arm, p.y);
      ctx.moveTo(p.x, p.y - arm);
      ctx.lineTo(p.x, p.y + arm);
      ctx.stroke();
    }
    return;
  }
  if (output.kind === "histogram") {
    const base = params.yAxis.convertToPixel(0),
      width = Math.max(1, params.barSpace.gapBar);
    if (!Number.isFinite(base)) return;
    for (let i = first; i <= last; i++) {
      const p = point(params, i, output.values[i]);
      if (!p) continue;
      ctx.fillStyle = klineTechnicalColor(output, i);
      ctx.fillRect(p.x - width / 2, Math.min(base, p.y), width, Math.abs(base - p.y));
    }
    return;
  }
  const connect = geometry?.kind === "line" && geometry.gaps === "legacy";
  for (const run of connect
    ? [{ first, last }]
    : presentationRuns(output.values, undefined, first, last)) {
    let previous: ReturnType<typeof point> = null,
      color = "",
      drawing = false;
    const finish = () => {
      if (drawing) ctx.stroke();
      drawing = false;
    };
    for (let i = run.first; i <= run.last; i++) {
      const p = point(params, i, output.values[i]);
      if (!p) {
        if (connect) continue;
        finish();
        previous = null;
        continue;
      }
      if (previous) {
        const nextColor = klineTechnicalColor(output, i - 1);
        if (!drawing || color !== nextColor) {
          finish();
          ctx.beginPath();
          ctx.moveTo(previous.x, previous.y);
          color = nextColor;
          ctx.strokeStyle = color;
        }
        ctx.lineTo(p.x, p.y);
        drawing = true;
      }
      previous = p;
    }
    finish();
  }
}
export function drawKlineTechnical(params: Params): boolean {
  const context = klineTechnicalContext(params.indicator);
  if (!context || context.disposed) return true;
  const custom = context.outputs.some(
    (output) =>
      output.presentation?.precisionPolicy === "fixed-2" ||
      output.presentation?.geometry.kind === "cross" ||
      (output.presentation?.geometry.kind === "line" &&
        output.presentation.geometry.gaps === "break")
  );
  clipped(params, () => {
    levels(params, context.levels);
    for (const level of context.references ?? []) {
      if (!level.visible) continue;
      const y = params.yAxis.convertToPixel(level.value);
      if (!Number.isFinite(y)) continue;
      params.ctx.strokeStyle = lineColor(level.color, level.opacity);
      params.ctx.lineWidth = level.width;
      params.ctx.setLineDash(
        level.lineStyle === "solid" ? [] : level.lineStyle === "dotted" ? [2, 3] : [6, 4]
      );
      params.ctx.beginPath();
      params.ctx.moveTo(0, y);
      params.ctx.lineTo(params.bounding.width, y);
      params.ctx.stroke();
    }
    if (custom) for (const output of context.outputs) plot(params, output);
  });
  return custom;
}
export function drawKlineTechnicalFills(params: Params): boolean {
  const context = klineTechnicalContext(params.indicator);
  if (!context || context.disposed) return true;
  clipped(params, () => {
    const { ctx } = params;
    for (let fillIndex = context.fills.length - 1; fillIndex >= 0; fillIndex--) {
      const fill = context.fills[fillIndex]!;
      if (!fill.visible || fill.opacity === 0) continue;
      const [first, last] = bounds(params, fill.from.length);
      ctx.fillStyle = lineColor(fill.color, fill.opacity);
      if (fill.extent === "pane") {
        const from = params.yAxis.convertToPixel(fill.from[0]!),
          to = params.yAxis.convertToPixel(fill.to[0]!);
        if (fill.from.length && Number.isFinite(from) && Number.isFinite(to))
          ctx.fillRect(0, Math.min(from, to), params.bounding.width, Math.abs(to - from));
        continue;
      }
      for (const run of presentationRuns(fill.from, fill.to, first, last)) {
        let points: { x: number; from: number; to: number }[] = [];
        const finish = () => {
          if (points.length > 1) {
            ctx.beginPath();
            ctx.moveTo(points[0]!.x, points[0]!.from);
            for (const p of points.slice(1)) ctx.lineTo(p.x, p.from);
            for (let i = points.length - 1; i >= 0; i--) ctx.lineTo(points[i]!.x, points[i]!.to);
            ctx.closePath();
            ctx.fill();
          }
          points = [];
        };
        for (let i = run.first; i <= run.last; i++) {
          const from = point(params, i, fill.from[i]),
            to = point(params, i, fill.to[i]);
          if (!from || !to) {
            finish();
            continue;
          }
          points.push({ x: from.x, from: from.y, to: to.y });
        }
        finish();
      }
    }
  });
  return true;
}

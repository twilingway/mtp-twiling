import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
  UTCTimestamp
} from "lightweight-charts";
import { presentationRuns } from "../model/technical-indicators/presentation-geometry.js";
import { lineColor } from "../model/candle-palette.js";
import type { TechnicalRenderFill, TechnicalRenderOutput } from "./technical-render-data.js";

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type Point = { x: number; y: number };
type Pair = Point & { to: number };
const seconds = (time: Time): number =>
  typeof time === "number"
    ? time
    : typeof time === "string"
      ? Date.parse(time) / 1000
      : Date.UTC(time.year, time.month - 1, time.day) / 1000;

/** One stable primitive per plot/fill. Only visible indexed data is visited during paint. */
export class LightweightTechnicalPrimitive implements ISeriesPrimitive<Time> {
  private active = false;
  private disposed = false;
  private request: (() => void) | undefined;
  private output: TechnicalRenderOutput | undefined;
  private fill: TechnicalRenderFill | undefined;
  private project: ((value: number) => number | null) | undefined;
  private readonly renderer: IPrimitivePaneRenderer = {
    draw: (target) => this.paint(target, false),
    drawBackground: (target) => this.paint(target, true)
  };
  private readonly views: readonly IPrimitivePaneView[] = [
    { zOrder: () => "normal", renderer: () => this.renderer }
  ];
  constructor(
    private readonly chart: IChartApi,
    private readonly series: ISeriesApi<SeriesType>,
    private readonly alive: () => boolean
  ) {}
  attached({ requestUpdate }: SeriesAttachedParameter<Time>): void {
    if (this.disposed) return;
    this.active = true;
    this.request = requestUpdate;
  }
  detached(): void {
    this.active = false;
    this.request = undefined;
  }
  paneViews(): readonly IPrimitivePaneView[] {
    return this.disposed ? [] : this.views;
  }
  autoscaleInfo(): null {
    return null;
  }
  updatePlot(output: TechnicalRenderOutput, project?: (value: number) => number | null): void {
    if (this.disposed) return;
    this.output = output;
    this.fill = undefined;
    this.project = project;
    this.request?.();
  }
  updateFill(fill: TechnicalRenderFill, project?: (value: number) => number | null): void {
    if (this.disposed) return;
    this.fill = fill;
    this.output = undefined;
    this.project = project;
    this.request?.();
  }
  dispose(): void {
    this.disposed = true;
    this.detached();
    this.output = undefined;
    this.fill = undefined;
    this.project = undefined;
  }
  private bounds(timestamps: readonly number[]): { first: number; last: number } | undefined {
    const visible = this.chart.timeScale().getVisibleRange();
    if (!visible || !timestamps.length) return;
    const from = seconds(visible.from) * 1000,
      to = seconds(visible.to) * 1000;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    const search = (value: number, after: boolean): number => {
      let left = 0,
        right = timestamps.length;
      while (left < right) {
        const middle = Math.floor((left + right) / 2);
        if (timestamps[middle]! < value || (after && timestamps[middle] === value))
          left = middle + 1;
        else right = middle;
      }
      return left;
    };
    return {
      first: Math.max(0, search(from, false) - 1),
      last: Math.min(timestamps.length - 1, search(to, true))
    };
  }
  private point(timestamp: number, value: number | null | undefined): Point | undefined {
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    const x = this.chart.timeScale().timeToCoordinate(Math.floor(timestamp / 1000) as UTCTimestamp),
      y = this.project ? this.project(value) : this.series.priceToCoordinate(value);
    if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) return;
    return { x, y };
  }
  private paint(target: Target, background: boolean): void {
    if (!this.active || this.disposed || !this.alive()) return;
    const output = this.output,
      fill = this.fill;
    if (background ? !fill?.visible : !output?.style.visible) return;
    const data = background ? fill : output;
    if (!data) return;
    const bounds = this.bounds(data.timestamps);
    if (!bounds) return;
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context,
        hx = scope.horizontalPixelRatio,
        vy = scope.verticalPixelRatio;
      ctx.save();
      try {
        ctx.beginPath();
        ctx.rect(0, 0, scope.bitmapSize.width, scope.bitmapSize.height);
        ctx.clip();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        if (background && fill) {
          ctx.fillStyle = lineColor(fill.color, fill.opacity);
          const polygon = (pairs: Pair[]) => {
            // A singleton has no time area; never invent half-bar fill width.
            if (pairs.length < 2) return;
            ctx.beginPath();
            ctx.moveTo(pairs[0]!.x * hx, pairs[0]!.y * vy);
            for (let i = 1; i < pairs.length; i++) ctx.lineTo(pairs[i]!.x * hx, pairs[i]!.y * vy);
            for (let i = pairs.length - 1; i >= 0; i--)
              ctx.lineTo(pairs[i]!.x * hx, pairs[i]!.to * vy);
            ctx.closePath();
            ctx.fill();
          };
          for (const run of presentationRuns(fill.from, fill.to, bounds.first, bounds.last)) {
            let pairs: Pair[] = [];
            for (let i = run.first; i <= run.last; i++) {
              const a = this.point(fill.timestamps[i]!, fill.from[i]),
                b = this.point(fill.timestamps[i]!, fill.to[i]);
              if (a && b) pairs.push({ ...a, to: b.y });
              else {
                polygon(pairs);
                pairs = [];
              }
            }
            polygon(pairs);
          }
        } else if (output?.presentation) {
          const geometry = output.presentation.geometry;
          ctx.strokeStyle = lineColor(output.style.color, output.style.opacity);
          ctx.lineWidth = output.style.width * hx;
          ctx.lineCap = "butt";
          ctx.lineJoin = "round";
          ctx.setLineDash(
            output.style.lineStyle === "dashed"
              ? [8 * hx, 5 * hx]
              : output.style.lineStyle === "dotted"
                ? [2 * hx, 4 * hx]
                : []
          );
          if (geometry.kind === "cross") {
            ctx.setLineDash([]);
            const radius = 2 + geometry.size.value;
            for (let i = bounds.first; i <= bounds.last; i++) {
              const p = this.point(output.timestamps[i]!, output.values[i]);
              if (!p) continue;
              ctx.beginPath();
              ctx.moveTo((p.x - radius) * hx, p.y * vy);
              ctx.lineTo((p.x + radius) * hx, p.y * vy);
              ctx.moveTo(p.x * hx, (p.y - radius) * vy);
              ctx.lineTo(p.x * hx, (p.y + radius) * vy);
              ctx.stroke();
            }
          } else if (geometry.kind === "line") {
            for (const run of geometry.gaps === "legacy"
              ? [{ first: bounds.first, last: bounds.last }]
              : presentationRuns(output.values, undefined, bounds.first, bounds.last)) {
              let previous: Point | undefined;
              const cap = (p: Point) => {
                ctx.moveTo((p.x - output.style.width / 2) * hx, p.y * vy);
                ctx.lineTo((p.x + output.style.width / 2) * hx, p.y * vy);
              };
              ctx.beginPath();
              for (let i = run.first; i <= run.last; i++) {
                const p = this.point(output.timestamps[i]!, output.values[i]);
                if (!p) {
                  if (geometry.gaps === "legacy") continue;
                  previous = undefined;
                  continue;
                }
                if (!previous) {
                  if (run.first === run.last) cap(p);
                  ctx.moveTo(p.x * hx, p.y * vy);
                } else ctx.lineTo(p.x * hx, p.y * vy);
                previous = p;
              }
              ctx.stroke();
            }
          }
        }
      } finally {
        ctx.restore();
      }
    });
  }
}

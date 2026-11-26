import { LineSeries } from "lightweight-charts";
import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
  AutoscaleInfoProvider
} from "lightweight-charts";
import type { TechnicalRenderReference, TechnicalRenderFill } from "./technical-render-data.js";
import type { lightweightReferenceContext } from "./lightweight-reference-context.js";
import { lineColor } from "../model/candle-palette.js";
type Context = ReturnType<typeof lightweightReferenceContext>;
class ReferencePrimitive implements ISeriesPrimitive<Time> {
  private request: (() => void) | undefined;
  private active = false;
  private views: readonly IPrimitivePaneView[] = [
    {
      zOrder: () => "normal",
      renderer: () => ({
        draw: (target) => this.paint(target, false),
        drawBackground: (target) => this.paint(target, true)
      })
    }
  ];
  constructor(
    private reference: TechnicalRenderReference,
    private fills: readonly TechnicalRenderFill[],
    private project: (value: number) => number | null,
    private alive: () => boolean
  ) {}
  attached(p: SeriesAttachedParameter<Time>) {
    this.active = true;
    this.request = p.requestUpdate;
  }
  detached() {
    this.active = false;
    this.request = undefined;
  }
  paneViews() {
    return this.active ? this.views : [];
  }
  update(reference: TechnicalRenderReference, fills: readonly TechnicalRenderFill[]) {
    this.reference = reference;
    this.fills = fills;
    this.request?.();
  }
  dispose() {
    this.detached();
    this.fills = [];
    this.project = () => null;
  }
  private paint(
    target: Parameters<NonNullable<ReturnType<IPrimitivePaneView["renderer"]>>["draw"]>[0],
    background: boolean
  ) {
    if (!this.active || !this.alive()) return;
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context,
        r = this.reference,
        y = this.project(r.value),
        hy = scope.verticalPixelRatio,
        hx = scope.horizontalPixelRatio;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, scope.bitmapSize.width, scope.bitmapSize.height);
      ctx.clip();
      try {
        if (background) {
          for (const fill of this.fills) {
            if (!fill.visible || fill.opacity === 0 || !fill.from.length) continue;
            const a = this.project(fill.from[0]!),
              b = this.project(fill.to[0]!);
            if (a === null || b === null) continue;
            ctx.fillStyle = lineColor(fill.color, fill.opacity);
            ctx.fillRect(0, Math.min(a, b) * hy, scope.bitmapSize.width, Math.abs(a - b) * hy);
          }
        } else if (r.visible && y !== null) {
          ctx.strokeStyle = lineColor(r.color, r.opacity);
          ctx.lineWidth = r.width * hx;
          ctx.setLineDash(
            r.lineStyle === "solid"
              ? []
              : r.lineStyle === "dotted"
                ? [2 * hx, 3 * hx]
                : [6 * hx, 4 * hx]
          );
          ctx.beginPath();
          ctx.moveTo(0, y * hy);
          ctx.lineTo(scope.bitmapSize.width, y * hy);
          ctx.stroke();
        }
      } finally {
        ctx.restore();
      }
    });
  }
}
export function lightweightReferenceLevels(
  chart: IChartApi,
  context: Context,
  alive: () => boolean
) {
  const owned = new Map<string, { series: ISeriesApi<"Line">; primitive: ReferencePrimitive }>();
  let latest: readonly TechnicalRenderReference[] = [];
  return {
    update(
      references: readonly TechnicalRenderReference[],
      fills: readonly TechnicalRenderFill[],
      paneIndex: (key: string) => number
    ) {
      latest = references;
      const keys = new Set(references.map((r) => r.key));
      for (const [key, entry] of owned)
        if (!keys.has(key)) {
          entry.primitive.dispose();
          entry.series.detachPrimitive(entry.primitive);
          chart.removeSeries(entry.series);
          owned.delete(key);
        }
      const decorated = new Set<string>();
      for (const reference of references) {
        let entry = owned.get(reference.key);
        if (!entry) {
          const series = chart.addSeries(
            LineSeries,
            {
              lineVisible: false,
              lastValueVisible: false,
              priceLineVisible: false,
              crosshairMarkerVisible: false,
              pointMarkersVisible: false,
              priceFormat: { type: "price", precision: 2, minMove: 0.01 }
            },
            paneIndex(reference.paneKey)
          );
          const primitive = new ReferencePrimitive(
            reference,
            [],
            (value) =>
              context.project(
                reference.instanceId,
                reference.paneKey,
                value,
                owned.get(
                  latest.find((r) => r.instanceId === reference.instanceId && r.visible)?.key ?? ""
                )?.series
              ),
            alive
          );
          series.attachPrimitive(primitive);
          entry = { series, primitive };
          owned.set(reference.key, entry);
        }
        const index = paneIndex(reference.paneKey);
        if (entry.series.getPane().paneIndex() !== index) entry.series.moveToPane(index);
        const same = references.filter(
            (r) =>
              r.instanceId === reference.instanceId && r.paneKey === reference.paneKey && r.visible
          ),
          fallback = same[0]?.value ?? null;
        const original: AutoscaleInfoProvider = (source) => (reference.visible ? source() : null);
        const series = entry.series;
        entry.series.applyOptions({
          visible:
            reference.visible ||
            same.length > 0 ||
            fills.some(
              (fill) =>
                fill.extent === "pane" && fill.visible && fill.instanceId === reference.instanceId
            ),
          autoscaleInfoProvider: context.autoscale(
            reference.instanceId,
            reference.paneKey,
            () => reference.value,
            fallback,
            original,
            () => series.priceScale().options().mode
          )
        });
        entry.series.setData(
          reference.timestamps.map((timestamp) => ({
            time: Math.floor(timestamp / 1000) as UTCTimestamp,
            value: reference.value
          }))
        );
        const bands = decorated.has(reference.instanceId)
          ? []
          : fills.filter(
              (fill) => fill.extent === "pane" && fill.instanceId === reference.instanceId
            );
        decorated.add(reference.instanceId);
        entry.primitive.update(reference, bands);
      }
    },
    dispose() {
      for (const entry of owned.values()) {
        entry.primitive.dispose();
        entry.series.detachPrimitive(entry.primitive);
        chart.removeSeries(entry.series);
      }
      owned.clear();
    }
  };
}

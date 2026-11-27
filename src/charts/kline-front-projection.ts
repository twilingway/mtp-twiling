import { IndicatorSeries, registerIndicator } from "klinecharts";
import type { Chart, Indicator } from "klinecharts";

const name = "FRONT_PROJECTION_PERSONAL";
let registered = false;
interface ProjectionContext {
  paint: (() => void) | null;
  live: () => boolean;
  running: boolean;
}

function contextOf(indicator: Pick<Indicator, "extendData">): ProjectionContext | null {
  const value: unknown = indicator.extendData;
  return value && typeof value === "object" && "paint" in value
    ? (value as ProjectionContext)
    : null;
}

/** Y-axis drag repaints native panes without emitting OnZoom/OnScroll. */
export function attachKlineFrontProjection(
  chart: Pick<Chart, "createIndicator" | "removeIndicator">,
  paint: () => void,
  live: () => boolean
): () => void {
  if (!registered) {
    registered = true;
    registerIndicator({
      name,
      shortName: "",
      series: IndicatorSeries.Price,
      zLevel: 10000,
      figures: [],
      calc: () => [],
      draw: ({ indicator }) => {
        const context = contextOf(indicator);
        if (!context?.paint || !context.live() || context.running) return true;
        context.running = true;
        try {
          context.paint();
        } finally {
          context.running = false;
        }
        return true;
      }
    });
  }
  const context: ProjectionContext = { paint, live, running: false };
  chart.createIndicator({ name, extendData: context }, true, { id: "candle_pane" });
  return () => {
    if (!context.paint) return;
    context.paint = null;
    chart.removeIndicator("candle_pane", name);
  };
}

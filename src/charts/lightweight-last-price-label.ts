import type { IPrimitivePaneView, ISeriesPrimitive, Time } from "lightweight-charts";
import type { LastPriceLabelPaint } from "./last-price-label.js";
import { paintLastPriceLabel } from "./last-price-label.js";
import {
  paintDrawingPriceLabels,
  paintDrawingPriceTicks,
  paintDrawingTimeLabels
} from "./drawing-axis-labels.js";
import type { DrawingAxisFrame } from "./drawing-axis-labels.js";

/** Axis geometry is read during the engine's draw, including vertical drag/zoom. */
export function lightweightLastPriceLabel(
  current: () => Omit<LastPriceLabelPaint, "width" | "height"> | null,
  drawings: () => DrawingAxisFrame
): { primitive: ISeriesPrimitive<Time>; update: () => void } {
  let requestUpdate = () => {};
  const primitive: ISeriesPrimitive<Time> = {
    attached: (params) => {
      requestUpdate = params.requestUpdate;
    },
    detached: () => {
      requestUpdate = () => {};
    },
    priceAxisPaneViews: () => views,
    paneViews: () => tickViews,
    timeAxisPaneViews: () => timeViews
  };
  const views: IPrimitivePaneView[] = [
    {
      zOrder: () => "top" as const,
      renderer: () => ({
        draw: (target) => {
          target.useMediaCoordinateSpace(({ context, mediaSize }) => {
            paintDrawingPriceLabels(context, drawings(), mediaSize.width);
            const label = current();
            if (label) paintLastPriceLabel(context, { ...label, ...mediaSize });
          });
        }
      })
    }
  ];
  const tickViews: IPrimitivePaneView[] = [
    {
      zOrder: () => "top",
      renderer: () => ({
        draw: (target) =>
          target.useMediaCoordinateSpace(({ context }) =>
            paintDrawingPriceTicks(context, drawings())
          )
      })
    }
  ];
  const timeViews: IPrimitivePaneView[] = [
    {
      zOrder: () => "top",
      renderer: () => ({
        draw: (target) =>
          target.useMediaCoordinateSpace(({ context, mediaSize }) =>
            paintDrawingTimeLabels(context, drawings(), mediaSize.width, mediaSize.height)
          )
      })
    }
  ];
  return { primitive, update: () => requestUpdate() };
}

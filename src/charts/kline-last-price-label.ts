import { LineType, registerFigure, registerOverlay } from "klinecharts";
import type { Chart, OverlayCreateFiguresCallbackParams } from "klinecharts";
import { paintLastPriceLabel } from "./last-price-label.js";
import type { LastPriceLabelPaint } from "./last-price-label.js";

export interface KlineLastPriceLabel extends Omit<LastPriceLabelPaint, "y" | "width" | "height"> {
  timestamp: number;
  value: number;
  lineColor: string;
  lineVisible: boolean;
}
const overlayName = "PERSONAL_LAST_PRICE_COUNTDOWN";
const figureName = "personalLastPriceCountdown";
let registered = false;

function labelOf(params: OverlayCreateFiguresCallbackParams): KlineLastPriceLabel {
  return params.overlay.extendData as KlineLastPriceLabel;
}
function register(): void {
  if (registered) return;
  registered = true;
  registerFigure<LastPriceLabelPaint, never>({
    name: figureName,
    draw: paintLastPriceLabel,
    checkEventOn: () => false
  });
  registerOverlay({
    name: overlayName,
    totalStep: 1,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: (params) => {
      const label = labelOf(params);
      const y = params.coordinates[0]?.y;
      return label.lineVisible && y !== undefined
        ? [
            {
              type: "line",
              attrs: {
                coordinates: [
                  { x: 0, y },
                  { x: params.bounding.width, y }
                ]
              },
              styles: {
                color: label.lineColor,
                size: 1,
                style: LineType.Dashed,
                dashedValue: [4, 4]
              },
              ignoreEvent: true
            }
          ]
        : [];
    },
    createYAxisFigures: (params) => {
      const y = params.coordinates[0]?.y;
      return y === undefined
        ? []
        : [
            {
              type: figureName,
              attrs: {
                ...labelOf(params),
                y,
                width: params.bounding.width,
                height: params.bounding.height
              },
              ignoreEvent: true
            }
          ];
    }
  });
}

/** Overlay figures use the native Y-axis transform and redraw in its own canvas cycle. */
export function klineLastPriceLabel(
  chart: Pick<Chart, "createOverlay" | "overrideOverlay" | "removeOverlay">
) {
  let id: string | null = null;
  return {
    update(label: KlineLastPriceLabel | null): boolean {
      if (!label) {
        if (id) chart.removeOverlay(id);
        id = null;
        return false;
      }
      register();
      const options = {
        name: overlayName,
        lock: true,
        visible: true,
        zLevel: 10000,
        points: [{ timestamp: label.timestamp, value: label.value }],
        extendData: label
      };
      if (id) chart.overrideOverlay({ ...options, id });
      else {
        const created = chart.createOverlay(options, "candle_pane");
        id = typeof created === "string" ? created : null;
      }
      return id !== null;
    },
    dispose() {
      if (id) chart.removeOverlay(id);
      id = null;
    }
  };
}

import { registerFigure, registerOverlay } from "klinecharts";
import type { Chart, OverlayCreateFiguresCallbackParams } from "klinecharts";
import {
  paintDrawingPriceLabels,
  paintDrawingPriceTicks,
  paintDrawingTimeLabels
} from "./drawing-axis-labels.js";
import type { DrawingAxisFrame } from "./drawing-axis-labels.js";

const overlayName = "PERSONAL_DRAWING_AXIS_LABELS";
let registered = false;
type FigureData = { frame: DrawingAxisFrame; width: number; height: number };
function register(): void {
  if (registered) return;
  registered = true;
  for (const [name, draw] of [
    [
      "personalDrawingPrices",
      (ctx: CanvasRenderingContext2D, data: FigureData) =>
        paintDrawingPriceLabels(ctx, data.frame, data.width)
    ],
    [
      "personalDrawingTicks",
      (ctx: CanvasRenderingContext2D, data: FigureData) => paintDrawingPriceTicks(ctx, data.frame)
    ],
    [
      "personalDrawingTimes",
      (ctx: CanvasRenderingContext2D, data: FigureData) =>
        paintDrawingTimeLabels(ctx, data.frame, data.width, data.height)
    ]
  ] as const)
    registerFigure<FigureData, never>({ name, draw, checkEventOn: () => false });
  const figure = (type: string, params: OverlayCreateFiguresCallbackParams) => [
    {
      type,
      attrs: {
        frame: (params.overlay.extendData as () => DrawingAxisFrame)(),
        width: params.bounding.width,
        height: params.bounding.height
      },
      ignoreEvent: true
    }
  ];
  registerOverlay({
    name: overlayName,
    totalStep: 1,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: (params) => figure("personalDrawingTicks", params),
    createYAxisFigures: (params) => figure("personalDrawingPrices", params),
    createXAxisFigures: (params) => figure("personalDrawingTimes", params)
  });
}

export function klineDrawingAxisLabels(
  chart: Pick<Chart, "createOverlay" | "overrideOverlay" | "removeOverlay">,
  frame: () => DrawingAxisFrame
) {
  let id: string | null = null;
  const dispose = () => {
    if (id) chart.removeOverlay(id);
    id = null;
  };
  return {
    update() {
      const labels = frame().labels;
      if (!labels?.prices.length && !labels?.times.length) {
        dispose();
        return;
      }
      register();
      if (id) chart.overrideOverlay({ id, extendData: () => frame() });
      else {
        const created = chart.createOverlay(
          {
            name: overlayName,
            lock: true,
            zLevel: 9999,
            points: [{ dataIndex: 0, value: 0 }],
            extendData: frame
          },
          "candle_pane"
        );
        id = typeof created === "string" ? created : null;
      }
    },
    dispose
  };
}

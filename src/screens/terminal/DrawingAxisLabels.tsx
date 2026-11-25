import { t } from "../../i18n/messages.js";
import { useEffect, useState } from "react";
import type { DrawingPoint } from "../../model/types.js";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { useTerminal } from "./context.js";
import { drawingVisibleOnInterval } from "../../model/intervals/drawing-visibility.js";
import { chartDateFormat } from "../../i18n/format.js";
import { drawingRenderList } from "./drawing-settings-preview.js";

interface AxisLabel {
  timestamp: number;
  x: number;
  width: number;
}

export function DrawingAxisLabels() {
  const { controller, state } = useTerminal();
  const [labels, setLabels] = useState<AxisLabel[]>([]);
  const selected =
    state.preview ?? drawingRenderList(state).find((item) => item.id === state.selectedObject);
  const points =
    drawingToolbarSettings(state.preferences.chartSettings).drawingsHidden ||
    selected?.visible === false ||
    !drawingVisibleOnInterval(selected?.visibility, state.preferences.timeframe)
      ? undefined
      : selected?.points;
  useEffect(() => {
    if (!points?.length) {
      setLabels([]);
      return;
    }
    let frame = 0;
    let last = 0;
    const update = (now: number) => {
      if (now - last > 32) {
        const chart = controller.chart;
        const width = chart?.plotSize().width ?? 0;
        const next = chart
          ? points.flatMap((point: DrawingPoint) => {
              if (!Number.isFinite(new Date(point.timestamp).getTime())) return [];
              const pixel = chart.pointToPixel(point);
              return pixel && pixel.x >= 0 && pixel.x <= width
                ? [{ timestamp: point.timestamp, x: Math.round(pixel.x), width }]
                : [];
            })
          : [];
        setLabels((previous) =>
          previous.length === next.length &&
          previous.every((label, index) => {
            const value = next[index];
            return (
              value?.timestamp === label.timestamp &&
              value.x === label.x &&
              value.width === label.width
            );
          })
            ? previous
            : next
        );
        last = now;
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [controller, points]);
  const format = chartDateFormat(state.preferences.timeframe, state.preferences);
  return (
    <div className="drawing-axis-labels" aria-label={t("Даты точек рисунка")}>
      {labels.map((label, index) => (
        <time
          className="drawing-axis-label"
          key={index}
          dateTime={new Date(label.timestamp).toISOString()}
          style={{ left: label.x, maxWidth: label.width }}
        >
          {format.format(label.timestamp)}
        </time>
      ))}
    </div>
  );
}

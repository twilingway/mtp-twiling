import { useEffect, useState } from "react";
import type { DrawingPoint, DrawingVisibility, Timeframe } from "../../model/types.js";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { useTerminal } from "./context.js";

interface AxisLabel {
  timestamp: number;
  x: number;
  width: number;
}

function visibleOnTimeframe(
  visibility: DrawingVisibility | undefined,
  timeframe: Timeframe
): boolean {
  const group = timeframe.endsWith("m")
    ? "minutes"
    : timeframe.endsWith("h")
      ? "hours"
      : timeframe.endsWith("d")
        ? "days"
        : "weeks";
  const rule = visibility?.[group];
  const count = Number.parseInt(timeframe);
  return !rule || (rule.enabled && count >= rule.from && count <= rule.to);
}

export function DrawingAxisLabels() {
  const { controller, state } = useTerminal();
  const [labels, setLabels] = useState<AxisLabel[]>([]);
  const selected = state.preview ?? state.drawings.find((item) => item.id === state.selectedObject);
  const points =
    drawingToolbarSettings(state.preferences.chartSettings).drawingsHidden ||
    selected?.visible === false ||
    !visibleOnTimeframe(selected?.visibility, state.preferences.timeframe)
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
  const intraday =
    state.preferences.timeframe.endsWith("m") || state.preferences.timeframe.endsWith("h");
  const format = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "short",
    year: "2-digit",
    ...(intraday ? ({ hour: "2-digit", minute: "2-digit" } as const) : {})
  });
  return (
    <div className="drawing-axis-labels" aria-label="Даты точек рисунка">
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

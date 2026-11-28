import { useEffect, useRef, useSyncExternalStore } from "react";
import { t } from "../../i18n/messages.js";
import { useTerminalController } from "./context.js";
import { chartFitProgress } from "./chart-fit-controller.js";
import { StepChartLoader } from "./StepChartLoader.js";

export function ChartFitProgress({ height }: { height?: number | undefined }) {
  const controller = useTerminalController(),
    progress = chartFitProgress(controller),
    busy = useSyncExternalStore(progress.subscribe, progress.getSnapshot, progress.getSnapshot),
    ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) return progress.attach(ref.current);
  }, [progress]);
  useEffect(() => {
    const chart = ref.current?.parentElement?.querySelector(":scope > .chart-canvas");
    if (!chart) return;
    chart.setAttribute("aria-busy", String(busy));
    return () => chart.removeAttribute("aria-busy");
  }, [busy]);
  return (
    <div
      ref={ref}
      className="chart-fit-progress"
      style={height === undefined ? undefined : { height }}
    >
      {busy && (
        <div className="chart-fit-status" role="status" aria-live="polite">
          <StepChartLoader />
          <span>{t("Подбираем масштаб…")}</span>
        </div>
      )}
    </div>
  );
}

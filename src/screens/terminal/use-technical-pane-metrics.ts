import { useEffect, useState } from "react";
import type { TechnicalPaneMetric } from "../../charts/adapter.js";
import type { TerminalController } from "./controller.js";

/** One measured snapshot drives the price header and lower-pane legends together. */
export function useTechnicalPaneMetrics(controller: Pick<TerminalController, "chart">) {
  const [metrics, setMetrics] = useState<readonly TechnicalPaneMetric[]>([]);
  useEffect(() => {
    let frame = 0,
      last = 0;
    const tick = (now: number) => {
      if (now - last > 60) {
        const next = controller.chart?.technicalPaneMetrics?.() ?? [];
        setMetrics((previous) =>
          previous.length === next.length &&
          previous.every((item, index) => {
            const value = next[index];
            return (
              value &&
              item.key === value.key &&
              item.top === value.top &&
              item.height === value.height &&
              item.width === value.width
            );
          })
            ? previous
            : next
        );
        last = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [controller]);
  return metrics;
}

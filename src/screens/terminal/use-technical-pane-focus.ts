import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { ChartAdapter, TechnicalPaneMetric } from "../../charts/adapter.js";
import type { TerminalController } from "./controller.js";

export function useTechnicalPaneFocus(
  root: RefObject<HTMLDivElement | null>,
  controller: TerminalController,
  key: string | null,
  reserve: number,
  metrics: readonly TechnicalPaneMetric[]
): void {
  const align = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    if (!key) return;
    const body = root.current?.parentElement;
    const host = body?.parentElement;
    if (!body?.classList.contains("chart-body") || !host?.classList.contains("chart-scroll-host"))
      return;

    const savedScroll = host.scrollTop;
    let height = 0;
    let adapter: ChartAdapter | null = null;
    const place = () => {
      const next = controller.chart;
      const nextHeight = host.clientHeight;
      if (adapter !== next || height !== nextHeight) {
        if (adapter !== next) adapter?.setTechnicalPaneFocus?.(null);
        adapter = next;
        height = nextHeight;
        host.style.setProperty("--technical-focus-height", `${height + reserve}px`);
        adapter?.setTechnicalPaneFocus?.({ key, height });
      }
      const pane = adapter?.technicalPaneMetrics?.().find((item) => item.key === key);
      if (pane && pane.height >= height - 1) host.scrollTop = body.offsetTop + pane.top;
    };

    host.dataset.technicalPaneFocus = "true";
    align.current = place;
    place();
    const observer = new ResizeObserver(place);
    observer.observe(host);
    const frame = requestAnimationFrame(place);
    return () => {
      align.current = undefined;
      observer.disconnect();
      cancelAnimationFrame(frame);
      delete host.dataset.technicalPaneFocus;
      host.style.removeProperty("--technical-focus-height");
      adapter?.setTechnicalPaneFocus?.(null);
      host.scrollTop = savedScroll;
    };
  }, [controller, key, reserve, root]);

  useLayoutEffect(() => {
    align.current?.();
  }, [metrics]);
}

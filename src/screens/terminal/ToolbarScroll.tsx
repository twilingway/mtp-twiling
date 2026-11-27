import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { t } from "../../i18n/messages.js";

/** One native horizontal scroll surface for mouse, trackpad, touch and keyboard. */
export function ToolbarScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY))
        return;
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1);
      const next = Math.max(
        0,
        Math.min(strip.scrollWidth - strip.clientWidth, strip.scrollLeft + delta)
      );
      if (next === strip.scrollLeft) return;
      event.preventDefault();
      strip.scrollLeft = next;
    };
    strip.addEventListener("wheel", wheel, { passive: false });
    return () => strip.removeEventListener("wheel", wheel);
  }, []);
  return (
    <div
      ref={ref}
      className="toolbar-scroll"
      role="group"
      aria-label={t("Управление графиками")}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const strip = event.currentTarget;
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? strip.scrollWidth
              : event.key === "ArrowRight"
                ? strip.scrollLeft + 80
                : event.key === "ArrowLeft"
                  ? strip.scrollLeft - 80
                  : null;
        if (next === null) return;
        event.preventDefault();
        strip.scrollLeft = next;
      }}
    >
      {children}
    </div>
  );
}

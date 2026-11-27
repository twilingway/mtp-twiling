import { ToolbarPopover } from "./ToolbarPopover.js";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { t } from "../../i18n/messages.js";
import { chartLayout, defaultChartLayout } from "../../model/chart-workspace-layout.js";
import type { ChartLayoutCount } from "../../model/chart-workspace-layout.js";
import { ChartLayoutOptions, ChartLayoutThumbnail } from "./ChartLayoutPicker.js";
import type { ChartLayoutPickerProps } from "./ChartLayoutPicker.js";
import { ClockZoneControl } from "./ClockZoneControl.js";
import type { TerminalController } from "./controller.js";
import { ChartRangeControl } from "./intervals/ChartRangeControl.js";

export function MobileChartTools({
  controller,
  panelOpen,
  objectsOpen,
  count,
  layout,
  children
}: {
  controller: TerminalController;
  panelOpen: boolean;
  objectsOpen: boolean;
  count: ChartLayoutCount;
  layout?: ChartLayoutPickerProps | undefined;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const title = t("Управление графиками");
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !panel.current?.contains(event.target)
      )
        setOpen(false);
    };
    const desktop = window.matchMedia("(min-width: 801px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      document.removeEventListener("pointerdown", outside);
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, [open]);
  const select = (tab: "chart" | "watchlist" | "objects") => {
    setOpen(false);
    trigger.current?.focus();
    if (tab === "chart") {
      controller.panel.closeMobile();
      return;
    }
    const owner = controller.getSnapshot().owner;
    void controller.panel.select(tab, false, true).catch((error: unknown) => {
      if (controller.getSnapshot().owner !== owner) return;
      controller.notify(error instanceof Error ? error.message : t("Не удалось изменить панель."));
    });
  };
  return (
    <div
      className="mobile-workspace-tools"
      ref={root}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="mobile-workspace-trigger"
        aria-label={`${title} · ${t("Число графиков")} ${count}`}
        title={title}
        aria-controls="mobile-workspace-panel"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ChartLayoutThumbnail layout={chartLayout(layout?.layoutId) ?? defaultChartLayout(count)} />
        <span>{count}</span>
      </button>
      <ToolbarPopover anchor={trigger} open={open} onClose={() => setOpen(false)}>
        <div
          ref={panel}
          id="mobile-workspace-panel"
          className="mobile-workspace-panel"
          role={open ? "region" : undefined}
          aria-label={open ? title : undefined}
          data-open={open}
        >
          {open && (
            <div className="mobile-workspace-options">
              <nav aria-label={t("Разделы правой панели")}>
                <button
                  type="button"
                  aria-controls="chart-workspace"
                  aria-pressed={!panelOpen}
                  onClick={() => select("chart")}
                >
                  {t("График")}
                </button>
                <button
                  type="button"
                  aria-controls="watchlist-view"
                  aria-pressed={panelOpen && !objectsOpen}
                  onClick={() => select("watchlist")}
                >
                  {t("Список котировок")}
                </button>
                <button
                  type="button"
                  aria-controls="objects-view"
                  aria-pressed={panelOpen && objectsOpen}
                  onClick={() => select("objects")}
                >
                  {t("Дерево объектов")}
                </button>
              </nav>
              {layout && (
                <details className="mobile-workspace-layout">
                  <summary>{t("Раскладка графиков")}</summary>
                  <ChartLayoutOptions {...layout} />
                </details>
              )}
              <ChartRangeControl placement="toolbar" />
              <div className="mobile-workspace-zone">
                <span>{t("Часовой пояс")}</span>
                <ClockZoneControl />
              </div>
            </div>
          )}
        </div>
      </ToolbarPopover>
      <div className="mobile-workspace-actions">{children}</div>
    </div>
  );
}

import { t } from "../../i18n/messages.js";
import { useEffect, useRef, useState } from "react";
import { panelWidth } from "../../model/panel-layout.js";
import { useTerminal } from "./context.js";

interface ResizeGesture {
  x: number;
  start: number;
  latest: number;
  owner: string;
  pointer: number;
  element: HTMLDivElement;
}
export function PanelDivider() {
  const { controller, state } = useTerminal();
  const preferred = state.preferences.sidebarWidth;
  const collapsed = !!state.preferences.rightPanelCollapsed;
  const [width, setWidth] = useState(() => panelWidth(preferred, window.innerWidth));
  const gesture = useRef<ResizeGesture | null>(null);
  const frame = useRef<number | null>(null);
  const cancel = () => {
    const active = gesture.current;
    gesture.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    document.documentElement.classList.remove("resizing-panels");
    if (active) {
      setWidth(active.start);
      if (active.element.hasPointerCapture(active.pointer))
        active.element.releasePointerCapture(active.pointer);
    }
  };
  useEffect(() => {
    const active = gesture.current;
    gesture.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (active?.element.hasPointerCapture(active.pointer))
      active.element.releasePointerCapture(active.pointer);
    document.documentElement.classList.remove("resizing-panels");
    setWidth(panelWidth(preferred, window.innerWidth));
  }, [preferred, state.owner, collapsed]);
  useEffect(() => {
    document.documentElement.style.setProperty("--right-panel-width", `${width}px`);
  }, [width]);
  useEffect(() => {
    const resize = () => setWidth(panelWidth(preferred, window.innerWidth));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [preferred]);
  useEffect(() => {
    const blur = () => {
      if (gesture.current) setWidth(gesture.current.start);
      gesture.current = null;
      document.documentElement.classList.remove("resizing-panels");
    };
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("blur", blur);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      document.documentElement.classList.remove("resizing-panels");
      document.documentElement.style.removeProperty("--right-panel-width");
    };
  }, []);
  const save = (next: number) => {
    void controller.setPreferences({ sidebarWidth: next }).catch((error: unknown) => {
      controller.notify(
        error instanceof Error ? error.message : t("Не удалось сохранить ширину панели.")
      );
    });
  };
  return (
    <div
      className="panel-divider"
      hidden={collapsed}
      role="separator"
      tabIndex={collapsed ? -1 : 0}
      aria-label={t("Ширина правой панели")}
      aria-orientation="vertical"
      aria-valuemin={240}
      aria-valuemax={panelWidth(720, window.innerWidth)}
      aria-valuenow={width}
      title={t("Перетащите, чтобы изменить ширину панели")}
      onPointerDown={(event) => {
        if (collapsed || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        gesture.current = {
          x: event.clientX,
          start: width,
          latest: width,
          owner: state.owner,
          pointer: event.pointerId,
          element: event.currentTarget
        };
        document.documentElement.classList.add("resizing-panels");
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const active = gesture.current;
        if (!active || active.pointer !== event.pointerId) return;
        const current = controller.getSnapshot();
        if (active.owner !== current.owner || current.preferences.rightPanelCollapsed) {
          cancel();
          return;
        }
        active.latest = panelWidth(active.start + active.x - event.clientX, window.innerWidth);
        if (frame.current === null)
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            if (gesture.current) setWidth(gesture.current.latest);
          });
      }}
      onPointerUp={(event) => {
        const active = gesture.current;
        if (!active || active.pointer !== event.pointerId) return;
        gesture.current = null;
        document.documentElement.classList.remove("resizing-panels");
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        setWidth(active.latest);
        if (active.owner === controller.getSnapshot().owner) save(active.latest);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={() => {
        if (gesture.current) cancel();
      }}
      onKeyDown={(event) => {
        if (collapsed) return;
        if (event.key === "Escape" && gesture.current) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          if (gesture.current) return;
          const next = panelWidth(
            width + (event.key === "ArrowLeft" ? 10 : -10),
            window.innerWidth
          );
          setWidth(next);
          save(next);
        }
      }}
    />
  );
}

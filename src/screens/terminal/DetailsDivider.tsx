import { selectControlsState } from "./terminal-state-selection.js";
import { shallowEqual } from "./snapshot-selector.js";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import { detailsGeometry, detailsRatio } from "../../model/details-resize.js";
import { t } from "../../i18n/messages.js";
import { useTerminal } from "./context.js";

interface Gesture {
  pointer: number;
  element: HTMLDivElement;
  y: number;
  height: number;
  latest: number;
  valid: () => boolean;
}
const block = (event: SyntheticEvent) => event.stopPropagation();
const suppress = (event: SyntheticEvent) => {
  event.preventDefault();
  event.stopPropagation();
};
const outerHeight = (element: Element | null) => {
  if (!(element instanceof HTMLElement)) return 0;
  const style = getComputedStyle(element);
  return (
    element.offsetHeight +
    (parseFloat(style.marginTop) || 0) +
    (parseFloat(style.marginBottom) || 0)
  );
};

export function DetailsDivider() {
  const { controller, state } = useTerminal(selectControlsState, shallowEqual);
  const divider = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const preferred = state.preferences.rightDetailsHeightRatio;
  const saved = useRef(preferred);
  const ratio = useRef(detailsRatio(preferred));
  const geometry = useRef(detailsGeometry(0, 0, preferred));
  const [values, setValues] = useState({ min: 15, max: 85, now: 45 });

  const measure = useCallback(() => {
    const panel = divider.current?.parentElement;
    if (!panel) return;
    const chrome = [".watchlist-heading", ".watchlist-search", ".watchlist-meta"].reduce(
      (height, selector) => height + outerHeight(panel.querySelector(selector)),
      0
    );
    const next = detailsGeometry(
      panel.clientHeight - outerHeight(panel.querySelector(".private-note")) - 8,
      chrome,
      ratio.current
    );
    geometry.current = next;
    panel.style.setProperty("--watchlist-details-height", `${next.height}px`);
    if (next.total > 0)
      setValues({
        min: Math.round((next.minimum / next.total) * 100),
        max: Math.round((next.maximum / next.total) * 100),
        now: Math.round((next.height / next.total) * 100)
      });
  }, []);

  const cancel = useCallback(() => {
    generation.current++;
    const active = gesture.current;
    gesture.current = null;
    document.documentElement.classList.remove("resizing-details");
    if (active?.element.hasPointerCapture(active.pointer))
      active.element.releasePointerCapture(active.pointer);
    ratio.current = detailsRatio(saved.current);
    if (mounted.current) measure();
  }, [measure]);

  useLayoutEffect(() => {
    mounted.current = true;
    const element = divider.current;
    const panel = element?.parentElement;
    const observer = new ResizeObserver(() => {
      if (gesture.current) cancel();
      else measure();
    });
    if (panel) {
      observer.observe(panel);
      for (const selector of [
        ".watchlist-heading",
        ".watchlist-search",
        ".watchlist-meta",
        ".private-note"
      ]) {
        const child = panel.querySelector(selector);
        if (child) observer.observe(child);
      }
    }
    window.addEventListener("blur", cancel);
    measure();
    return () => {
      mounted.current = false;
      cancel();
      observer.disconnect();
      window.removeEventListener("blur", cancel);
      panel?.style.removeProperty("--watchlist-details-height");
    };
  }, [cancel, measure]);

  useLayoutEffect(() => {
    saved.current = preferred;
    cancel();
  }, [
    preferred,
    state.owner,
    state.chartRevision,
    state.importingBackup,
    state.importRecoveryRequired,
    state.preferences.rightPanelCollapsed,
    state.mobilePanelOpen,
    state.objectPanel,
    cancel
  ]);

  const guard = () => {
    const initial = controller.getSnapshot();
    const epoch = generation.current;
    return () => {
      const current = controller.getSnapshot();
      return (
        mounted.current &&
        epoch === generation.current &&
        current.owner === initial.owner &&
        current.chartRevision === initial.chartRevision &&
        current.preferences.rightDetailsHeightRatio ===
          initial.preferences.rightDetailsHeightRatio &&
        !current.importingBackup &&
        !current.importRecoveryRequired &&
        !current.preferences.rightPanelCollapsed &&
        !current.objectPanel &&
        current.mobilePanelOpen === initial.mobilePanelOpen
      );
    };
  };
  const save = (next: number, valid: () => boolean) => {
    void controller
      .setPreferences({ rightDetailsHeightRatio: next }, false, valid)
      .catch((error: unknown) => {
        if (!valid()) return;
        cancel();
        controller.notify(
          error instanceof Error ? error.message : t("Не удалось сохранить высоту карточки.")
        );
      });
  };
  return (
    <div
      ref={divider}
      className="details-divider"
      role="separator"
      tabIndex={0}
      aria-label={t("Высота карточки инструмента")}
      aria-orientation="horizontal"
      aria-valuemin={values.min}
      aria-valuemax={values.max}
      aria-valuenow={values.now}
      aria-valuetext={`${values.now}%`}
      title={t("Перетащите, чтобы изменить высоту карточки")}
      onPointerDown={(event) => {
        suppress(event);
        if (event.button !== 0 || gesture.current) return;
        const valid = guard();
        if (!valid() || geometry.current.total <= 0) return;
        generation.current++;
        event.currentTarget.focus();
        gesture.current = {
          pointer: event.pointerId,
          element: event.currentTarget,
          y: event.clientY,
          height: geometry.current.height,
          latest: ratio.current,
          valid: guard()
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        document.documentElement.classList.add("resizing-details");
      }}
      onPointerMove={(event) => {
        suppress(event);
        const active = gesture.current;
        if (!active || active.pointer !== event.pointerId) return;
        if (!active.valid()) {
          cancel();
          return;
        }
        const bounds = geometry.current;
        const height = Math.max(
          bounds.minimum,
          Math.min(bounds.maximum, active.height + active.y - event.clientY)
        );
        active.latest = detailsRatio(height / bounds.total);
        ratio.current = active.latest;
        measure();
      }}
      onPointerUp={(event) => {
        suppress(event);
        const active = gesture.current;
        if (!active || active.pointer !== event.pointerId) return;
        if (!active.valid()) {
          cancel();
          return;
        }
        gesture.current = null;
        document.documentElement.classList.remove("resizing-details");
        if (event.currentTarget.hasPointerCapture(active.pointer))
          event.currentTarget.releasePointerCapture(active.pointer);
        save(active.latest, active.valid);
      }}
      onPointerCancel={(event) => {
        suppress(event);
        cancel();
      }}
      onLostPointerCapture={(event) => {
        block(event);
        if (gesture.current) cancel();
      }}
      onMouseDown={suppress}
      onTouchStart={block}
      onClick={suppress}
      onDoubleClick={suppress}
      onContextMenu={suppress}
      onWheel={block}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          suppress(event);
          cancel();
          return;
        }
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        suppress(event);
        if (gesture.current || geometry.current.total <= 0) return;
        const valid = guard();
        if (!valid()) return;
        generation.current++;
        const bounds = geometry.current;
        const height =
          event.key === "Home"
            ? bounds.minimum
            : event.key === "End"
              ? bounds.maximum
              : Math.max(
                  bounds.minimum,
                  Math.min(bounds.maximum, bounds.height + (event.key === "ArrowUp" ? 10 : -10))
                );
        ratio.current = detailsRatio(height / bounds.total);
        measure();
        save(ratio.current, guard());
      }}
    />
  );
}

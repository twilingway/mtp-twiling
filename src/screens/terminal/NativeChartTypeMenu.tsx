import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { NATIVE_CHART_TYPES, resolveNativeChartType } from "../../model/native-chart-type.js";
import type { NativeChartType } from "../../model/native-chart-type.js";
import { t } from "../../i18n/messages.js";
import { useTerminal } from "./context.js";

const labels: Record<NativeChartType, string> = {
  candles: "Японские свечи",
  bars: "Бары",
  line: "Линия",
  area: "Область"
};
const paths: Record<NativeChartType, string> = {
  candles: "M5 2v3m0 9v3m-2-12h4v9H3zM13 3v5m0 5v4m-2-9h4v5h-4z",
  bars: "M5 2v15M2 5h3m0 8h3M13 3v13m-3-6h3m0-3h3",
  line: "m2 14 4-6 3 2 4-6 3 2",
  area: "m2 14 4-6 3 2 4-6 3 2v9H2Z"
};

function TypeIcon({ type }: { type: NativeChartType }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill={type === "area" ? "color-mix(in srgb, currentColor 20%, transparent)" : "none"}
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[type]} />
    </svg>
  );
}

export function NativeChartTypeMenu() {
  const { controller, state } = useTerminal();
  const type = resolveNativeChartType(state.preferences.chartSettings);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const [placement, setPlacement] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const disabled = !!(
    state.importingBackup ||
    state.importRecoveryRequired ||
    state.profileTransition ||
    state.annotationReady === false
  );
  const open = placement !== null && !disabled;
  useEffect(() => setPlacement(null), [controller, state.owner, state.chartRevision, disabled]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !menu.current?.contains(event.target)
      )
        setPlacement(null);
    };
    const dismiss = () => setPlacement(null);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [open]);

  function close(focus = false) {
    setPlacement(null);
    if (focus) trigger.current?.focus();
  }
  function show() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(220, window.innerWidth - 16);
    const below = window.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    const down = below >= 170 || below >= above;
    const maxHeight = Math.max(0, down ? below : above);
    setPlacement({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: down ? rect.bottom + 6 : Math.max(8, rect.top - Math.min(maxHeight, 166) - 6),
      width,
      maxHeight
    });
  }
  function select(next: NativeChartType) {
    close(true);
    const { owner, chartRevision } = state;
    void controller.setChartType(next).catch((error: unknown) => {
      const current = controller.getSnapshot();
      if (current.owner === owner && current.chartRevision === chartRevision)
        controller.notify(
          error instanceof Error ? t(error.message) : t("Не удалось изменить тип графика.")
        );
    });
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      close(true);
      return;
    }
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const current = buttons.findIndex((button) => button === document.activeElement);
    const next =
      event.key === "ArrowDown"
        ? (current + 1) % buttons.length
        : event.key === "ArrowUp"
          ? (current + buttons.length - 1) % buttons.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : -1;
    if (next >= 0) {
      event.preventDefault();
      buttons[next]?.focus();
    }
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="native-chart-type-trigger"
        title={t(labels[type])}
        aria-label={`${t("Тип графика")} · ${t(labels[type])}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            show();
          }
        }}
      >
        <TypeIcon type={type} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            className="native-chart-type-menu"
            role="menu"
            aria-label={t("Тип графика")}
            style={placement}
            onKeyDown={navigate}
          >
            {NATIVE_CHART_TYPES.map((item) => (
              <button
                key={item}
                type="button"
                role="menuitemradio"
                aria-checked={item === type}
                tabIndex={-1}
                onClick={() => select(item)}
              >
                <TypeIcon type={item} />
                {t(labels[item])}
                {item === type && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>,
          document.fullscreenElement ?? document.body
        )}
    </>
  );
}

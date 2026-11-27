import { ToolbarPopover } from "./ToolbarPopover.js";
import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n/messages.js";
import { useTerminalControls } from "./context.js";
import { INDICATOR_NAMES } from "./state.js";
import { MtpIndicatorGroup } from "./MtpIndicatorGroup.js";
import { changeMenuIndicator, persistMtpMenuCollapsed } from "./indicator-menu-actions.js";
import { useIndicatorMenuAction } from "./useIndicatorMenuAction.js";

export function TerminalIndicatorControls() {
  const { controller, state } = useTerminalControls(),
    p = state.preferences;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null);
  const { pending, run } = useIndicatorMenuAction(controller);
  const blocked = !!(pending || state.importingBackup || state.importRecoveryRequired);
  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  useEffect(() => {
    if (open)
      panel.current
        ?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")
        ?.focus();
  }, [open]);
  useEffect(() => {
    const moved = () => setOpen(false);
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener("resize", moved);
    document.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("resize", moved);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return (
    <div
      className="indicator-control"
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }
      }}
    >
      <button
        type="button"
        id="indicators-button"
        className="text-button indicator-library-trigger"
        aria-label={t("Индикаторы")}
        aria-haspopup="dialog"
        onClick={() => {
          close();
          controller.setDialog("indicator-library");
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M3 21v-5h4v5m3 0v-8h4v8m3 0V10h4v11M3 11l5-5 5 2 8-5" />
        </svg>
        <span>{t("Индикаторы")}</span>
      </button>
      <button
        type="button"
        ref={trigger}
        id="indicator-quick-button"
        className="indicator-quick-trigger"
        aria-label={t("Быстрый выбор индикаторов")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? "indicators-panel" : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path d="m3 5 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <>
          <ToolbarPopover anchor={trigger} open={open} onClose={() => close()}>
            <button
              type="button"
              className="indicator-menu-dismiss"
              tabIndex={-1}
              aria-label={t("Закрыть быстрое меню")}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                close(true);
              }}
            />
            <div
              ref={panel}
              className="popover indicator-quick-panel"
              id="indicators-panel"
              role="dialog"
              aria-label={t("Быстрый выбор индикаторов")}
              aria-busy={pending}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <strong>{t("Индикаторы")}</strong>
              <MtpIndicatorGroup
                flags={p.indicators}
                collapsed={p.chartSettings.mtpMenuCollapsed === true}
                disabled={blocked}
                onCollapse={() => run(() => persistMtpMenuCollapsed(controller))}
                onToggle={(key) => {
                  void run(() => changeMenuIndicator(controller, key));
                }}
              />
              {(["volume", "ma", "ema"] as const).map((key) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    id={`indicator-${key}`}
                    checked={!!p.indicators[key]}
                    disabled={blocked}
                    onChange={() => {
                      void run(() => changeMenuIndicator(controller, key));
                    }}
                  />
                  {t(INDICATOR_NAMES[key])}
                </label>
              ))}
              <button
                type="button"
                disabled={blocked}
                onClick={() => {
                  close();
                  controller.editIndicator("volume");
                }}
              >
                {t("Настройки объёма")}
              </button>
            </div>
          </ToolbarPopover>
        </>
      )}
    </div>
  );
}

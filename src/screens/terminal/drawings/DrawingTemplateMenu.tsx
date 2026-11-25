import { t } from "../../../i18n/messages.js";
import { useEffect, useRef, useState } from "react";
import type { Drawing, DrawingTemplate } from "../../../model/types.js";
import { useTerminal } from "../context.js";
import { ChevronIcon } from "./controls/ChevronIcon.js";
export function DrawingTemplateMenu({
  getDrawing,
  onApply,
  onReset
}: {
  getDrawing: () => Drawing | null;
  onApply: (template: DrawingTemplate) => void;
  onReset: () => void;
}) {
  const { controller, state } = useTerminal();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  const templates = state.preferences.chartSettings.drawingTemplates ?? {};
  const save = async (asDefault = false) => {
    const item = getDrawing();
    if (!item?.settings) return;
    const key = asDefault ? "default:" + item.name : name.trim().slice(0, 80);
    if (!key || ["__proto__", "prototype", "constructor"].includes(key)) {
      controller.notify(t("Укажите другое название шаблона."));
      return;
    }
    const template: DrawingTemplate = {
      settings: structuredClone(item.settings),
      ...(item.visibility ? { visibility: structuredClone(item.visibility) } : {})
    };
    try {
      await controller.setChartSettings({ drawingTemplates: { ...templates, [key]: template } });
      setOpen(false);
    } catch (error) {
      controller.notify(error instanceof Error ? error.message : t("Не удалось сохранить шаблон."));
    }
  };
  return (
    <div ref={ref} className="template-control">
      <button
        ref={trigger}
        type="button"
        id="drawing-template-button"
        aria-expanded={open}
        aria-controls="drawing-template-menu"
        onClick={() => setOpen(!open)}
      >
        <span>{t("Шаблон")}</span>
        <ChevronIcon />
      </button>
      <div id="drawing-template-menu" className="template-menu" hidden={!open}>
        <input
          aria-label={t("Название шаблона")}
          placeholder={t("Название шаблона")}
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <button type="button" onClick={() => void save()}>
          {t("Сохранить как…")}
        </button>
        <button type="button" onClick={() => void save(true)}>
          {t("Применить по умолчанию")}
        </button>
        <button
          type="button"
          onClick={() => {
            onReset();
            setOpen(false);
          }}
        >
          {t("Сбросить стиль")}
        </button>
        {Object.entries(templates)
          .filter(([key]) => !key.startsWith("default:"))
          .map(([key, template]) => (
            <button
              type="button"
              key={key}
              onClick={() => {
                onApply(template);
                setOpen(false);
              }}
            >
              {key}
            </button>
          ))}
      </div>
    </div>
  );
}

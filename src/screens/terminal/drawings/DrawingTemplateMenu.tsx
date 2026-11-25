import { useState } from "react";
import type { Drawing, DrawingTemplate } from "../../../model/types.js";
import { useTerminal } from "../context.js";
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
  const templates = state.preferences.chartSettings.drawingTemplates ?? {};
  const save = async (asDefault = false) => {
    const item = getDrawing();
    if (!item?.settings) return;
    const key = asDefault ? "default:" + item.name : name.trim().slice(0, 80);
    if (!key || ["__proto__", "prototype", "constructor"].includes(key)) {
      controller.notify("Укажите другое название шаблона.");
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
      controller.notify(error instanceof Error ? error.message : "Не удалось сохранить шаблон.");
    }
  };
  return (
    <div className="template-control">
      <button type="button" id="drawing-template-button" onClick={() => setOpen(!open)}>
        Шаблон ⌄
      </button>
      <div className="template-menu" hidden={!open}>
        <input
          aria-label="Название шаблона"
          placeholder="Название шаблона"
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <button type="button" onClick={() => void save()}>
          Сохранить как…
        </button>
        <button type="button" onClick={() => void save(true)}>
          Применить по умолчанию
        </button>
        <button
          type="button"
          onClick={() => {
            onReset();
            setOpen(false);
          }}
        >
          Сбросить стиль
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

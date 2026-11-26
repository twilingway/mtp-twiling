import { useId, useState } from "react";
import { t } from "../../i18n/messages.js";
import { drawingStyle } from "../../model/drawing-model.js";
import { drawingPriceLabelStyle, lastPriceStyle } from "../../model/last-price-style.js";
import { terminalTheme, withTheme } from "../../model/theme.js";
import type { TerminalTheme } from "../../model/theme.js";
import type {
  ChartSettings,
  PriceAxisLabelColors,
  PriceAxisLabelPalette
} from "../../model/types.js";

interface Props {
  settings: ChartSettings;
  onChange: (
    theme: TerminalTheme,
    label: keyof PriceAxisLabelPalette,
    field: keyof PriceAxisLabelColors,
    color: string | undefined
  ) => void;
}

export function PriceAxisLabelFields({ settings, onChange }: Props) {
  const groupId = useId();
  const [theme, setTheme] = useState(() => terminalTheme(settings));
  const themeSettings = withTheme(settings, theme);
  const palette = settings.priceAxisLabels?.[theme];
  const previews = {
    lastPrice: lastPriceStyle(themeSettings, true),
    drawings: drawingPriceLabelStyle(themeSettings, drawingStyle({}).color)
  };
  return (
    <fieldset className="price-axis-label-fields">
      <legend>{t("Метки на ценовой шкале")}</legend>
      <label htmlFor={`${groupId}-theme`}>
        {t("Палитра меток")}
        <select
          id={`${groupId}-theme`}
          value={theme}
          onChange={(event) => setTheme(event.target.value === "light" ? "light" : "dark")}
        >
          <option value="dark">{t("Тёмная")}</option>
          <option value="light">{t("Светлая")}</option>
        </select>
      </label>
      {(
        [
          ["lastPrice", "Последняя цена и таймер"],
          ["drawings", "Уровни рисунков"]
        ] as const
      ).map(([kind, title]) => (
        <fieldset className="price-axis-label-group" key={kind}>
          <legend>{t(title)}</legend>
          {(
            [
              ["fill", "Фон метки"],
              ["text", "Текст метки"]
            ] as const
          ).map(([field, caption]) => {
            const id = `${groupId}-${kind}-${field}`;
            const configured = palette?.[kind]?.[field];
            const value = previews[kind][field];
            const name = `${t(title)} · ${t(caption)}`;
            return (
              <div className="price-axis-label-field" key={field}>
                <label htmlFor={id}>{t(caption)}</label>
                <input
                  id={id}
                  name={`${theme}-${kind}-${field}`}
                  type="color"
                  aria-label={name}
                  value={value}
                  onChange={(event) => onChange(theme, kind, field, event.target.value)}
                />
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={configured === undefined}
                    aria-label={`${name} · ${t("Автоцвет")}`}
                    onChange={(event) =>
                      onChange(theme, kind, field, event.target.checked ? undefined : value)
                    }
                  />
                  {t("Автоцвет")}
                </label>
              </div>
            );
          })}
        </fieldset>
      ))}
    </fieldset>
  );
}

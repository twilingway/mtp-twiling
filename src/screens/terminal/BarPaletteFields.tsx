import { useId, useState } from "react";
import { t } from "../../i18n/messages.js";
import { barColors } from "../../model/bar-palette.js";
import { THEME_PALETTES, terminalTheme } from "../../model/theme.js";
import type { TerminalTheme } from "../../model/theme.js";
import type { BarColors, ChartSettings } from "../../model/types.js";

interface Props {
  settings: ChartSettings;
  onChange: (theme: TerminalTheme, field: keyof BarColors, color: string | undefined) => void;
}

export function BarPaletteFields({ settings, onChange }: Props) {
  const groupId = useId();
  const [theme, setTheme] = useState(() => terminalTheme(settings));
  // The inactive theme's preview uses its standard background, not the active custom one.
  const previewSettings =
    theme === terminalTheme(settings)
      ? settings
      : { ...settings, theme, background: THEME_PALETTES[theme].background };
  const colors = barColors(previewSettings);
  return (
    <fieldset className="price-axis-label-fields">
      <legend>{t("Цвета баров (OHLC)")}</legend>
      <label htmlFor={`${groupId}-theme`}>
        {t("Палитра баров")}
        <select
          id={`${groupId}-theme`}
          name="bar-colors-theme"
          value={theme}
          onChange={(event) => setTheme(event.target.value === "light" ? "light" : "dark")}
        >
          <option value="dark">{t("Тёмная")}</option>
          <option value="light">{t("Светлая")}</option>
        </select>
      </label>
      {(
        [
          ["upColor", "Рост"],
          ["downColor", "Падение"]
        ] as const
      ).map(([field, caption]) => {
        const id = `${groupId}-${field}`;
        const name = `${t("Бары")} · ${t(caption)}`;
        const value = colors[field];
        return (
          <div className="price-axis-label-field" key={field}>
            <label htmlFor={id}>{t(caption)}</label>
            <input
              id={id}
              name={`${theme}-bar-${field}`}
              type="color"
              aria-label={name}
              value={value}
              onChange={(event) => onChange(theme, field, event.target.value)}
            />
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.barColors?.[theme]?.[field] === undefined}
                aria-label={`${name} · ${t("Автоцвет")}`}
                onChange={(event) =>
                  onChange(theme, field, event.target.checked ? undefined : value)
                }
              />
              {t("Автоцвет")}
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}

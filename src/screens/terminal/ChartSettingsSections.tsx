import { useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { t } from "../../i18n/messages.js";

const sections = [
  ["instrument", "Инструмент"],
  ["status", "Строка статуса"],
  ["scales", "Шкалы и линии"],
  ["appearance", "Оформление"]
] as const;

type SectionId = (typeof sections)[number][0];

export function ChartSettingsSections({ content }: { content: Record<SectionId, ReactNode> }) {
  const [selected, setSelected] = useState<SectionId>("instrument");
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = sections.length - 1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowLeft" || event.key === "ArrowUp"
            ? (index + last) % sections.length
            : event.key === "ArrowRight" || event.key === "ArrowDown"
              ? (index + 1) % sections.length
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setSelected(sections[next]![0]);
    buttons.current[next]?.focus();
  };

  return (
    <div className="chart-settings-sections">
      <div
        className="chart-settings-tabs"
        role="tablist"
        aria-label={t("Разделы настроек графика")}
        aria-orientation="vertical"
      >
        {sections.map(([section, label], index) => (
          <button
            key={section}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            id={`${id}-tab-${section}`}
            role="tab"
            aria-controls={`${id}-panel-${section}`}
            aria-selected={selected === section}
            tabIndex={selected === section ? 0 : -1}
            onClick={() => setSelected(section)}
            onKeyDown={(event) => navigate(event, index)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {sections.map(([section]) => (
        <section
          key={section}
          id={`${id}-panel-${section}`}
          className="chart-settings-section"
          role="tabpanel"
          aria-labelledby={`${id}-tab-${section}`}
          hidden={selected !== section}
        >
          {content[section]}
        </section>
      ))}
    </div>
  );
}

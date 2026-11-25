import { useId } from "react";
import type { CSSProperties } from "react";
import { t } from "../../../../i18n/messages.js";

export function OpacityControl({
  name,
  value,
  color,
  label = "Непрозрачность",
  onChange
}: {
  name: string;
  value: number;
  color: string;
  label?: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const percent = Math.round(value * 100);
  const style: CSSProperties & { "--opacity-color": string } = { "--opacity-color": color };
  return (
    <label className="drawing-opacity" htmlFor={id} style={style}>
      <span>{t(label)}</span>
      <span className="drawing-opacity-track">
        <input
          id={id}
          type="range"
          name={name}
          min={0}
          max={100}
          step={1}
          aria-label={t(label)}
          aria-valuetext={`${percent}%`}
          value={percent}
          onChange={(event) => onChange(Number(event.currentTarget.value) / 100)}
        />
      </span>
      <output htmlFor={id}>{percent}%</output>
    </label>
  );
}

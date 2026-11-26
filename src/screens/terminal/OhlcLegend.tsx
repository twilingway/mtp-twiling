import { t } from "../../i18n/messages.js";
import { useId, useState } from "react";
import type { CSSProperties } from "react";
import type { Candle, ChartSettings } from "../../model/types.js";
import { createOhlcLegend, formatOhlcValue } from "../../model/ohlc-legend.js";
import { chartBackground } from "../../model/theme.js";

export interface OhlcLegendProps {
  bar?: Candle | undefined;
  previousClose?: number | undefined;
  digits: number;
  settings?: ChartSettings | undefined;
  surface?: boolean;
}
const FIELDS = [
  { key: "open", label: "ОТКР", title: "Открытие" },
  { key: "high", label: "МАКС", title: "Максимум" },
  { key: "low", label: "МИН", title: "Минимум" },
  { key: "close", label: "ЗАКР", title: "Закрытие" }
] as const;

export function OhlcLegend({ bar, previousClose, digits, settings, surface }: OhlcLegendProps) {
  const legend = createOhlcLegend(bar, previousClose, settings);
  const style: CSSProperties & { "--ohlc-value-color": string; "--ohlc-label-color": string } = {
    "--ohlc-value-color": legend.color,
    "--ohlc-label-color": legend.labelColor,
    ...(surface && { backgroundColor: chartBackground(settings ?? {}) })
  };
  const change = formatOhlcValue(legend.change, digits, true);
  const percent = legend.percent === null ? "" : ` (${formatOhlcValue(legend.percent, 2, true)}%)`;
  return (
    <div
      className="ohlc ohlc-legend"
      role="group"
      aria-label={t("Выбранная свеча")}
      data-direction={legend.direction}
      style={style}
    >
      {FIELDS.map(({ key, label, title }) => (
        <span key={key} className="ohlc-field" title={t(title)}>
          <span className="ohlc-label">{t(label)}</span>
          <span className="ohlc-value" data-missing={legend.values[key] === null || undefined}>
            {formatOhlcValue(legend.values[key], digits)}
          </span>
        </span>
      ))}
      {legend.change !== null && (
        <span className="ohlc-change" aria-label={t("Изменение: ") + change + percent}>
          {change}
          {percent}
        </span>
      )}
    </div>
  );
}

export function OhlcLegendIcon(props: OhlcLegendProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const label = t("Значения свечи");
  return (
    <div
      className="ohlc-icon-control"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="ohlc-icon-button"
        aria-label={label}
        aria-controls={id}
        aria-expanded={open}
        title={label}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">ⓘ</span>
      </button>
      <div id={id} className="ohlc-icon-content" hidden={!open}>
        {open && <OhlcLegend {...props} surface />}
      </div>
    </div>
  );
}

import { t } from "../../i18n/messages.js";
import type { ChartEngine } from "../../model/types.js";

export function ChartEngineSelect({
  id,
  value,
  onChange
}: {
  id: string;
  value: ChartEngine;
  onChange: (value: ChartEngine) => void;
}) {
  return (
    <select
      id={id}
      name="engine"
      aria-label={t("Библиотека графика")}
      value={value}
      onChange={(event) => onChange(event.target.value === "kline" ? "kline" : "tradingview")}
    >
      <option value="tradingview">TradingView Lightweight</option>
      <option value="kline">KLineChart</option>
    </select>
  );
}

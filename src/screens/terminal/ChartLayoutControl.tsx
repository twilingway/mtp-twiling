import { t } from "../../i18n/messages.js";

export type ChartLayoutCount = 1 | 2 | 3;

export function ChartLayoutControl({
  value,
  onChange
}: {
  value: ChartLayoutCount;
  onChange: (count: ChartLayoutCount) => void;
}) {
  const label = t("Раскладка графиков");
  return (
    <label className="chart-layout-control" title={label}>
      <span className="chart-layout-icon" aria-hidden="true" />
      <select
        value={value}
        aria-label={label}
        aria-controls="chart-workspace"
        onChange={(event) => {
          const count = Number(event.currentTarget.value);
          if (count === 1 || count === 2 || count === 3) onChange(count);
        }}
      >
        <option value={1} aria-label={t("Один график")}>
          1
        </option>
        <option value={2} aria-label={t("Два графика")}>
          2
        </option>
        <option value={3} aria-label={t("Три графика")}>
          3
        </option>
      </select>
    </label>
  );
}

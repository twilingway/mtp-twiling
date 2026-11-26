import { t } from "../../i18n/messages.js";
import {
  CHART_LAYOUT_COUNTS,
  chartLayoutRowWidths,
  isChartLayoutCount
} from "../../model/chart-workspace-layout.js";
import type { ChartLayoutCount } from "../../model/chart-workspace-layout.js";

export type { ChartLayoutCount } from "../../model/chart-workspace-layout.js";

function chartCountLabel(count: ChartLayoutCount) {
  switch (count) {
    case 1:
      return t("Один график");
    case 2:
      return t("Два графика");
    case 3:
      return t("Три графика");
    default:
      return `${t("Число графиков")}: ${count}`;
  }
}

export function ChartLayoutPreview({ count }: { count: ChartLayoutCount }) {
  return (
    <span className="chart-layout-icon" data-layout-preview={count} aria-hidden="true">
      {chartLayoutRowWidths(count).map((width, row) => (
        <span className="chart-layout-icon-row" key={row}>
          {Array.from({ length: width }, (_, column) => (
            <span className="chart-layout-icon-cell" key={column} />
          ))}
        </span>
      ))}
    </span>
  );
}

export function ChartLayoutControl({
  value,
  onChange,
  showLabel = false
}: {
  value: ChartLayoutCount;
  onChange: (count: ChartLayoutCount) => void;
  showLabel?: boolean;
}) {
  const label = t("Раскладка графиков");
  return (
    <label className="chart-layout-control" title={label}>
      <ChartLayoutPreview count={value} />
      {showLabel && <span>{label}</span>}
      <select
        value={value}
        aria-label={label}
        aria-controls="chart-workspace"
        onChange={(event) => {
          const count = Number(event.currentTarget.value);
          if (isChartLayoutCount(count)) onChange(count);
        }}
      >
        {CHART_LAYOUT_COUNTS.map((count) => (
          <option key={count} value={count} aria-label={chartCountLabel(count)}>
            {count}
          </option>
        ))}
      </select>
    </label>
  );
}

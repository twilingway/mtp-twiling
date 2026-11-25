import { useTerminal } from "../context.js";
const RANGE_OPTIONS = [
  [1, "1 день"],
  [5, "5 дней"],
  [30, "30 дней"],
  [90, "90 дней"],
  [180, "180 дней"],
  [365, "365 дней"],
  [1825, "1825 дней"],
  [3650, "3650 дней"]
] as const;
/** History lookback is independent of candle interval and camera zoom. */
export function ChartRangeControl() {
  const { controller, state } = useTerminal();
  const days = state.preferences.rangeDays;
  return (
    <div className="chart-range-control">
      <label htmlFor="range">История</label>
      <select
        id="range"
        aria-label="Период истории"
        value={days}
        onChange={(event) => {
          void controller.setPreferences({ rangeDays: Number(event.target.value) });
        }}
      >
        {!RANGE_OPTIONS.some(([value]) => value === days) ? (
          <option value={days}>{days} дн.</option>
        ) : null}
        {RANGE_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <span className="chart-range-note">Глубина загрузки</span>
    </div>
  );
}

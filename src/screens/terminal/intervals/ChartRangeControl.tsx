import { useTerminal } from "../context.js";
import { t } from "../../../i18n/messages.js";
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
export function ChartRangeControl({
  slot = 1,
  placement = "plot"
}: { slot?: number; placement?: "toolbar" | "plot" } = {}) {
  const { controller, state } = useTerminal();
  const days = state.preferences.rangeDays;
  const plot = placement === "plot";
  const id = placement === "toolbar" ? "mobile-chart-range" : `range-plot-${slot}`;
  const label = plot ? `${t("Глубина загрузки")} · ${t("График")} ${slot}` : t("Период истории");
  return (
    <div
      className="chart-range-control"
      data-placement={placement}
      {...(plot && { title: `${label} · ${days} ${t("дн.")}` })}
    >
      {plot ? (
        <label className="chart-depth-pill" htmlFor={id} aria-hidden="true">
          <span className="chart-depth-icon" />
          <span className="chart-depth-days">
            {days} <span>{t("дн.")}</span>
          </span>
        </label>
      ) : (
        <label htmlFor={id}>{t("История")}</label>
      )}
      <select
        id={id}
        aria-label={label}
        value={days}
        disabled={
          state.loading ||
          state.historyViewReady === false ||
          state.backupBusy ||
          state.importingBackup ||
          state.importRecoveryRequired
        }
        onChange={(event) => {
          const owner = state.owner;
          void controller
            .setPreferences({ rangeDays: Number(event.target.value) })
            .catch((error: unknown) => {
              if (controller.getSnapshot().owner === owner)
                controller.notify(
                  error instanceof Error ? error.message : t("Не удалось восстановить график.")
                );
            });
        }}
      >
        {!RANGE_OPTIONS.some(([value]) => value === days) ? (
          <option value={days}>
            {days} {t("дн.")}
          </option>
        ) : null}
        {RANGE_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {t(label)}
          </option>
        ))}
      </select>
    </div>
  );
}

import { useTerminal } from "../context.js";
import { ClockZoneControl } from "../ClockZoneControl.js";
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
  placement = "footer"
}: { slot?: number; placement?: "footer" | "toolbar" } = {}) {
  const { controller, state } = useTerminal();
  const days = state.preferences.rangeDays;
  const id =
    placement === "toolbar" ? "mobile-chart-range" : slot === 1 ? "range" : `range-${slot}`;
  return (
    <div className="chart-range-control" data-placement={placement}>
      <label htmlFor={id}>{t("История")}</label>
      <select
        id={id}
        aria-label={t("Период истории")}
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
      {slot === 1 && placement === "footer" && (
        <>
          <span className="chart-range-note">{t("Глубина загрузки")}</span>
          <ClockZoneControl />
        </>
      )}
    </div>
  );
}

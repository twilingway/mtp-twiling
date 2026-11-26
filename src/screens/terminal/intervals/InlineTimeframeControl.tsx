import { t } from "../../../i18n/messages.js";
import {
  NATIVE_PERIOD_LABELS,
  NATIVE_TIMEFRAMES
} from "../../../model/intervals/native-timeframes.js";
import { getInterval, isNativeIntervalId } from "../../../model/intervals/registry.js";
import type { Timeframe } from "../../../model/types.js";
import { nativeInterval } from "../../../services/providers/bybit/market.js";
import { okxNativeInterval } from "../../../services/providers/okx/market.js";
import { useTerminal } from "../context.js";
import { publishWorkspaceTimeframe } from "../workspace-sync-controller.js";

function supportedIntervals(resolveInterval: (id: Timeframe) => string) {
  return NATIVE_TIMEFRAMES.filter((id) => {
    try {
      resolveInterval(id);
      return true;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return false;
    }
  });
}

const cryptoIntervals = {
  bybit: supportedIntervals(nativeInterval),
  okx: supportedIntervals(okxNativeInterval)
};

export function InlineTimeframeControl({
  slot,
  provider
}: {
  slot: number;
  provider?: keyof typeof cryptoIntervals | undefined;
}) {
  const { controller, state } = useTerminal();
  const value = state.preferences.timeframe;
  const options = provider ? cryptoIntervals[provider] : NATIVE_TIMEFRAMES;
  const label = `${t("Интервал свечей")} · ${t("График")} ${slot}`;
  return (
    <div className="chart-timeframe-inline" title={label}>
      <span id={slot === 1 ? "chart-period" : undefined} aria-hidden="true">
        {t(NATIVE_PERIOD_LABELS[value])}
      </span>
      <select
        aria-label={label}
        value={value}
        disabled={state.profileTransition || state.importingBackup || state.importRecoveryRequired}
        onChange={(event) => {
          const id = event.currentTarget.value;
          const owner = state.owner;
          if (
            !isNativeIntervalId(id) ||
            id === value ||
            !options.includes(id) ||
            controller.getSnapshot().owner !== owner
          )
            return;
          void controller
            .setTimeframe(id)
            .then(() => {
              if (controller.getSnapshot().owner === owner)
                publishWorkspaceTimeframe(controller, id);
            })
            .catch((error: unknown) => {
              if (controller.getSnapshot().owner === owner)
                controller.notify(
                  error instanceof Error ? error.message : t("Не удалось выполнить действие.")
                );
            });
        }}
      >
        {!options.includes(value) && (
          <option value={value} disabled>
            {t(NATIVE_PERIOD_LABELS[value])}
          </option>
        )}
        {options.map((id) => (
          <option key={id} value={id}>
            {t(getInterval(id).label)}
          </option>
        ))}
      </select>
    </div>
  );
}

import { t } from "../../../i18n/messages.js";
import { logicalForTime, timeForLogical } from "../../../charts/adapter.js";
import type { DrawingPoint } from "../../../model/types.js";
import { TIMEFRAMES } from "../../../model/history-codec.js";
import { dateTimeInput, parseDateTimeInput } from "../../../i18n/datetime-input.js";
import { intradayTimeframe } from "../../../i18n/format.js";
import { resolveTimeZone } from "../../../i18n/timezones.js";
import { useTerminal } from "../context.js";
import { draftNumber } from "./drawing-settings-model.js";
export function DrawingCoordinatesFields({
  points,
  point,
  setError
}: {
  points: DrawingPoint[];
  point: (index: number, patch: Partial<DrawingPoint>) => void;
  setError: (message: string) => void;
}) {
  const { state } = useTerminal();
  const interval = TIMEFRAMES[state.preferences.timeframe].ms;
  const inputZone = intradayTimeframe(state.preferences.timeframe)
    ? resolveTimeZone(state.preferences.timeZone)
    : "UTC";
  const coordinate = (p: DrawingPoint, index: number) => (
    <div className="coordinate-row" key={index}>
      <span>
        #{index + 1} {t("(цена, бар)")}
      </span>
      <input
        type="number"
        step="any"
        data-coordinate-value={index}
        aria-label={t("Точка координат") + " " + (index + 1) + t(": цена")}
        value={Number.isFinite(p.value) ? p.value : ""}
        onChange={(event) => point(index, { value: draftNumber(event.currentTarget.value) })}
      />
      <input
        type="number"
        step="1"
        data-coordinate-bar={index}
        aria-label={t("Точка координат") + " " + (index + 1) + t(": бар")}
        value={
          Number.isFinite(p.timestamp)
            ? Math.round(logicalForTime(state.candles, p.timestamp, interval))
            : ""
        }
        onChange={(event) => {
          const timestamp = timeForLogical(
            state.candles,
            draftNumber(event.currentTarget.value),
            interval
          );
          point(index, { timestamp: timestamp ?? NaN });
        }}
      />
      <input
        type="datetime-local"
        step="60"
        data-coordinate-time={index}
        aria-label={
          t("Точка координат") + " " + (index + 1) + t(": дата и время") + " " + inputZone
        }
        title={inputZone}
        value={
          Number.isFinite(new Date(p.timestamp).getTime())
            ? dateTimeInput(p.timestamp, inputZone)
            : ""
        }
        onChange={(event) => {
          const timestamp = parseDateTimeInput(
            event.currentTarget.value,
            inputZone,
            Number.isFinite(new Date(p.timestamp).getTime()) ? p.timestamp : undefined
          );
          if (Number.isFinite(timestamp)) {
            point(index, { timestamp });
            setError("");
          } else {
            point(index, { timestamp: NaN });
            setError(t("Такого местного времени не существует (переход часов)."));
          }
        }}
      />
    </div>
  );

  return <>{points.map(coordinate)}</>;
}

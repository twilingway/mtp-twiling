import { useState } from "react";
import { t } from "../../../i18n/messages.js";
import { logicalForTime, timeForLogical } from "../../../charts/adapter.js";
import {
  nativePriceStep,
  priceStepDecimals,
  roundPriceToStep
} from "../../../charts/price-format.js";
import type { DrawingPoint } from "../../../model/types.js";
import { TIMEFRAMES } from "../../../model/history-codec.js";
import { selectedMarketRow } from "../../../model/selected-instrument.js";
import { dateTimeInput, parseDateTimeInput } from "../../../i18n/datetime-input.js";
import { intradayTimeframe } from "../../../i18n/format.js";
import { resolveTimeZone } from "../../../i18n/timezones.js";
import { useTerminal } from "../context.js";
import { draftNumber } from "./drawing-settings-model.js";

function CoordinatePriceInput({
  value,
  index,
  step,
  disabled,
  onChange
}: {
  value: number;
  index: number;
  step: number | null;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [edit, setEdit] = useState<string | null>(null);
  const display = roundPriceToStep(value, step);
  const decimals = step === null ? null : priceStepDecimals(step);
  const formatted =
    decimals !== null && decimals <= 100 ? display.toFixed(decimals) : String(display);
  return (
    <input
      type="number"
      step={step ?? "any"}
      disabled={disabled}
      data-coordinate-value={index}
      aria-label={t("Точка координат") + " " + (index + 1) + t(": цена")}
      value={edit ?? (Number.isFinite(value) ? formatted : "")}
      onChange={(event) => {
        const input = event.currentTarget.value;
        setEdit(input);
        onChange(roundPriceToStep(draftNumber(input), step));
      }}
      onBlur={() => setEdit(null)}
    />
  );
}

export function DrawingCoordinatesFields({
  points,
  point,
  setError,
  disabled = false
}: {
  points: DrawingPoint[];
  point: (index: number, patch: Partial<DrawingPoint>) => void;
  setError: (message: string) => void;
  disabled?: boolean;
}) {
  const { state } = useTerminal();
  const interval = TIMEFRAMES[state.preferences.timeframe].ms;
  const priceStep = nativePriceStep(selectedMarketRow(state.rows, state.preferences));
  const inputZone = intradayTimeframe(state.preferences.timeframe)
    ? resolveTimeZone(state.preferences.timeZone)
    : "UTC";
  const coordinate = (p: DrawingPoint, index: number) => (
    <div className="coordinate-row" key={index}>
      <span>
        #{index + 1} {t("(цена, бар)")}
      </span>
      <CoordinatePriceInput
        value={p.value}
        index={index}
        step={priceStep}
        disabled={disabled}
        onChange={(value) => point(index, { value })}
      />
      <input
        type="number"
        step="1"
        disabled={disabled}
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
        disabled={disabled}
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

import { t } from "../../i18n/messages.js";
import { validProviderIdentity } from "../../model/market-provider.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { useTerminal } from "./context.js";
import { providerLabel } from "./provider-label.js";

export function CorrelationInstrumentSelect({
  value,
  onChange
}: {
  value: string;
  onChange(uid: string): void;
}) {
  const { state } = useTerminal();
  const primary = selectedMarketRow(state.rows, state.preferences)?.uid;
  const counts = new Map<string, number>();
  for (const { uid } of state.rows) if (uid) counts.set(uid, (counts.get(uid) ?? 0) + 1);
  const options = state.rows.flatMap((row) => {
    const uid = row.uid;
    return uid && uid !== primary && counts.get(uid) === 1 && validProviderIdentity(row)
      ? [
          {
            uid,
            label: [
              row.ticker || row.symbol,
              row.providerRef ? providerLabel(row.providerRef) : row.classCode,
              row.name
            ]
              .filter(Boolean)
              .join(" · ")
          }
        ]
      : [];
  });
  const locale = state.preferences.locale;
  return (
    <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
      <option value="">{t("Выберите инструмент", locale)}</option>
      {value && !options.some(({ uid }) => uid === value) && (
        <option value={value} disabled>
          {t("Инструмент недоступен.", locale)}
        </option>
      )}
      {options.map(({ uid, label }) => (
        <option key={uid} value={uid}>
          {label}
        </option>
      ))}
    </select>
  );
}

import type { Locale } from "../../i18n/preferences.js";
import type { TerminalState } from "./state.js";
import { StepChartLoader } from "./StepChartLoader.js";

const messages = {
  ru: {
    loading: "Загрузка списка котировок…",
    error: "Не удалось загрузить список котировок.",
    recovery: "Не удалось открыть рабочее пространство. Сохранённые данные не изменены.",
    retry: "Повторить"
  },
  en: {
    loading: "Loading watchlist…",
    error: "Could not load the watchlist.",
    recovery: "Could not open the workspace. Your saved data is unchanged.",
    retry: "Retry"
  }
};

export function watchlistStartupNotice({
  watchlistStartup,
  rows
}: Pick<TerminalState, "watchlistStartup" | "rows">): "loading" | "error" | undefined {
  if (
    (watchlistStartup === "loading" || watchlistStartup === "error") &&
    !rows.some((row) => row.uid != null)
  )
    return watchlistStartup;
}

export function WatchlistStartupStatus({
  phase,
  locale = "ru",
  migrationIncomplete = false,
  onRetry
}: {
  phase: "loading" | "error";
  locale?: Locale | undefined;
  migrationIncomplete?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="watchlist-startup-status" role="status">
      {phase === "loading" && <StepChartLoader />}
      <span>
        {phase === "error" && migrationIncomplete
          ? messages[locale].recovery
          : messages[locale][phase]}
      </span>
      {phase === "error" && onRetry && (
        <button type="button" onClick={onRetry}>
          {messages[locale].retry}
        </button>
      )}
    </div>
  );
}

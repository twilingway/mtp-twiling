import type { Locale } from "../../i18n/preferences.js";
import type { TerminalState } from "./state.js";

const messages = {
  ru: { loading: "Загрузка списка котировок…", error: "Не удалось загрузить список котировок." },
  en: { loading: "Loading watchlist…", error: "Could not load the watchlist." }
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
  locale = "ru"
}: {
  phase: "loading" | "error";
  locale?: Locale | undefined;
}) {
  return (
    <div className="watchlist-startup-status" role="status">
      {phase === "loading" && (
        <div className="watchlist-loading-chart" aria-hidden="true">
          <div className="watchlist-loading-track">
            {Array.from({ length: 10 }, (_, index) => (
              <span
                key={index}
                style={{ left: `${(index - 2) * 18}px`, bottom: `${(index - 1) * 8}px` }}
              />
            ))}
          </div>
        </div>
      )}
      <span>{messages[locale][phase]}</span>
    </div>
  );
}

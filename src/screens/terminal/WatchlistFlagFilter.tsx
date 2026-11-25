import { useTerminal } from "./context.js";
import { flagText } from "../../i18n/messages-watchlist-flags.js";
import { WATCHLIST_FLAG_COLORS, watchlistFlagCounts } from "../../model/watchlist-flags.js";
import type {
  WatchlistFlagColor,
  WatchlistFlagFilter as Filter
} from "../../model/watchlist-flags.js";
import { persistWatchlistFlagChange } from "./watchlist-flag-preferences.js";

export function WatchlistFlagFilter() {
  const { controller, state } = useTerminal(),
    flags = state.preferences.watchlistFlags,
    counts = watchlistFlagCounts(state.rows, flags),
    disabled = !!(state.backupBusy || state.importingBackup || state.importRecoveryRequired);
  function change(value: Filter | null) {
    const owner = state.owner;
    void persistWatchlistFlagChange(
      controller,
      value === null ? { clear: true } : { filter: value }
    ).catch((error: unknown) => {
      if (controller.getSnapshot().owner === owner)
        controller.notify(error instanceof Error ? error.message : flagText("failed"));
    });
  }
  return (
    <div className="watchlist-flag-filter">
      <label className="watchlist-flag-filter-label" htmlFor="watchlist-flag-filter">
        {flagText("filter")}
      </label>
      <select
        id="watchlist-flag-filter"
        aria-label={flagText("filter")}
        disabled={disabled}
        value={state.preferences.watchlistFlagFilter ?? "all"}
        onChange={(event) => change(event.target.value as Filter)}
      >
        <option value="all">
          {flagText("all")} ({state.rows.length})
        </option>
        {(Object.keys(WATCHLIST_FLAG_COLORS) as WatchlistFlagColor[]).map((color) => (
          <option key={color} value={color}>
            {flagText(color)} ({counts[color]})
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={disabled || !Object.keys(flags ?? {}).length}
        title={flagText("clearAll")}
        aria-label={flagText("clearAll")}
        onClick={() => change(null)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 3h10v14l-5-3-5 3ZM3 17 17 3" />
        </svg>
      </button>
    </div>
  );
}

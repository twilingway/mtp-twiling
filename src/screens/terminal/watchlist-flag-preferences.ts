import type { TerminalController } from "./controller.js";
import type { TerminalPreferences } from "./state.js";
import type { MarketRow } from "../../model/types.js";
import type { WatchlistFlagColor, WatchlistFlagFilter } from "../../model/watchlist-flags.js";
import {
  isWatchlistFlagFilter,
  updatedWatchlistFlags,
  watchlistFlagKey
} from "../../model/watchlist-flags.js";
import { flagText } from "../../i18n/messages-watchlist-flags.js";

type Controller = Pick<TerminalController, "getSnapshot" | "setPreferences" | "subscribe">;
const pending = new WeakMap<Controller, Promise<void>>();
type Change =
  | { row: MarketRow; color: WatchlistFlagColor | null }
  | { clear: true }
  | { filter: WatchlistFlagFilter };

/** Merge after earlier flag writes; reject work crossing a profile or import boundary. */
export function persistWatchlistFlagChange(controller: Controller, change: Change): Promise<void> {
  const initial = controller.getSnapshot(),
    owner = initial.owner,
    revision = initial.chartRevision;
  const initialAllowed =
    !initial.backupBusy && !initial.importingBackup && !initial.importRecoveryRequired;
  let cancelled = !initialAllowed;
  const unsubscribe = controller.subscribe(() => {
    const state = controller.getSnapshot();
    if (
      state.owner !== owner ||
      state.chartRevision !== revision ||
      state.backupBusy ||
      state.importingBackup ||
      state.importRecoveryRequired
    )
      cancelled = true;
  });
  const task = (pending.get(controller) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const current = controller.getSnapshot(),
        before = current.preferences.watchlistFlags,
        beforeFilter = current.preferences.watchlistFlagFilter,
        key = "row" in change ? watchlistFlagKey(change.row) : null;
      const valid = () => {
        const state = controller.getSnapshot();
        return (
          !cancelled &&
          state.owner === owner &&
          state.chartRevision === revision &&
          !state.backupBusy &&
          !state.importingBackup &&
          !state.importRecoveryRequired &&
          state.preferences.watchlistFlags === before &&
          state.preferences.watchlistFlagFilter === beforeFilter &&
          (!("row" in change) ||
            (key !== null && state.rows.some((row) => watchlistFlagKey(row) === key)))
        );
      };
      if (!valid()) return;
      let patch: Partial<TerminalPreferences>;
      if ("filter" in change) {
        if (!isWatchlistFlagFilter(change.filter)) return;
        patch = { watchlistFlagFilter: change.filter };
      } else if ("clear" in change) patch = { watchlistFlags: {}, watchlistFlagFilter: "all" };
      else {
        if (!key) return;
        const flags = updatedWatchlistFlags(before, key, change.color);
        if (!flags) throw new Error(flagText("limit"));
        patch = { watchlistFlags: flags };
      }
      await controller.setPreferences(patch, false, valid);
    });
  pending.set(controller, task);
  void task
    .finally(() => {
      unsubscribe();
      if (pending.get(controller) === task) pending.delete(controller);
    })
    .catch(() => {});
  return task;
}

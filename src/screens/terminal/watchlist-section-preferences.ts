import type { TerminalController } from "./controller.js";
import type { TerminalState } from "./state.js";
import { changeWatchlistSections } from "../../model/watchlist-sections-actions.js";
import type { WatchlistSectionChange } from "../../model/watchlist-sections-actions.js";
import { reconcileWatchlistSections } from "../../model/watchlist-sections.js";
import { importWritable } from "./controller-transfer-guard.js";

type Controller = Pick<
  TerminalController,
  "getSnapshot" | "setPreferences" | "subscribe" | "update" | "sessionKey"
>;
const pending = new WeakMap<Controller, Promise<boolean>>();
const route = (state: TerminalState) =>
  JSON.stringify([
    state.chartRevision,
    state.preferences.symbol,
    state.preferences.instrumentUid,
    state.preferences.timeframe,
    state.preferences.engine,
    state.preferences.rangeDays
  ]);

/** Serialized display-only writes. A boundary remains cancelled even if the old owner returns. */
export function persistWatchlistSectionChange(
  controller: Controller,
  change: WatchlistSectionChange
): Promise<boolean> {
  const initial = controller.getSnapshot(),
    owner = initial.owner,
    session = controller.sessionKey(),
    initialRoute = route(initial);
  let cancelled = !importWritable(initial) || !!initial.backupBusy;
  const sameSession = () =>
    controller.getSnapshot().owner === owner && controller.sessionKey() === session;
  const check = () => {
    const state = controller.getSnapshot();
    if (
      !sameSession() ||
      !importWritable(state, owner) ||
      state.backupBusy ||
      route(state) !== initialRoute
    )
      cancelled = true;
  };
  const unsubscribe = controller.subscribe(check);
  const task = (pending.get(controller) ?? Promise.resolve(false))
    .catch(() => false)
    .then(async () => {
      check();
      if (cancelled) return false;
      const state = controller.getSnapshot(),
        previous = state.preferences.watchlistSections;
      const next = changeWatchlistSections(
        reconcileWatchlistSections(state.rows, previous),
        change
      );
      if (!next) return false;
      const rowIdentities = JSON.stringify(state.rows.map(({ uid, symbol }) => [uid, symbol]));
      const valid = () => {
        check();
        const current = controller.getSnapshot();
        return (
          !cancelled &&
          current.preferences.watchlistSections === previous &&
          JSON.stringify(current.rows.map(({ uid, symbol }) => [uid, symbol])) === rowIdentities
        );
      };
      try {
        await controller.setPreferences({ watchlistSections: next }, false, valid);
        return (
          !cancelled &&
          sameSession() &&
          controller.getSnapshot().preferences.watchlistSections === next
        );
      } catch (error) {
        // setPreferences publishes optimistically. Roll back only our still-current field.
        const current = controller.getSnapshot();
        if (sameSession() && current.preferences.watchlistSections === next) {
          const preferences = { ...current.preferences };
          if (previous === undefined) delete preferences.watchlistSections;
          else preferences.watchlistSections = previous;
          controller.update({ preferences });
        }
        throw error;
      }
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

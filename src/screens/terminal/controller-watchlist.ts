import * as storage from "../../services/storage-v2.js";
import { moveWatchlistRow } from "../../services/watchlist-order.js";
import type { WatchlistMove } from "../../services/watchlist-order.js";
import { pinSelectedInstrument, selectedMarketRow } from "../../model/selected-instrument.js";
import { watchlistSelectionFallback } from "../../model/watchlist-sections.js";
import type { MarketRow } from "../../model/types.js";
import type { TerminalController } from "./controller.js";
import type { TerminalSession } from "./controller-session.js";
import { importWritable } from "./controller-transfer-guard.js";

type Controller = Pick<
  TerminalController,
  "getSnapshot" | "subscribe" | "update" | "flush" | "setPreferences"
>;
type Session = Pick<TerminalSession, "client" | "matches" | "applyBankState">;

/** Cancels permanently when a transfer/profile boundary is crossed, even if its final state returns. */
function mutationGuard(controller: Controller, session: Session, owner: string) {
  const initial = controller.getSnapshot(),
    client = session.client,
    revision = initial.chartRevision;
  let cancelled = false;
  const valid = () => {
    const state = controller.getSnapshot();
    if (
      !client ||
      client.owner !== owner ||
      session.client !== client ||
      !session.matches(client) ||
      !importWritable(state, owner) ||
      state.chartRevision !== revision
    )
      cancelled = true;
    return !cancelled;
  };
  valid();
  const dispose = controller.subscribe(valid);
  return { client, valid, dispose };
}

export async function removeWatchlistInstrument(
  controller: Controller,
  session: Session,
  reference: Pick<MarketRow, "uid" | "symbol">
): Promise<void> {
  const guard = mutationGuard(controller, session, controller.getSnapshot().owner),
    client = guard.client;
  try {
    if (!client || !guard.valid()) return;
    await controller.flush();
    if (!guard.valid()) return;
    const before = controller.getSnapshot(),
      selected = selectedMarketRow(before.rows, before.preferences);
    await client.removeInstrument(reference);
    if (!guard.valid()) return;
    session.applyBankState(client.snapshot());
    const current = controller.getSnapshot(),
      preferences = current.preferences;
    if (
      !guard.valid() ||
      !selected ||
      selectedMarketRow(current.rows, { symbol: selected.symbol, instrumentUid: selected.uid }) ||
      preferences.symbol !== selected.symbol ||
      (preferences.instrumentUid !== undefined && preferences.instrumentUid !== selected.uid)
    )
      return;
    await controller.setPreferences(watchlistSelectionFallback(current), true, () => {
      const latest = controller.getSnapshot().preferences;
      return (
        guard.valid() &&
        latest.symbol === preferences.symbol &&
        latest.instrumentUid === preferences.instrumentUid &&
        latest.watchlistSections === preferences.watchlistSections
      );
    });
  } finally {
    guard.dispose();
  }
}

export async function reorderCanonicalWatchlist(
  controller: Controller,
  session: Session,
  move: WatchlistMove,
  expectedOwner: string
): Promise<boolean> {
  const guard = mutationGuard(controller, session, expectedOwner),
    client = guard.client;
  try {
    const state = controller.getSnapshot();
    if (!client || !guard.valid() || !moveWatchlistRow(state.rows, move)) return false;
    const preferences = pinSelectedInstrument(state.rows, state.preferences);
    if (preferences !== state.preferences) controller.update({ preferences });
    if (!guard.valid()) return false;
    // Capture the owning layout explicitly; never read another profile after a synchronous listener.
    await storage.savePreferences(expectedOwner, preferences);
    if (!guard.valid()) return false;
    const changed = await client.reorderWatchlist(move);
    if (!guard.valid()) return false;
    if (changed) session.applyBankState(client.snapshot());
    return changed;
  } finally {
    guard.dispose();
  }
}

import * as storage from "../../services/storage.js";
import { resetSharedChartCamera } from "../../services/chart-camera.js";
import { validateBackup } from "../../model/backup-format.js";
import { assertImportCurrent, type BackupImportOptions } from "../../model/backup-import.js";
import type { ChartAdapter } from "../../charts/adapter.js";
import type { TBankClient } from "../../services/tbank-client.js";
import type { TerminalState } from "./state.js";
import type { TerminalEditing } from "./controller-editing.js";
import type { TerminalSession } from "./controller-session.js";

interface ImportBridge {
  getState: () => TerminalState;
  getClient: () => TBankClient | null;
  getChart: () => ChartAdapter | null;
  saveView: () => Promise<void>;
  editing: Pick<TerminalEditing, "flush" | "reset">;
  session: Pick<TerminalSession, "matches" | "prepareProfile" | "applyBankState">;
  resetHistory: () => void;
  update: (patch: Partial<TerminalState>) => void;
  loadHistory: () => Promise<void>;
  notify: (message: string) => void;
}

function invalidateImportedView(
  bridge: ImportBridge,
  recoveryRequired: boolean,
  historyHelp?: string
): void {
  bridge.resetHistory();
  bridge.update({
    candles: [],
    loading: false,
    historyViewReady: false,
    importRecoveryRequired: recoveryRequired,
    chartRevision: (bridge.getState().chartRevision ?? 0) + 1,
    ...(historyHelp ? { historyHelp } : {})
  });
}

/** Retry only the committed profile's restoration, without repeating any backup writes. */
export async function restoreImportedProfile(
  bridge: ImportBridge,
  guard?: () => boolean
): Promise<void> {
  const { owner, name } = bridge.getState(),
    client = bridge.getClient(),
    sessionValid = () => bridge.session.matches(client) && owner === bridge.getState().owner,
    valid = () => {
      if (!sessionValid()) return false;
      assertImportCurrent(guard);
      return true;
    };
  try {
    await resetSharedChartCamera(owner);
    if (!valid()) return;
    await bridge.session.prepareProfile(owner, name, true, valid);
    if (!valid()) return;
    const watchlist = await storage.loadWatchlist(owner);
    if (!valid()) return;
    if (watchlist !== undefined && client) {
      client.rows = watchlist;
      const snapshot = await client.start();
      if (!valid()) return;
      bridge.session.applyBankState(snapshot);
    }
    // An adapter born under the transfer barrier may have read the old shared camera.
    invalidateImportedView(bridge, false);
    await bridge.loadHistory();
  } catch (error) {
    if (sessionValid()) {
      const chart = bridge.getChart();
      if (chart) {
        chart.retired = true;
        chart.persistView = false;
      }
      bridge.editing.reset();
      const detail = error instanceof Error ? error.message : String(error);
      invalidateImportedView(
        bridge,
        true,
        `Данные импорта записаны, но профиль не восстановлен: ${detail}. Повторите восстановление.`
      );
    }
    throw error;
  }
}

export async function importTerminalBackup(
  input: unknown,
  bridge: ImportBridge,
  options: BackupImportOptions = {}
): Promise<void> {
  const data = validateBackup(input),
    { owner } = bridge.getState(),
    client = bridge.getClient(),
    valid = () => bridge.session.matches(client) && owner === bridge.getState().owner;
  await bridge.editing.flush();
  if (!valid()) return;
  assertImportCurrent(options.valid);
  await bridge.saveView();
  if (!valid()) return;
  assertImportCurrent(options.valid);
  const outgoing = bridge.getChart(),
    previousPersistence = outgoing?.persistView,
    previousRetired = outgoing?.retired;
  if (outgoing) {
    outgoing.retired = true;
    outgoing.persistView = false;
  }
  let result: Awaited<ReturnType<typeof storage.importBackup>>;
  try {
    result = await storage.importBackup(owner, data, {
      ...options,
      valid: () => valid() && (options.valid?.() ?? true)
    });
  } catch (error) {
    if (outgoing) {
      if (previousPersistence === undefined) delete outgoing.persistView;
      else outgoing.persistView = previousPersistence;
      if (previousRetired === undefined) delete outgoing.retired;
      else outgoing.retired = previousRetired;
    }
    throw error;
  }
  if (!valid()) return;
  assertImportCurrent(options.valid);
  options.onCommitted?.();
  // Commit succeeded: invalidate all old/newborn canvas work before any next await.
  bridge.editing.reset();
  invalidateImportedView(bridge, false);
  await restoreImportedProfile(bridge, options.valid);
  if (valid())
    bridge.notify(`Импортировано: ${result.drawings} рисунков, ${result.images} изображений.`);
}

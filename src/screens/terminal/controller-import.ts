import * as storage from "../../services/storage.js";
import { resetSharedChartCamera } from "../../services/chart-camera.js";
import { validateBackup } from "../../model/backup-format.js";
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

export async function importTerminalBackup(input: unknown, bridge: ImportBridge): Promise<void> {
  const data = validateBackup(input),
    { owner, name } = bridge.getState(),
    client = bridge.getClient(),
    valid = () => bridge.session.matches(client) && owner === bridge.getState().owner;
  await bridge.editing.flush();
  if (!valid()) return;
  await bridge.saveView();
  if (!valid()) return;
  const outgoing = bridge.getChart(),
    previousPersistence = outgoing?.persistView;
  if (outgoing) outgoing.persistView = false;
  let result: Awaited<ReturnType<typeof storage.importBackup>>;
  try {
    result = await storage.importBackup(owner, data);
  } catch (error) {
    if (outgoing) {
      if (previousPersistence === undefined) delete outgoing.persistView;
      else outgoing.persistView = previousPersistence;
    }
    throw error;
  }
  await resetSharedChartCamera(owner);
  if (!valid()) return;
  bridge.editing.reset();
  bridge.resetHistory();
  bridge.update({
    candles: [],
    loading: false,
    chartRevision: (bridge.getState().chartRevision ?? 0) + 1
  });
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
  await bridge.loadHistory();
  if (valid())
    bridge.notify(`Импортировано: ${result.drawings} рисунков, ${result.images} изображений.`);
}

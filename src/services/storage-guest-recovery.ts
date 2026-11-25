import { db, transaction } from "./storage-db.js";
import { object } from "./types.js";
import { validateBackup } from "../model/backup-format.js";
import { isGuestQuotaError } from "./storage-guest-cache.js";
import type { Backup } from "../model/types.js";
import { projectGuest, guestExport } from "./storage-guest-projection.js";
import type { GuestProjection } from "./storage-guest-projection.js";
import {
  GUEST_TARGET,
  GUEST_DECISION,
  GUEST_STORES,
  readGuestRecords,
  publicTargetOccupied,
  requestValue
} from "./storage-guest-records.js";

export type GuestAdoptionStatus =
  | "copied"
  | "already-checked"
  | "source-empty"
  | "target-occupied"
  | "source-invalid"
  | "quota-failed"
  | "failed";
export interface GuestRecoverySummary {
  available: boolean;
  invalid: boolean;
  copied: boolean;
  unresolved: boolean;
  history: number;
}
const check = (valid: () => boolean, signal?: AbortSignal) => {
  if (signal?.aborted || !valid())
    throw new DOMException("Профиль изменился. Повторите экспорт.", "AbortError");
};
function writeProjection(tx: IDBTransaction, projection: GuestProjection) {
  const { backup } = projection,
    pref = tx.objectStore("preferences");
  if (backup.layout !== undefined)
    pref.put({ id: `layout:${GUEST_TARGET}`, owner: GUEST_TARGET, value: backup.layout });
  const rows = backup.watchlist ?? [];
  pref.put({ id: `watchlist:${GUEST_TARGET}`, owner: GUEST_TARGET, value: rows });
  pref.put({ id: `market:${GUEST_TARGET}`, owner: GUEST_TARGET, value: { rows, at: Date.now() } });
  for (const view of backup.views ?? [])
    pref.put({
      id: `view:${GUEST_TARGET}:${view.key}`,
      owner: GUEST_TARGET,
      viewKey: view.key,
      value: view.value
    });
  for (const camera of projection.cameras) pref.put(camera);
  for (const document of backup.drawings)
    tx.objectStore("drawings").put({
      id: `${GUEST_TARGET}:${document.symbol}`,
      owner: GUEST_TARGET,
      symbol: document.symbol,
      items: document.items
    });
  for (const image of projection.images)
    tx.objectStore("images").put({
      ...image,
      id: crypto.randomUUID(),
      owner: GUEST_TARGET,
      syncId: image.syncId ?? image.id
    });
  for (const block of projection.history)
    tx.objectStore("history").put({
      id: `${GUEST_TARGET}:${block.uid}:${block.timeframe}:${block.day}`,
      owner: GUEST_TARGET,
      uid: block.uid,
      timeframe: block.timeframe,
      day: block.day,
      data: block.data,
      ...(block.updatedAt !== undefined ? { updatedAt: block.updatedAt } : {})
    });
  for (const coverage of projection.coverage) tx.objectStore("coverage").put(coverage);
}

/** Called only during anonymous public activation, before the public client can write bootstrap data. */
export async function adoptLegacyGuestWorkspace(
  valid: () => boolean,
  signal?: AbortSignal
): Promise<GuestAdoptionStatus> {
  check(valid, signal);
  const result: { status: GuestAdoptionStatus; failure?: unknown } = { status: "failed" };
  try {
    await transaction(
      [...GUEST_STORES],
      (tx) => {
        void (async () => {
          check(valid, signal);
          const decision = await requestValue<unknown>(
            tx.objectStore("preferences").get(GUEST_DECISION)
          );
          check(valid, signal);
          if (decision) {
            result.status = "already-checked";
            return;
          }
          const occupied = await publicTargetOccupied(tx);
          check(valid, signal);
          if (occupied) result.status = "target-occupied";
          else {
            const records = await readGuestRecords(tx, true);
            check(valid, signal);
            let projection: GuestProjection;
            try {
              projection = projectGuest(records);
            } catch {
              result.status = "source-invalid";
              throw new Error("Invalid legacy workspace");
            }
            result.status = projection.available ? "copied" : "source-empty";
            if (result.status === "copied") writeProjection(tx, projection);
          }
          check(valid, signal);
          tx.objectStore("preferences").put({
            id: GUEST_DECISION,
            owner: GUEST_TARGET,
            value: { status: result.status }
          });
        })().catch((error) => {
          result.failure = error;
          try {
            tx.abort();
          } catch {
            /* Native commit already completed. */
          }
        });
      },
      signal
    );
    return result.status;
  } catch (error) {
    check(valid, signal);
    if (error instanceof Error && error.name === "AbortError") throw error;
    return result.status === "source-invalid"
      ? result.status
      : result.failure instanceof DOMException && result.failure.name === "AbortError"
        ? Promise.reject(result.failure)
        : isGuestQuotaError(error)
          ? "quota-failed"
          : "failed";
  }
}

async function readProjection(history: boolean, valid: () => boolean, signal?: AbortSignal) {
  check(valid, signal);
  const tx = db.transaction([...GUEST_STORES], "readonly");
  const records = await readGuestRecords(tx, history);
  check(valid, signal);
  return projectGuest(records);
}
export async function inspectLegacyGuestWorkspace(): Promise<GuestRecoverySummary> {
  const tx = db.transaction([...GUEST_STORES], "readonly");
  const [records, decision] = await Promise.all([
    readGuestRecords(tx, false),
    requestValue<unknown>(tx.objectStore("preferences").get(GUEST_DECISION))
  ]);
  try {
    const projection = projectGuest(records);
    return {
      available: projection.available,
      invalid: false,
      copied: object(object(decision)?.value)?.status === "copied",
      unresolved: decision === undefined,
      history: records.historyCount
    };
  } catch {
    return {
      available: true,
      invalid: true,
      copied: false,
      unresolved: decision === undefined,
      history: records.historyCount
    };
  }
}
export async function createLegacyGuestBackup({
  includeHistory = false,
  valid = () => true,
  signal
}: {
  includeHistory?: boolean;
  valid?: () => boolean;
  signal?: AbortSignal;
} = {}): Promise<Backup> {
  const projection = await readProjection(includeHistory, valid, signal);
  const backup = await guestExport(projection, () => check(valid, signal));
  check(valid, signal);
  return validateBackup(backup);
}

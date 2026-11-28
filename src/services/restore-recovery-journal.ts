import type { BackupImportRecovery } from "../model/backup-import.js";
interface RestoreRecovery {
  readonly version: 1;
  readonly owner: string;
  readonly operationId: string;
  readonly mode: "shared-runtime" | "import";
  readonly nativeImportId?: string;
  readonly storageOwner?: string;
}
const key = (owner: string) => `workspace-restore-recovery:${owner}`;
export function createNativeImportRecovery(owner: string): BackupImportRecovery {
  return { owner, operationId: crypto.randomUUID() };
}
/** Put this record in the same native transaction as all imported portable records. */
export function nativeImportRecoveryRecord(storageOwner: string, receipt: BackupImportRecovery) {
  if (
    !receipt.owner ||
    !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(
      receipt.operationId
    ) ||
    (storageOwner !== receipt.owner && storageOwner !== `profile-v2:${receipt.owner}`)
  )
    throw new Error("Invalid native import receipt");
  const value: RestoreRecovery = {
    version: 1,
    owner: receipt.owner,
    operationId: receipt.operationId,
    mode: "import",
    nativeImportId: receipt.operationId,
    storageOwner
  };
  return { id: key(receipt.owner), owner: receipt.owner, value };
}
function record(input: unknown, owner: string): RestoreRecovery | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || !("value" in input))
    throw new Error("Invalid restore recovery journal");
  const value = input.value;
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("owner" in value) ||
    value.owner !== owner ||
    !("operationId" in value) ||
    typeof value.operationId !== "string" ||
    value.operationId.length < 8 ||
    value.operationId.length > 100 ||
    !("mode" in value) ||
    (value.mode !== "shared-runtime" && value.mode !== "import")
  )
    throw new Error("Invalid restore recovery journal");
  if (
    ("nativeImportId" in value || "storageOwner" in value) &&
    (!("nativeImportId" in value) ||
      value.nativeImportId !== value.operationId ||
      value.mode !== "import" ||
      !("storageOwner" in value) ||
      (value.storageOwner !== owner && value.storageOwner !== `profile-v2:${owner}`))
  )
    throw new Error("Invalid native import receipt");
  return {
    version: 1,
    owner,
    operationId: value.operationId,
    mode: value.mode,
    ...("nativeImportId" in value && "storageOwner" in value
      ? { nativeImportId: value.operationId, storageOwner: String(value.storageOwner) }
      : {})
  };
}

/** A pending operation's mode survives default UI retries and cold controller creation. */
export async function readRestoreRecovery(owner: string): Promise<RestoreRecovery | undefined> {
  const storage = await import("./storage-db.js");
  return record(await storage.get("preferences", key(owner)), owner);
}
export async function beginRestoreRecovery(
  owner: string,
  preserveStoredCamera?: boolean
): Promise<RestoreRecovery> {
  const storage = await import("./storage-db.js");
  const previous = record(await storage.get("preferences", key(owner)), owner);
  if (
    previous &&
    (preserveStoredCamera === undefined || (preserveStoredCamera && previous.mode === "import"))
  )
    return previous;
  const operationId = crypto.randomUUID();
  const pending: RestoreRecovery = {
    version: 1,
    owner,
    operationId,
    mode: preserveStoredCamera ? "shared-runtime" : "import"
  };
  await storage.put("preferences", { id: key(owner), owner, value: pending });
  return pending;
}

/** Never clear a newer operation for this owner or another owner's recovery reason. */
export async function completeRestoreRecovery(pending: RestoreRecovery): Promise<void> {
  const storage = await import("./storage-db.js");
  await storage.transaction(["preferences"], (tx) => {
    const store = tx.objectStore("preferences"),
      request = store.get(key(pending.owner));
    request.onsuccess = () => {
      try {
        const current = record(request.result as unknown, pending.owner);
        if (current?.operationId === pending.operationId) store.delete(key(pending.owner));
      } catch {
        tx.abort();
      }
    };
  });
}

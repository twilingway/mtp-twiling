import { isRecord } from "../../model/backup-format.js";
import { get, transaction } from "../storage-db.js";
import { shaPattern, uuidPattern } from "./backup.js";
import { strongDeviceSlotTag } from "./device-slot-cas.js";
import { defaultDriveSlotMode, type DriveSlotMode } from "./device-slot-identity.js";
import {
  deviceSlotKey,
  parseDeviceSlotCheckpoint,
  parseDeviceSlotEnvelope
} from "./device-slot-model.js";
import type { DeviceSlotCheckpoint, DeviceSlotScope } from "./device-slot-model.js";
import type { DeviceSlotPendingWrite } from "./device-slot-store.js";
import { DriveError } from "./types.js";

export interface PendingSlotRecord {
  readonly write: DeviceSlotPendingWrite;
  readonly digest: string;
}
export interface DeviceSlotRecord {
  readonly schemaVersion: 3;
  readonly generation: number;
  readonly enabled?: boolean | undefined;
  readonly automatic: boolean;
  readonly mode: DriveSlotMode;
  readonly scope?: DeviceSlotScope | undefined;
  readonly checkpoint?: DeviceSlotCheckpoint | undefined;
  readonly baseHeads: readonly string[];
  readonly digest?: string | undefined;
  readonly lastSyncedAt?: string | undefined;
  readonly pending?: PendingSlotRecord | undefined;
}
const namespace = (owner: string) => `drive-v3:${owner}`;
const invalid = () => new DriveError("remote-invalid", "Локальная привязка слотов повреждена.");
const sameScope = (a: DeviceSlotScope, b: DeviceSlotScope) =>
  a.workspaceId === b.workspaceId && a.legacyArchive === b.legacyArchive;
const initial = (mode: DriveSlotMode): DeviceSlotRecord => ({
  schemaVersion: 3,
  generation: 0,
  automatic: true,
  mode,
  baseHeads: []
});

function readScope(value: unknown): DeviceSlotScope {
  if (
    !isRecord(value) ||
    typeof value.workspaceId !== "string" ||
    !uuidPattern.test(value.workspaceId) ||
    value.workspaceId !== value.workspaceId.toLowerCase() ||
    !(
      value.legacyArchive === null ||
      (typeof value.legacyArchive === "string" && shaPattern.test(value.legacyArchive))
    )
  )
    throw invalid();
  return { workspaceId: value.workspaceId, legacyArchive: value.legacyArchive };
}

function readPending(value: unknown, scope: DeviceSlotScope | undefined): PendingSlotRecord {
  if (
    !scope ||
    !isRecord(value) ||
    typeof value.digest !== "string" ||
    !shaPattern.test(value.digest) ||
    !isRecord(value.write)
  )
    throw invalid();
  const { fileId, key, baseEtag } = value.write;
  const envelope = parseDeviceSlotEnvelope(value.write.envelope);
  if (
    typeof fileId !== "string" ||
    !/^[\w-]{1,200}$/.test(fileId) ||
    key !== deviceSlotKey(scope.workspaceId, envelope.current.deviceId) ||
    !sameScope(scope, envelope.current) ||
    !(baseEtag === null || typeof baseEtag === "string") ||
    (baseEtag === null) !== (envelope.previous === null)
  )
    throw invalid();
  return {
    digest: value.digest,
    write: {
      fileId,
      key,
      baseEtag: baseEtag === null ? null : strongDeviceSlotTag(baseEtag),
      envelope
    }
  };
}

function parse(value: unknown, fallback: DriveSlotMode): DeviceSlotRecord {
  if (value === undefined) return initial(fallback);
  if (!isRecord(value) || !isRecord(value.value)) throw invalid();
  const record = value.value;
  if (record.schemaVersion !== 3)
    throw new DriveError("unsupported-format", "Неизвестная локальная привязка Google Диска.");
  if (
    !Number.isSafeInteger(record.generation) ||
    Number(record.generation) < 0 ||
    typeof record.automatic !== "boolean" ||
    (record.enabled !== undefined && typeof record.enabled !== "boolean") ||
    (record.mode !== "normal" && record.mode !== "test") ||
    !Array.isArray(record.baseHeads) ||
    record.baseHeads.length > 256 ||
    record.baseHeads.some((id: unknown) => typeof id !== "string" || !uuidPattern.test(id)) ||
    new Set(record.baseHeads).size !== record.baseHeads.length ||
    (record.digest !== undefined &&
      (typeof record.digest !== "string" || !shaPattern.test(record.digest))) ||
    (record.lastSyncedAt !== undefined &&
      (typeof record.lastSyncedAt !== "string" ||
        !Number.isFinite(Date.parse(record.lastSyncedAt))))
  )
    throw invalid();
  const scope = record.scope === undefined ? undefined : readScope(record.scope);
  const checkpoint =
    record.checkpoint === undefined ? undefined : parseDeviceSlotCheckpoint(record.checkpoint);
  if (
    (checkpoint && (!scope || !sameScope(scope, checkpoint))) ||
    ((record.baseHeads.length || record.digest) && (!scope || !checkpoint))
  )
    throw invalid();
  return {
    schemaVersion: 3,
    generation: Number(record.generation),
    enabled: record.enabled,
    automatic: record.automatic,
    mode: record.mode,
    scope,
    checkpoint,
    baseHeads: record.baseHeads.map(String),
    digest: record.digest,
    lastSyncedAt: record.lastSyncedAt,
    pending: record.pending === undefined ? undefined : readPending(record.pending, scope)
  };
}

export async function loadDeviceSlotRecord(
  owner: string,
  fallback = defaultDriveSlotMode()
): Promise<DeviceSlotRecord> {
  return parse(await get("preferences", namespace(owner)), fallback);
}

/** Cross-tab checkpoint/journal update must use the record that was actually read. */
export async function saveDeviceSlotRecord(
  owner: string,
  prior: DeviceSlotRecord,
  patch: Partial<DeviceSlotRecord>,
  signal?: AbortSignal
): Promise<DeviceSlotRecord> {
  const id = namespace(owner);
  let result: DeviceSlotRecord | undefined;
  let failure: unknown;
  await transaction(
    ["preferences"],
    (tx) => {
      const store = tx.objectStore("preferences");
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          const current = parse(request.result, prior.mode);
          if (current.generation !== prior.generation)
            throw new DriveError("conflict", "Другой сеанс изменил привязку Google Диска.");
          result = parse(
            { value: { ...current, ...patch, generation: current.generation + 1 } },
            prior.mode
          );
          store.put({ id, owner, value: result });
        } catch (error) {
          failure = error instanceof Error ? error : invalid();
        }
      };
    },
    signal
  );
  if (failure instanceof Error) throw failure;
  if (!result) throw new DriveError("local-save", "Не удалось записать состояние Google Диска.");
  return result;
}

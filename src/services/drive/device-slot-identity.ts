import { isRecord } from "../../model/backup-format.js";
import { get, put, transaction } from "../storage-db.js";
import { uuidPattern } from "./backup.js";
import { DEVICE_SLOT_TEST_DEVICE_ID } from "./device-slot-model.js";
import { DriveError } from "./types.js";

export { DEVICE_SLOT_TEST_DEVICE_ID };
export type DriveSlotMode = "normal" | "test";

const DEVICE_KEY = "drive-device";

export function defaultDriveSlotMode(
  address: Pick<Location, "pathname" | "search"> | undefined = globalThis.location,
  devLoader = !!globalThis.document?.querySelector('script[type="module"][src="/__dev/client.js"]')
): DriveSlotMode {
  if (
    devLoader ||
    address?.pathname === "/__dev/app" ||
    address?.pathname.startsWith("/__dev/app/")
  )
    return "test";
  return new URLSearchParams(address?.search).get("sync-client") === "testing" ? "test" : "normal";
}

function modeKey(workspaceId: string): string {
  if (
    typeof workspaceId !== "string" ||
    !uuidPattern.test(workspaceId) ||
    workspaceId !== workspaceId.toLowerCase()
  )
    throw new DriveError("remote-invalid", "Invalid Drive workspace ID.");
  return `drive-slot-mode:${workspaceId}`;
}

function validateMode(value: unknown): DriveSlotMode {
  if (value === "normal" || value === "test") return value;
  throw new DriveError("remote-invalid", "Invalid Drive slot mode.");
}

export async function loadDriveSlotMode(
  workspaceId: string,
  fallback = defaultDriveSlotMode()
): Promise<DriveSlotMode> {
  const stored = await get("preferences", modeKey(workspaceId));
  return stored === undefined
    ? fallback
    : validateMode(isRecord(stored) ? stored.value : undefined);
}

export async function saveDriveSlotMode(workspaceId: string, mode: DriveSlotMode): Promise<void> {
  await put("preferences", { id: modeKey(workspaceId), value: validateMode(mode) });
}

/** Read or create the existing browser ID inside the caller's preferences write transaction. */
export function readOrCreateDriveDeviceId(
  store: IDBObjectStore,
  accept: (id: string) => void
): void {
  const device = store.get(DEVICE_KEY);
  device.onsuccess = () => {
    const value: unknown = device.result;
    const stored =
      isRecord(value) && typeof value.value === "string" && uuidPattern.test(value.value)
        ? value.value
        : undefined;
    const id = stored ?? crypto.randomUUID();
    if (!stored) store.put({ id: DEVICE_KEY, value: id });
    accept(id);
  };
}

export async function loadDriveDeviceId(
  workspaceId: string,
  mode?: DriveSlotMode
): Promise<string> {
  const selected = mode === undefined ? await loadDriveSlotMode(workspaceId) : validateMode(mode);
  if (mode !== undefined) modeKey(workspaceId);
  if (selected === "test") return DEVICE_SLOT_TEST_DEVICE_ID;

  let deviceId: string | undefined;
  await transaction(["preferences"], (tx) => {
    readOrCreateDriveDeviceId(tx.objectStore("preferences"), (id) => {
      deviceId = id;
    });
  });
  if (!deviceId) throw new DriveError("remote-invalid", "Drive device ID is missing.");
  // Protocol 3 keys use lowercase UUIDs. Keep the existing stored and v2 values byte-for-byte.
  const normalized = deviceId.toLowerCase();
  if (normalized === DEVICE_SLOT_TEST_DEVICE_ID)
    throw new DriveError("remote-invalid", "Drive device cannot claim the reserved test slot.");
  return normalized;
}

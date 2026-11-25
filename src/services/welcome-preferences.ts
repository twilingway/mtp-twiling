import { get, put } from "./storage-db.js";
import { isRecord } from "../model/backup-format.js";
const id = "device:welcome-v1";
export async function loadWelcomeHidden(): Promise<boolean> {
  const record = await get("preferences", id);
  return (
    isRecord(record) &&
    isRecord(record.value) &&
    record.value.schemaVersion === 1 &&
    record.value.hidden === true
  );
}
export function saveWelcomeHidden(hidden: boolean): Promise<void> {
  return put("preferences", { id, value: { schemaVersion: 1, hidden } });
}

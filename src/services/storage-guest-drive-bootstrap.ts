import { uuidPattern } from "./drive/backup.js";

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const own = Reflect.ownKeys(value);
  return (
    own.length === keys.length &&
    own.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key === "string" &&
        keys.includes(key) &&
        !!descriptor &&
        "value" in descriptor &&
        descriptor.enumerable
      );
    })
  );
}

/** Only the exact unlinked record created by .18 loadDriveRecord is an inert bootstrap. */
export function isInertPublicDriveBootstrap(record: unknown, device: unknown): boolean {
  if (
    !exactRecord(record, ["id", "owner", "value"]) ||
    record.id !== "drive-v2:public" ||
    record.owner !== "public" ||
    !exactRecord(device, ["id", "value"]) ||
    device.id !== "drive-device"
  )
    return false;
  const value = record.value;
  if (!exactRecord(value, ["schemaVersion", "markerId", "deviceId", "baseHeads", "automatic"]))
    return false;
  return (
    value.schemaVersion === 1 &&
    value.automatic === true &&
    typeof value.markerId === "string" &&
    uuidPattern.test(value.markerId) &&
    typeof value.deviceId === "string" &&
    uuidPattern.test(value.deviceId) &&
    device.value === value.deviceId &&
    Array.isArray(value.baseHeads) &&
    Object.getPrototypeOf(value.baseHeads) === Array.prototype &&
    value.baseHeads.length === 0 &&
    Reflect.ownKeys(value.baseHeads).length === 1
  );
}

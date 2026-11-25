import type { DriveDependencies, DriveRecord } from "./coordinator-types.js";
/** Binding restoration never opens OAuth and invalidates authorization returned to an old owner. */
export async function restoreDriveProfile(
  dependencies: DriveDependencies,
  owner: string,
  current: () => boolean,
  accept: (record: DriveRecord) => void
) {
  const record = await dependencies.load(owner);
  if (!current()) return null;
  accept(record);
  const authorization = await dependencies.auth.restore(owner);
  if (!current()) {
    authorization?.invalidate();
    return null;
  }
  return { authorization };
}

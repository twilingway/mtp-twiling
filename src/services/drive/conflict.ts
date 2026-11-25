import { DriveError } from "./types.js";
import type { Backup } from "../../model/types.js";
import type { DriveInspection } from "./types.js";
import { summarize } from "./coordinator-types.js";
import type { DriveDependencies } from "./coordinator-types.js";
/** Preview construction remains read-only and checks the owning epoch after every download. */
export async function prepareDriveConflict(
  remote: ReturnType<DriveDependencies["sync"]>,
  inspection: DriveInspection,
  backup: Backup,
  digest: string,
  revision: number,
  check: () => void
) {
  if (inspection.heads.length > 8)
    throw new DriveError("limit", "Слишком много конфликтующих снимков");
  const remotes = [];
  for (const nodeId of inspection.heads) {
    const incoming = await remote.download(nodeId);
    check();
    const date = inspection.snapshots.find((item) => item.manifest.nodeId === nodeId)?.manifest
      .createdAt;
    remotes.push({ ...summarize(incoming, date), nodeId });
  }
  check();
  return {
    preview: { heads: inspection.heads, digest, revision },
    conflict: { local: summarize(backup), remotes }
  };
}

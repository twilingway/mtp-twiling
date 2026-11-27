import type { YandexRemote } from "./revisions.js";

/** Slot claims supplement a pruned parent chain only when inspected metadata binds the exact claim. */
export function yandexAssociationPrecedes(
  heads: readonly string[],
  baseline: readonly string[],
  remotes: readonly YandexRemote[]
): boolean {
  if (heads.length !== 1 || baseline.length === 0) return false;
  const revisions = new Map(remotes.map((remote) => [remote.revision.revisionId, remote]));
  const visited = new Set<string>();
  const pending = [...heads];
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const remote = revisions.get(id);
    if (!remote) continue;
    pending.push(...remote.revision.parents);
    for (const claim of remote.slot?.accepted ?? []) {
      const accepted = revisions.get(claim.revisionId);
      if (
        accepted?.slot &&
        accepted.revision.deviceId === claim.deviceId &&
        accepted.slot.seq === claim.seq
      )
        pending.push(claim.revisionId);
    }
  }
  return baseline.every((id) => visited.has(id));
}

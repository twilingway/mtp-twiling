import type { CloudComparison, CloudRemoteDeletion, CloudSummary } from "../../model/cloud-sync.js";
import type { CloudPreparedSnapshot } from "../../screens/terminal/controller-cloud-host.js";
import type { YandexRemote } from "./revisions.js";
import { yandexRemotesFingerprint } from "./revisions.js";
import { visibleDeviceVersions } from "./bundle.js";

export interface YandexPreviewRemote {
  remote: YandexRemote;
  summary: CloudSummary;
  deletion?: CloudRemoteDeletion | undefined;
}
export function yandexVisibleChoices(inspected: {
  remotes: readonly YandexRemote[];
  heads: readonly string[];
}): YandexPreviewRemote[] {
  const all = inspected.remotes.map(({ revision }) => revision),
    visible = new Set(inspected.heads);
  const slots = inspected.remotes.filter((remote) => remote.slot);
  const known = new Set(all.map(({ revisionId }) => revisionId));
  if (slots.length || all.some(({ parents }) => parents.some((id) => !known.has(id)))) {
    const legacy = inspected.remotes.filter((remote) => !remote.slot);
    for (const remote of slots) visible.add(remote.revision.revisionId);
    // Legacy bodies remain recoverable even when an old writer returns after migration/pruning.
    for (const remote of legacy) visible.add(remote.revision.revisionId);
    return inspected.remotes
      .filter(({ revision }) => visible.has(revision.revisionId))
      .map((remote) => ({
        remote,
        summary: { ...remote.revision.summary, date: remote.revision.createdAt }
      }));
  }
  for (const deviceId of new Set(all.map(({ deviceId }) => deviceId)))
    for (const revision of visibleDeviceVersions(all, deviceId)) visible.add(revision.revisionId);
  return [...visible].map((id) => {
    const remote = inspected.remotes.find(({ revision }) => revision.revisionId === id)!;
    return { remote, summary: { ...remote.revision.summary, date: remote.revision.createdAt } };
  });
}
export const yandexRemoteFingerprint = (remotes: readonly YandexPreviewRemote[]): string =>
  JSON.stringify(
    [...remotes]
      .sort((a, b) => a.remote.file.name.localeCompare(b.remote.file.name))
      .map(({ remote: { file, revision } }) => [
        file.name,
        file.md5,
        file.size,
        file.modified,
        revision
      ])
  );

export class YandexPreview {
  revision: number | undefined;
  remoteFingerprint: string | undefined;
  manualFingerprint: string | undefined;
  heads: readonly string[] = [];
  clear(): void {
    this.revision = undefined;
    this.remoteFingerprint = undefined;
    this.manualFingerprint = undefined;
    this.heads = [];
  }
  capture(
    captured: CloudPreparedSnapshot,
    remotes: readonly YandexPreviewRemote[],
    heads: readonly string[],
    checkedAt: string
  ): CloudComparison {
    this.revision = captured.revision;
    this.remoteFingerprint = yandexRemoteFingerprint(remotes);
    this.manualFingerprint = yandexRemotesFingerprint(remotes.map(({ remote }) => remote));
    this.heads = [...heads];
    return {
      local: backupSummary(captured.backup),
      remotes: remotes.map(({ remote, summary, deletion }) => ({
        id: remote.revision.revisionId,
        deviceId: remote.revision.deviceId,
        ...(deletion ? { deletion } : {}),
        ...summary
      })),
      checkedAt
    };
  }
}
export const backupSummary = (backup: CloudPreparedSnapshot["backup"]): CloudSummary => ({
  instruments: backup.watchlist?.length ?? 0,
  drawings: backup.drawings.reduce((count, document) => count + document.items.length, 0),
  images: backup.images.length
});

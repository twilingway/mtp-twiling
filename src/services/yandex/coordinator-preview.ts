import type { CloudComparison, CloudSummary } from "../../model/cloud-sync.js";
import type { CloudPreparedSnapshot } from "../../screens/terminal/controller-cloud-host.js";
import type { YandexRemote } from "./revisions.js";
import { visibleDeviceVersions } from "./bundle.js";

export interface YandexPreviewRemote {
  remote: YandexRemote;
  summary: CloudSummary;
}
export function yandexVisibleChoices(inspected: {
  remotes: readonly YandexRemote[];
  heads: readonly string[];
}): YandexPreviewRemote[] {
  const all = inspected.remotes.map(({ revision }) => revision),
    visible = new Set(inspected.heads);
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
  heads: readonly string[] = [];
  clear(): void {
    this.revision = undefined;
    this.remoteFingerprint = undefined;
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
    this.heads = [...heads];
    return {
      local: backupSummary(captured.backup),
      remotes: remotes.map(({ remote, summary }) => ({
        id: remote.revision.revisionId,
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

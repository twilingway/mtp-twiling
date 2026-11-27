import type { CloudSelection, CloudSummary } from "../../model/cloud-sync.js";
import type { Backup } from "../../model/types.js";
import type {
  CloudOperationGuard,
  CloudPreparedSnapshot,
  CloudSyncHost
} from "../../screens/terminal/controller-cloud-host.js";
import type { YandexAssociation, YandexJournal } from "./journal.js";
import type { YandexRemote, YandexRevisions } from "./revisions.js";
import { YandexError } from "./types.js";
import { visibleDeviceVersions } from "./bundle.js";
import { applyYandexRemote, reconcileYandexApply } from "./apply-recovery.js";
import type { YandexApplyActions, YandexApplyContext } from "./apply-recovery.js";

export const sameHeads = (a: readonly string[], b: readonly string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
export const backupSummary = (backup: Backup, date?: string): CloudSummary => ({
  instruments: backup.watchlist?.length ?? 0,
  drawings: backup.drawings.reduce((count, document) => count + document.items.length, 0),
  images: backup.images.length,
  ...(date ? { date } : {})
});
interface TransferActions extends YandexApplyActions {
  preview(): { revision: number | undefined; heads: readonly string[] };
  publish(
    captured: CloudPreparedSnapshot,
    heads: readonly string[],
    explicit: boolean
  ): Promise<void>;
  accept(heads: readonly string[], digest: string, expectedRevision: number): Promise<void>;
  conflict(
    captured: CloudPreparedSnapshot,
    remotes: readonly { remote: YandexRemote; summary: CloudSummary }[],
    heads: readonly string[]
  ): void;
  unchanged(association: YandexAssociation): void;
  applying(): void;
}
export async function yandexTransfer(
  host: CloudSyncHost,
  revisions: YandexRevisions,
  journal: YandexJournal,
  clientId: string,
  accountId: string,
  guard: CloudOperationGuard,
  actions: TransferActions,
  selection?: CloudSelection
): Promise<void> {
  const valid = () => !guard.signal.aborted && guard.isCurrent(),
    scope = host.scope("yandex-disk");
  if (!valid()) return;
  if (scope.blocked || scope.associationConflict) throw new YandexError("local-changed");
  const captured = await host.capture("yandex-disk", guard),
    inspected = await revisions.inspect(valid);
  const remotes = new Map<string, { remote: YandexRemote; summary: CloudSummary }>();
  const all = inspected.remotes.map(({ revision }) => revision),
    visible = new Set(inspected.heads);
  for (const deviceId of new Set(all.map(({ deviceId }) => deviceId)))
    for (const revision of visibleDeviceVersions(all, deviceId)) visible.add(revision.revisionId);
  for (const id of visible) {
    const remote = inspected.remotes.find(({ revision }) => revision.revisionId === id)!;
    remotes.set(id, {
      remote,
      summary: { ...remote.revision.summary, date: remote.revision.createdAt }
    });
  }
  if (!valid() || host.scope("yandex-disk").revision !== captured.revision)
    throw new YandexError("local-changed");
  const association = await journal.association(clientId, accountId);
  const context: YandexApplyContext = {
    host,
    journal,
    clientId,
    accountId,
    generation: revisions.credentialGeneration,
    guard,
    captured,
    heads: inspected.heads,
    remotes: inspected.remotes,
    actions,
    decode: async (remote) => host.decode(await revisions.read(remote, valid), guard)
  };
  if (await reconcileYandexApply(context, selection?.kind === "local")) return;
  const apply = (selected: { remote: YandexRemote }) => applyYandexRemote(context, selected.remote);
  if (selection?.kind === "remote") {
    const selected = remotes.get(selection.id),
      preview = actions.preview();
    if (
      !selected ||
      preview.revision !== captured.revision ||
      !sameHeads(preview.heads, inspected.heads)
    )
      throw new YandexError("local-changed");
    await apply(selected);
    return;
  }
  if (selection?.kind === "local") {
    for (const id of inspected.heads) {
      const remote = inspected.remotes.find(({ revision }) => revision.revisionId === id)!;
      await host.decode(await revisions.read(remote, valid), guard);
    }
    await actions.publish(captured, inspected.heads, true);
    return;
  }
  if (association && sameHeads(association.heads, inspected.heads)) {
    if (captured.digest === association.digest) {
      actions.unchanged(association);
      return;
    }
    for (const id of inspected.heads) {
      const remote = inspected.remotes.find(({ revision }) => revision.revisionId === id)!;
      await host.decode(await revisions.read(remote, valid), guard);
    }
    await actions.publish(captured, inspected.heads, false);
    return;
  }
  if (association && captured.digest === association.digest && inspected.heads.length === 1) {
    const map = new Map(all.map((revision) => [revision.revisionId, revision])),
      ancestors = new Set<string>(),
      pending = [...inspected.heads];
    while (pending.length) {
      const id = pending.pop()!;
      if (ancestors.has(id)) continue;
      ancestors.add(id);
      pending.push(...(map.get(id)?.parents ?? []));
    }
    if (association.heads.every((id) => ancestors.has(id))) {
      await apply(remotes.get(inspected.heads[0]!)!);
      return;
    }
  }
  actions.conflict(captured, [...remotes.values()], inspected.heads);
}

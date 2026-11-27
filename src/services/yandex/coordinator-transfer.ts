import type { CloudSelection, CloudSummary } from "../../model/cloud-sync.js";
import type {
  CloudOperationGuard,
  CloudPreparedSnapshot,
  CloudSyncHost
} from "../../screens/terminal/controller-cloud-host.js";
import type { YandexAssociation, YandexJournal } from "./journal.js";
import type { YandexRemote, YandexRevisions } from "./revisions.js";
import { YandexError } from "./types.js";
import { applyYandexRemote, reconcileYandexApply } from "./apply-recovery.js";
import type { YandexApplyActions, YandexApplyContext } from "./apply-recovery.js";
import type { YandexPreviewRemote } from "./coordinator-preview.js";
import { yandexRemoteFingerprint, yandexVisibleChoices } from "./coordinator-preview.js";

export const sameHeads = (a: readonly string[], b: readonly string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
interface TransferActions extends YandexApplyActions {
  preview(): {
    revision: number | undefined;
    heads: readonly string[];
    remoteFingerprint: string | undefined;
  };
  publish(
    captured: CloudPreparedSnapshot,
    heads: readonly string[],
    explicit: boolean,
    beforeEffect: () => Promise<void>
  ): Promise<void>;
  accept(heads: readonly string[], digest: string, expectedRevision: number): Promise<void>;
  conflict(
    captured: CloudPreparedSnapshot,
    remotes: readonly { remote: YandexRemote; summary: CloudSummary }[],
    heads: readonly string[]
  ): void;
  inspected(
    captured: CloudPreparedSnapshot,
    remotes: readonly YandexPreviewRemote[],
    heads: readonly string[],
    review?: CloudSelection
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
  selection?: CloudSelection,
  inspectionOnly = false
): Promise<void> {
  const valid = () => !guard.signal.aborted && guard.isCurrent(),
    scope = host.scope("yandex-disk");
  if (!valid()) return;
  if (scope.blocked || scope.associationConflict) throw new YandexError("local-changed");
  const captured = await host.capture("yandex-disk", guard),
    inspected = await revisions.inspect(valid);
  const remotes = new Map(
      yandexVisibleChoices(inspected).map((item) => [item.remote.revision.revisionId, item])
    ),
    all = inspected.remotes.map(({ revision }) => revision);
  if (!valid() || host.scope("yandex-disk").revision !== captured.revision)
    throw new YandexError("local-changed");
  const selected = selection?.kind === "remote" ? remotes.get(selection.id) : undefined,
    preview = actions.preview(),
    fresh =
      preview.revision === captured.revision &&
      sameHeads(preview.heads, inspected.heads) &&
      preview.remoteFingerprint === yandexRemoteFingerprint([...remotes.values()]),
    freshRemote = !!selected && fresh;
  // Inspection and stale decisions stop before association reads or recovery mutations.
  if (inspectionOnly || (selection && (!fresh || (selection.kind === "remote" && !selected)))) {
    actions.inspected(captured, [...remotes.values()], inspected.heads, selection);
    return;
  }
  const assertFresh = async (): Promise<void> => {
    if (!valid() || host.scope("yandex-disk").revision !== captured.revision)
      throw new YandexError("local-changed");
    const latest = await revisions.inspect(valid),
      choices = yandexVisibleChoices(latest);
    if (!valid() || host.scope("yandex-disk").revision !== captured.revision)
      throw new YandexError("local-changed");
    if (
      !sameHeads(inspected.heads, latest.heads) ||
      yandexRemoteFingerprint([...remotes.values()]) !== yandexRemoteFingerprint(choices)
    ) {
      if (selection) actions.inspected(captured, choices, latest.heads, selection);
      else actions.conflict(captured, choices, latest.heads);
      throw new YandexError("local-changed");
    }
  };
  const association = await journal.association(clientId, accountId);
  if (!valid() || host.scope("yandex-disk").revision !== captured.revision)
    throw new YandexError("local-changed");
  const context: YandexApplyContext = {
    host,
    journal,
    clientId,
    accountId,
    generation: revisions.credentialGeneration,
    guard,
    captured,
    beforeEffect: assertFresh,
    heads: inspected.heads,
    remotes: inspected.remotes,
    actions,
    decode: async (remote) => {
      const backup = await host.decode(await revisions.read(remote, valid), guard);
      if (!valid() || host.scope("yandex-disk").revision !== captured.revision)
        throw new YandexError("local-changed");
      return backup;
    }
  };
  try {
    if (
      await reconcileYandexApply(
        context,
        selection?.kind === "local",
        freshRemote ? selected.remote.revision.revisionId : undefined
      )
    )
      return;
  } catch (error) {
    if (error instanceof YandexError && error.code === "indeterminate" && !selection)
      actions.conflict(captured, [...remotes.values()], inspected.heads);
    throw error;
  }
  const apply = (remote: YandexRemote) => applyYandexRemote(context, remote);
  if (selection?.kind === "remote") {
    if (!selected || !freshRemote) throw new YandexError("local-changed");
    await apply(selected.remote);
    return;
  }
  if (selection?.kind === "local") {
    for (const id of inspected.heads) {
      const remote = inspected.remotes.find(({ revision }) => revision.revisionId === id)!;
      await host.decode(await revisions.read(remote, valid), guard);
    }
    if (!valid() || host.scope("yandex-disk").revision !== captured.revision)
      throw new YandexError("local-changed");
    await assertFresh();
    await actions.publish(captured, inspected.heads, true, assertFresh);
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
    if (!valid() || host.scope("yandex-disk").revision !== captured.revision)
      throw new YandexError("local-changed");
    await assertFresh();
    await actions.publish(captured, inspected.heads, false, assertFresh);
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
      await apply(remotes.get(inspected.heads[0]!)!.remote);
      return;
    }
  }
  actions.conflict(captured, [...remotes.values()], inspected.heads);
}

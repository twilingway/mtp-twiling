import type { CloudDeleteTarget, CloudSyncStatus } from "../../model/cloud-sync.js";
import type { CloudSyncHost } from "../../screens/terminal/controller-cloud-host.js";
import type { YandexJournal, yandexWriterLock } from "./journal.js";
import type { YandexMaintenance } from "./maintenance-journal.js";
import { yandexMaintenanceTarget } from "./maintenance-journal.js";
import type { YandexAuthorization } from "./types.js";
import { yandexErrorCode, YandexError } from "./types.js";
import type { YandexTransport } from "./transport.js";
import type { YandexRemote } from "./revisions.js";
import { yandexIdentityOperation } from "./coordinator-identity.js";
import type { YandexPreview } from "./coordinator-preview.js";
import type { YandexStatusClear } from "./coordinator-status.js";
import { yandexFailureStatus } from "./coordinator-status.js";

interface DeleteOptions {
  host: CloudSyncHost;
  journal: YandexJournal;
  cache: Map<string, YandexRemote>;
  preview: YandexPreview;
  lock: typeof yandexWriterLock;
  transport: (authorization: YandexAuthorization) => YandexTransport;
  prepare(): Promise<void>;
  authorization(): YandexAuthorization | undefined;
  clientId(): string | undefined;
  status(): CloudSyncStatus;
  epoch(): number;
  current(): boolean;
  busy(): boolean;
  begin(operation: AbortController): void;
  finish(operation: AbortController): void;
  update(patch: Partial<CloudSyncStatus>, clear?: readonly YandexStatusClear[]): void;
  inspect(): Promise<void>;
}

/** Only a reviewed user action enters this path; ordinary sync never resumes deletion. */
export function yandexManualDeletion(options: DeleteOptions) {
  return async (id: string): Promise<void> => {
    await options.prepare();
    if (!options.current() || !options.status().enabled || options.busy()) return;
    const auth = options.authorization(),
      clientId = options.clientId();
    if (!auth || !clientId) {
      options.update(yandexFailureStatus(new YandexError("auth-required")), ["progress"]);
      return;
    }
    const previousPhase = options.status().phase;
    const operation = new AbortController(),
      epoch = options.epoch(),
      expectedRevision = options.host.scope("yandex-disk").revision;
    options.begin(operation);
    const { guard, scopedAuth, revisions, checkClientMode } = yandexIdentityOperation({
      host: options.host,
      auth,
      operation,
      current: () =>
        options.current() &&
        options.status().enabled &&
        options.epoch() === epoch &&
        options.authorization() === auth,
      transport: options.transport,
      journal: options.journal,
      clientId,
      cache: options.cache,
      clientMode: options.status().clientMode ?? "normal",
      automatic: false,
      refresh: (settings) => options.update({ ...settings })
    });
    const valid = () =>
      guard.isCurrent() &&
      !guard.signal.aborted &&
      options.host.scope("yandex-disk").revision === expectedRevision &&
      !options.host.scope("yandex-disk").blocked;
    const check = () => {
      guard.signal.throwIfAborted();
      if (!valid()) throw new YandexError("local-changed");
    };
    let complete = false;
    let target: CloudDeleteTarget | undefined;
    options.update(
      { phase: "syncing", deleteAction: { id, state: "running" }, progress: { stage: "inspect" } },
      ["error", "pauseReason", "choiceAction"]
    );
    try {
      auth.getAccessToken();
      await options.lock(scopedAuth, async () => {
        if (!(await checkClientMode())) throw new YandexError("local-changed");
        check();
        if (
          (await options.journal.pending(clientId, auth.accountId)) ||
          (await options.journal.applyIntent(clientId, auth.accountId))
        )
          throw new YandexError("indeterminate");
        let maintenance = await options.journal.maintenance(clientId, auth.accountId);
        if (maintenance) target = yandexMaintenanceTarget(maintenance.plan);
        const writerDeviceId = await options.journal.deviceId();
        check();
        if (maintenance) {
          if (maintenance.plan.remoteId !== id || maintenance.writerDeviceId !== writerDeviceId)
            throw new YandexError("indeterminate");
          if (maintenance.credentialGeneration !== auth.credentialGeneration) {
            if (!(await options.journal.matchesCurrentDevice(maintenance.writerDeviceId)))
              throw new YandexError("indeterminate");
            check();
            // This method is called only after a fresh destructive confirmation, under the writer lock.
            maintenance = await options.journal.rebindMaintenance(
              clientId,
              maintenance,
              auth.credentialGeneration,
              guard.signal
            );
            check();
          }
        } else {
          const selected = (options.status().comparison ?? options.status().conflict)?.remotes.find(
            (remote) => remote.id === id
          );
          if (options.preview.revision !== expectedRevision || !options.preview.manualFingerprint)
            throw new YandexError("local-changed");
          if (!selected?.deletion?.allowed) throw new YandexError("permission");
          const plan = await revisions.manualDeletePlan(
            id,
            options.preview.manualFingerprint,
            valid
          );
          target = yandexMaintenanceTarget(plan);
          check();
          maintenance = {
            version: 1,
            accountId: auth.accountId,
            credentialGeneration: auth.credentialGeneration,
            writerDeviceId,
            generation: plan.operationId,
            plan
          } satisfies YandexMaintenance;
          await options.journal.saveMaintenance(clientId, maintenance, guard.signal);
          check();
        }
        const pinned = maintenance;
        const beforeEffect = async () => {
          if (
            !(await checkClientMode()) ||
            !(await options.journal.matchesCurrentDevice(pinned.writerDeviceId)) ||
            !(await options.journal.matchesMaintenance(
              clientId,
              auth.accountId,
              pinned.generation,
              pinned.credentialGeneration,
              pinned.writerDeviceId
            ))
          )
            throw new YandexError("local-changed");
          check();
        };
        await beforeEffect();
        options.update({ progress: { stage: "verify" } });
        const result = await revisions.executeManualDelete(pinned.plan, valid, beforeEffect);
        await beforeEffect();
        await options.journal.clearMaintenance(
          clientId,
          auth.accountId,
          pinned.generation,
          guard.signal
        );
        check();
        options.cache.clear();
        options.preview.clear();
        options.update(
          {
            phase:
              options.status().conflict || previousPhase === "conflict" || result.heads.length > 1
                ? "conflict"
                : "idle",
            deleteAction: { id, state: "confirmed", ...(target ? { target } : {}) }
          },
          ["comparison", "error", "progress", "choiceAction"]
        );
        complete = true;
      });
    } catch (error) {
      // Auth invalidation can mask a 401 with AbortError during the executor's final guards.
      const failure =
        auth.signal.aborted && !operation.signal.aborted ? new YandexError("auth-required") : error;
      const code = yandexErrorCode(failure);
      if (
        guard.isCurrent() &&
        !operation.signal.aborted &&
        (code === "auth-required" || !guard.signal.aborted)
      ) {
        options.update(
          {
            ...yandexFailureStatus(failure),
            deleteAction: {
              id,
              state: code === "local-changed" ? "review" : "unconfirmed",
              ...(target ? { target } : {})
            }
          },
          ["progress"]
        );
      }
    } finally {
      options.finish(operation);
    }
    if (complete && options.current()) await options.inspect();
  };
}

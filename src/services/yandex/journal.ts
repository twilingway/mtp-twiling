import { object, hashPattern, sha256, uuidPattern, YandexError } from "./types.js";
import { yandexLocalStore } from "./local.js";
import type { YandexLocalStore } from "./local.js";
import type { YandexAuthorization, YandexReference } from "./types.js";
import { decodeBundle, MAX_BUNDLE_BYTES, revisionName } from "./bundle.js";
import type { YandexRevision } from "./bundle.js";
import type { CloudClientMode } from "../../model/cloud-sync.js";
import { CLOUD_TEST_CLIENT_ID, defaultCloudClientMode } from "../../model/cloud-client-identity.js";
import { readYandexMaintenance } from "./maintenance-journal.js";
import type { YandexMaintenance } from "./maintenance-journal.js";
import { readYandexAssociation } from "./association-codec.js";

export interface YandexAssociation {
  readonly version: 1;
  readonly accountId: string;
  readonly heads: readonly string[];
  readonly digest: string;
  readonly syncedAt: string;
}
export interface YandexPending {
  readonly version: 1;
  readonly accountId: string;
  readonly credentialGeneration: string;
  readonly name: string;
  readonly revision: YandexRevision;
  readonly body: Blob;
  readonly reference: YandexReference;
}
export interface YandexApplyIntent {
  readonly version: 1;
  readonly operationId: string;
  readonly accountId: string;
  readonly credentialGeneration: string;
  readonly targetId: string;
  readonly heads: readonly string[];
  readonly digest: string;
}
export interface YandexSettings {
  readonly enabled: boolean;
  readonly automatic: boolean;
  readonly clientMode?: CloudClientMode;
}
export class YandexJournal {
  constructor(private readonly backend: () => Promise<YandexLocalStore> = yandexLocalStore) {}
  private prefix(clientId: string, accountId: string): string {
    if (!/^[a-f\d]{32}$/i.test(clientId) || !/^\d{1,30}$/.test(accountId))
      throw new YandexError("auth-required");
    return `mtp:yandex:device:${clientId}:${accountId}:`;
  }
  async settings(): Promise<YandexSettings> {
    const value = object(await (await this.backend()).read("mtp:yandex:device:settings"));
    if (
      value?.clientMode !== undefined &&
      value.clientMode !== "normal" &&
      value.clientMode !== "test"
    )
      throw new YandexError("local-save");
    return {
      enabled: value?.enabled === true,
      automatic: value?.automatic === true,
      clientMode:
        value?.clientMode ??
        defaultCloudClientMode(
          globalThis.location,
          !!globalThis.document?.querySelector?.('script[type="module"][src="/__dev/client.js"]')
        )
    };
  }
  async saveSettings(settings: YandexSettings, signal: AbortSignal): Promise<void> {
    const clientMode = settings.clientMode ?? (await this.settings()).clientMode;
    if (clientMode !== "normal" && clientMode !== "test") throw new YandexError("local-save");
    await (
      await this.backend()
    ).write("mtp:yandex:device:settings", { ...settings, clientMode }, signal);
  }
  async deviceId(): Promise<string> {
    if ((await this.settings()).clientMode === "test") return CLOUD_TEST_CLIENT_ID;
    const value = await (
      await this.backend()
    ).readOrCreate(
      "mtp:yandex:device:device-id",
      () => crypto.randomUUID(),
      new AbortController().signal
    );
    if (typeof value !== "string" || !uuidPattern.test(value) || value === CLOUD_TEST_CLIENT_ID)
      throw new YandexError("local-save");
    return value;
  }
  async existingDeviceId(): Promise<string | undefined> {
    if ((await this.settings()).clientMode === "test") return CLOUD_TEST_CLIENT_ID;
    const value = await (await this.backend()).read("mtp:yandex:device:device-id");
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !uuidPattern.test(value) || value === CLOUD_TEST_CLIENT_ID)
      throw new YandexError("local-save");
    return value;
  }
  async matchesCurrentDevice(id: string): Promise<boolean> {
    const settings = await this.settings();
    if (!settings.enabled) return false;
    if (settings.clientMode === "test") return id === CLOUD_TEST_CLIENT_ID;
    const value = await (await this.backend()).read("mtp:yandex:device:device-id");
    return (
      typeof value === "string" &&
      uuidPattern.test(value) &&
      value !== CLOUD_TEST_CLIENT_ID &&
      value === id
    );
  }
  async association(clientId: string, accountId: string): Promise<YandexAssociation | undefined> {
    const value = await (
      await this.backend()
    ).read(this.prefix(clientId, accountId) + "association");
    return readYandexAssociation(value, accountId);
  }
  async snapshotAssociations(
    clientId: string
  ): Promise<ReadonlyMap<string, YandexAssociation> | undefined> {
    if (!/^[a-f\d]{32}$/i.test(clientId)) return undefined;
    const backend = await this.backend();
    if (!backend.readAssociations) return undefined;
    const result = new Map<string, YandexAssociation>();
    for (const { accountId, value } of await backend.readAssociations(clientId)) {
      const association = readYandexAssociation(value, accountId);
      if (association) result.set(accountId, association);
    }
    return result;
  }
  async accept(
    clientId: string,
    association: YandexAssociation,
    signal: AbortSignal
  ): Promise<void> {
    await (
      await this.backend()
    ).write(this.prefix(clientId, association.accountId) + "association", association, signal);
  }
  async pending(clientId: string, accountId: string): Promise<YandexPending | undefined> {
    const value = await (await this.backend()).read(this.prefix(clientId, accountId) + "pending"),
      v = object(value);
    if (value === undefined) return undefined;
    if (
      !v ||
      v.version !== 1 ||
      v.accountId !== accountId ||
      typeof v.credentialGeneration !== "string" ||
      typeof v.name !== "string" ||
      !(v.body instanceof Blob) ||
      v.body.size > MAX_BUNDLE_BYTES ||
      !object(v.reference)
    )
      throw new YandexError("local-save");
    const decoded = await decodeBundle(v.body),
      reference = object(v.reference)!;
    if (
      revisionName(decoded.revision) !== v.name ||
      reference.size !== v.body.size ||
      reference.sha256 !== (await sha256(v.body)) ||
      JSON.stringify(decoded.revision) !== JSON.stringify(v.revision)
    )
      throw new YandexError("local-save");
    return v as unknown as YandexPending;
  }
  async savePending(clientId: string, pending: YandexPending, signal: AbortSignal): Promise<void> {
    await (
      await this.backend()
    ).write(this.prefix(clientId, pending.accountId) + "pending", pending, signal);
  }
  async archivePending(
    clientId: string,
    pending: YandexPending,
    signal: AbortSignal
  ): Promise<void> {
    await (
      await this.backend()
    ).write(
      this.prefix(clientId, pending.accountId) + `unconfirmed:${pending.revision.revisionId}`,
      pending,
      signal
    );
  }
  async clearPending(
    clientId: string,
    accountId: string,
    signal: AbortSignal,
    expected?: YandexPending
  ): Promise<void> {
    await (
      await this.backend()
    ).remove(
      this.prefix(clientId, accountId) + "pending",
      signal,
      undefined,
      expected
        ? {
            accountId: expected.accountId,
            credentialGeneration: expected.credentialGeneration,
            revisionId: expected.revision.revisionId,
            sha256: expected.reference.sha256,
            size: expected.reference.size
          }
        : undefined
    );
  }
  async maintenance(clientId: string, accountId: string): Promise<YandexMaintenance | undefined> {
    return readYandexMaintenance(
      await (await this.backend()).read(this.prefix(clientId, accountId) + "maintenance"),
      accountId
    );
  }
  async saveMaintenance(
    clientId: string,
    value: YandexMaintenance,
    signal: AbortSignal
  ): Promise<void> {
    const checked = await readYandexMaintenance(value, value.accountId);
    signal.throwIfAborted();
    try {
      await (
        await this.backend()
      ).write(this.prefix(clientId, value.accountId) + "maintenance", checked, signal);
    } catch {
      signal.throwIfAborted();
      throw new YandexError("local-save");
    }
  }
  async clearMaintenance(
    clientId: string,
    accountId: string,
    generation: string,
    signal: AbortSignal
  ): Promise<void> {
    try {
      await (
        await this.backend()
      ).remove(this.prefix(clientId, accountId) + "maintenance", signal, generation);
    } catch {
      signal.throwIfAborted();
      throw new YandexError("local-save");
    }
  }
  async rebindMaintenance(
    clientId: string,
    prior: YandexMaintenance,
    credentialGeneration: string,
    signal: AbortSignal
  ): Promise<YandexMaintenance> {
    const current = await this.maintenance(clientId, prior.accountId);
    if (
      !current ||
      current.generation !== prior.generation ||
      current.credentialGeneration !== prior.credentialGeneration ||
      current.writerDeviceId !== prior.writerDeviceId
    )
      throw new YandexError("local-changed");
    const rebound: YandexMaintenance = {
      ...current,
      credentialGeneration,
      plan: { ...current.plan, credentialGeneration }
    };
    const checked = await readYandexMaintenance(rebound, current.accountId);
    if (!checked) throw new YandexError("local-save");
    signal.throwIfAborted();
    try {
      const backend = await this.backend(),
        auditKey = this.prefix(clientId, prior.accountId) + "maintenance-rebind";
      const previousAudit = object(await backend.read(auditKey));
      await backend.write(
        auditKey,
        {
          version: 1,
          operationId: current.generation,
          accountId: current.accountId,
          writerDeviceId: current.writerDeviceId,
          originalCredentialGeneration:
            previousAudit?.operationId === current.generation
              ? previousAudit.originalCredentialGeneration
              : current.credentialGeneration,
          previousCredentialGeneration: current.credentialGeneration,
          credentialGeneration,
          reboundAt: new Date().toISOString()
        },
        signal
      );
      await backend.write(this.prefix(clientId, prior.accountId) + "maintenance", checked, signal);
    } catch {
      signal.throwIfAborted();
      throw new YandexError("local-save");
    }
    return checked;
  }
  async matchesMaintenance(
    clientId: string,
    accountId: string,
    generation: string,
    credentialGeneration: string,
    writerDeviceId: string
  ): Promise<boolean> {
    const value = object(
      await (await this.backend()).read(this.prefix(clientId, accountId) + "maintenance")
    );
    return (
      value?.accountId === accountId &&
      value.generation === generation &&
      value.credentialGeneration === credentialGeneration &&
      value.writerDeviceId === writerDeviceId &&
      object(value.plan)?.operationId === generation
    );
  }
  async applyIntent(clientId: string, accountId: string): Promise<YandexApplyIntent | undefined> {
    const value = await (
        await this.backend()
      ).read(this.prefix(clientId, accountId) + "apply-intent"),
      v = object(value);
    if (value === undefined) return undefined;
    if (
      !v ||
      v.version !== 1 ||
      v.accountId !== accountId ||
      typeof v.credentialGeneration !== "string" ||
      typeof v.operationId !== "string" ||
      !uuidPattern.test(v.operationId) ||
      typeof v.targetId !== "string" ||
      !uuidPattern.test(v.targetId) ||
      typeof v.digest !== "string" ||
      !hashPattern.test(v.digest) ||
      !Array.isArray(v.heads) ||
      v.heads.length > 1000 ||
      !v.heads.every((head: unknown) => typeof head === "string" && uuidPattern.test(head))
    )
      throw new YandexError("local-save");
    return v as unknown as YandexApplyIntent;
  }
  async saveApplyIntent(
    clientId: string,
    intent: YandexApplyIntent,
    signal: AbortSignal
  ): Promise<void> {
    await (
      await this.backend()
    ).write(this.prefix(clientId, intent.accountId) + "apply-intent", intent, signal);
  }
  async archiveApplyIntent(
    clientId: string,
    intent: YandexApplyIntent,
    signal: AbortSignal
  ): Promise<void> {
    await (
      await this.backend()
    ).write(
      this.prefix(clientId, intent.accountId) + `unconfirmed-apply:${intent.operationId}`,
      intent,
      signal
    );
  }
  async clearApplyIntent(clientId: string, accountId: string, signal: AbortSignal): Promise<void> {
    await (await this.backend()).remove(this.prefix(clientId, accountId) + "apply-intent", signal);
  }
}
/** Cross-tab serialization is required; no local-only mutex claims server CAS. */
export async function yandexWriterLock<T>(
  auth: YandexAuthorization,
  run: () => Promise<T>
): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) throw new YandexError("not-ready");
  return navigator.locks.request("mtp:yandex:device:writer", { signal: auth.signal }, run);
}

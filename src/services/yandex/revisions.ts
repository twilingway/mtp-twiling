import {
  decodeBundle,
  encodeBundle,
  MAX_BUNDLE_BYTES,
  revisionHeaderSize,
  decodeRevisionHeader,
  revisionName
} from "./bundle.js";
import type { YandexRevision } from "./bundle.js";
import { assertCurrent, sha256, YandexError } from "./types.js";
import type { YandexAuthorization, YandexFile, YandexPreparedBackup } from "./types.js";
import type { YandexJournal, YandexPending } from "./journal.js";
import type { YandexTransport } from "./transport.js";
import { YandexSlotStore, slotFingerprint, slotRemotes } from "./slot-store.js";
import type { SlotRemoteMetadata } from "./slot-store.js";
import { isSlotName, isStageName } from "./slot-model.js";
import { ensureYandexRetentionProof } from "./slot-proof.js";
import { publishYandexSlot } from "./slot-publish.js";
import { legacyYandexHeads } from "./slot-legacy.js";
import type { CloudRetentionStatus } from "../../model/cloud-sync.js";
import { retainYandexSlots } from "./slot-retention.js";
import { yandexErrorCode } from "./types.js";

export interface YandexRemote {
  readonly file: YandexFile;
  readonly revision: YandexRevision;
  readonly slot?: SlotRemoteMetadata;
}
const fingerprint = (files: readonly YandexFile[]) =>
  JSON.stringify(files.map(({ name, md5, size, modified }) => [name, md5, size, modified]).sort());
export class YandexRevisions {
  retention: CloudRetentionStatus | undefined;
  get credentialGeneration(): string {
    return this.auth.credentialGeneration;
  }
  private readonly bodies = new Map<string, YandexPreparedBackup>();
  private downloadedBytes = 0;
  private headerBytes = 0;
  private readonly slots: YandexSlotStore;
  private legacyHeads: readonly string[] = [];
  constructor(
    private readonly transport: YandexTransport,
    private readonly journal: YandexJournal,
    private readonly auth: YandexAuthorization,
    private readonly clientId: string,
    private readonly cache = new Map<string, YandexRemote>()
  ) {
    this.slots = new YandexSlotStore(transport, auth.signal);
  }
  async inspect(valid: () => boolean): Promise<{ remotes: YandexRemote[]; heads: string[] }> {
    const files = (await this.transport.list()).filter((item) => !item.name.startsWith("probe_"));
    const remotes: YandexRemote[] = [];
    for (const item of files.filter((file) => !isSlotName(file.name) && !isStageName(file.name))) {
      assertCurrent(this.auth.signal, valid);
      const key = fingerprint([item]);
      const cached = this.cache.get(key);
      if (cached) {
        remotes.push(cached);
        continue;
      }
      const headerSize = await revisionHeaderSize(await this.transport.readPrefix(item, 12));
      this.headerBytes += headerSize;
      if (this.headerBytes > 32 * 1024 * 1024) throw new YandexError("limit");
      const { revision } = await decodeRevisionHeader(
        await this.transport.readPrefix(item, headerSize),
        item.size
      );
      assertCurrent(this.auth.signal, valid);
      if (revisionName(revision) !== item.name) throw new YandexError("remote-invalid");
      const remote = { file: item, revision };
      this.cache.set(key, remote);
      remotes.push(remote);
    }
    const slots = await this.slots.inspect(files, valid);
    if (
      fingerprint(files) !==
      fingerprint((await this.transport.list()).filter((item) => !item.name.startsWith("probe_")))
    )
      throw new YandexError("conflict");
    assertCurrent(this.auth.signal, valid);
    const ordinarySlots = slotRemotes(slots),
      legacy = legacyYandexHeads(
        remotes.map(({ revision }) => revision),
        ordinarySlots.map(({ revision }) => revision)
      );
    this.legacyHeads = legacy.heads;
    const covered = new Set(slots.latest.flatMap(({ envelope }) => envelope.current.legacyHeads));
    return {
      remotes: [...remotes, ...ordinarySlots],
      heads: [
        ...slots.heads.filter((id) => !legacy.accepted.has(id)),
        ...this.legacyHeads.filter((id) => !covered.has(id))
      ].sort()
    };
  }
  async read(remote: YandexRemote, valid: () => boolean): Promise<YandexPreparedBackup> {
    if (remote.slot) {
      const decoded = await this.slots.body(remote.file, valid),
        version = [decoded.envelope.current, decoded.envelope.previous].find(
          (item) => item?.revision.revisionId === remote.revision.revisionId
        );
      if (!version || JSON.stringify(version.revision) !== JSON.stringify(remote.revision))
        throw new YandexError("conflict");
      return decoded.prepared.get(remote.revision.revisionId)!;
    }
    const cached = this.bodies.get(fingerprint([remote.file]));
    if (cached) {
      assertCurrent(this.auth.signal, valid);
      return cached;
    }
    const decoded = await this.download(remote.file);
    assertCurrent(this.auth.signal, valid);
    if (JSON.stringify(decoded.revision) !== JSON.stringify(remote.revision))
      throw new YandexError("conflict");
    this.bodies.set(fingerprint([remote.file]), decoded.prepared);
    return decoded.prepared;
  }
  async retryPrune(valid: () => boolean): Promise<void> {
    try {
      const deviceId = await this.journal.deviceId(),
        files = await this.transport.list();
      await this.slots.inspect(files, valid);
      this.retention = await retainYandexSlots(
        this.slots,
        this.transport,
        deviceId,
        this.auth.signal,
        valid,
        () => ensureYandexRetentionProof(this.transport, this.auth, valid)
      );
    } catch (error) {
      assertCurrent(this.auth.signal, valid);
      this.retention = { phase: "pending", error: yandexErrorCode(error) };
    }
  }
  private async download(file: YandexFile) {
    this.downloadedBytes += file.size;
    if (this.downloadedBytes > MAX_BUNDLE_BYTES * 2) throw new YandexError("limit");
    return decodeBundle(await this.transport.read(file, MAX_BUNDLE_BYTES));
  }
  /** Confirm only this live identity's exact committed CURRENT bundle, never a historical copy. */
  async verifiedPending(pending: YandexPending, valid: () => boolean): Promise<boolean> {
    assertCurrent(this.auth.signal, valid);
    if (
      pending.accountId !== this.auth.accountId ||
      pending.credentialGeneration !== this.auth.credentialGeneration ||
      !(await this.journal.matchesCurrentDevice(pending.revision.deviceId))
    )
      return false;
    assertCurrent(this.auth.signal, valid);
    const snapshot = this.slots.snapshot;
    if (
      !snapshot ||
      snapshot.uncertain.length ||
      snapshot.heads.length !== 1 ||
      snapshot.heads[0] !== pending.revision.revisionId
    )
      return false;
    const physical = snapshot.latest.find(
      ({ envelope }) => envelope.current.revision.revisionId === pending.revision.revisionId
    );
    if (!physical) return false;
    const decoded = await this.slots.body(physical.file, valid);
    assertCurrent(this.auth.signal, valid);
    return (
      JSON.stringify(decoded.envelope.current.revision) === JSON.stringify(pending.revision) &&
      decoded.current.size === pending.reference.size &&
      pending.body.size === pending.reference.size &&
      (await sha256(decoded.current)) === pending.reference.sha256 &&
      (await sha256(pending.body)) === pending.reference.sha256
    );
  }
  async publish(
    prepared: YandexPreparedBackup,
    digest: string,
    parents: readonly string[],
    valid: () => boolean,
    rebindConfirmed = false,
    beforeEffect?: () => Promise<void>
  ): Promise<YandexRevision> {
    let pending = await this.journal.pending(this.clientId, this.auth.accountId);
    assertCurrent(this.auth.signal, valid);
    const deviceId = await this.journal.deviceId();
    assertCurrent(this.auth.signal, valid);
    if (pending && pending.revision.deviceId !== deviceId) throw new YandexError("indeterminate");
    if (pending && pending.credentialGeneration !== this.auth.credentialGeneration) {
      if (!rebindConfirmed) throw new YandexError("indeterminate");
      await this.journal.archivePending(this.clientId, pending, this.auth.signal);
      assertCurrent(this.auth.signal, valid);
      pending = undefined;
    }
    if (pending && pending.revision.digest !== digest && !rebindConfirmed)
      throw new YandexError("indeterminate");
    if (pending && pending.revision.digest !== digest) {
      await this.journal.archivePending(this.clientId, pending, this.auth.signal);
      assertCurrent(this.auth.signal, valid);
      pending = undefined;
    }
    if (
      pending &&
      JSON.stringify([...pending.revision.parents].sort()) !== JSON.stringify([...parents].sort())
    ) {
      const snapshot = await this.inspect(valid),
        pendingId = pending.revision.revisionId;
      if (!snapshot.remotes.some(({ revision }) => revision.revisionId === pendingId)) {
        if (!rebindConfirmed) throw new YandexError("indeterminate");
        await this.journal.archivePending(this.clientId, pending, this.auth.signal);
        assertCurrent(this.auth.signal, valid);
        pending = undefined;
      }
    }
    if (!pending) {
      const bundle = await encodeBundle(prepared, {
        revisionId: crypto.randomUUID(),
        deviceId,
        parents,
        digest,
        createdAt: new Date().toISOString()
      });
      assertCurrent(this.auth.signal, valid);
      pending = {
        version: 1,
        accountId: this.auth.accountId,
        credentialGeneration: this.auth.credentialGeneration,
        name: revisionName(bundle.revision),
        ...bundle
      };
      await this.journal.savePending(this.clientId, pending, this.auth.signal);
    }
    assertCurrent(this.auth.signal, valid);
    await ensureYandexRetentionProof(this.transport, this.auth, valid);
    await beforeEffect?.();
    const current = await this.inspect(valid),
      already = current.remotes.some(
        ({ revision }) => revision.revisionId === pending.revision.revisionId
      );
    if (
      !already &&
      JSON.stringify([...pending.revision.parents].sort()) !==
        JSON.stringify([...current.heads].sort())
    )
      throw new YandexError("local-changed");
    assertCurrent(this.auth.signal, valid);
    // Freeze accepted claims at the same inspection that checked the caller's parent set.
    const plan = this.slots.snapshot!,
      legacyHeads = [...this.legacyHeads],
      pinnedFiles = slotFingerprint(current.remotes.map(({ file }) => file)),
      pinnedHeads = JSON.stringify([...current.heads].sort()),
      checkPlan = async (): Promise<void> => {
        await beforeEffect?.();
        const latest = await this.inspect(valid);
        if (
          JSON.stringify([...latest.heads].sort()) !== pinnedHeads ||
          slotFingerprint(latest.remotes.map(({ file }) => file)) !== pinnedFiles
        )
          throw new YandexError("local-changed");
      };
    return publishYandexSlot(
      this.slots,
      pending,
      plan,
      this.auth,
      legacyHeads,
      rebindConfirmed,
      valid,
      checkPlan,
      (status) => {
        this.retention = status;
      }
    );
  }
}

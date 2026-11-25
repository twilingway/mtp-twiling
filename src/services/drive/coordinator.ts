import { driveBackupDigest, sanitizeDriveBackup } from "./backup.js";
import { DriveError, type DriveAuthorization, type DriveInspection } from "./types.js";
import type { Backup } from "../../model/types.js";
import { prepareDriveConflict } from "./conflict.js";
import { driveAvailable, driveFailure, prepareDriveIdentity } from "./coordinator-status.js";
import { LegacyDriveMigration } from "./legacy.js";
import { acceptDriveRecord } from "./accept.js";
import { restoreDriveProfile } from "./restore.js";
import { applyDriveBackup } from "./apply.js";
import type {
  DriveBridge,
  DriveDependencies,
  DriveRecord,
  DriveStatus
} from "./coordinator-types.js";
const same = (left: string[], right: string[]) =>
  [...left].sort().join() === [...right].sort().join();
const cancelled = () => new DOMException("Синхронизация прервана", "AbortError");
export class DriveCoordinator {
  readonly legacy: LegacyDriveMigration;
  private status: DriveStatus = {
    phase: "disconnected",
    prepared: false,
    preparing: false,
    connected: false,
    automatic: true,
    pendingChanges: false,
    authorizationStored: false,
    credentialSaveError: false
  };
  private readonly listeners = new Set<() => void>();
  private owner = "";
  private session: unknown;
  private authenticated = false;
  private restoredEpoch: number | undefined;
  private resumeDue = false;
  private epoch = 0;
  private revision = 0;
  private authorization: DriveAuthorization | undefined;
  private remote: ReturnType<DriveDependencies["sync"]> | undefined;
  private record: DriveRecord | undefined;
  private busy = false;
  private applyingEpoch: number | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private preview: { heads: string[]; digest: string; revision: number } | undefined;
  constructor(
    private readonly bridge: DriveBridge,
    private readonly dependencies: DriveDependencies
  ) {
    this.legacy = new LegacyDriveMigration(bridge, {
      capture: () =>
        this.authorization && this.remote && this.current(this.epoch)
          ? {
              epoch: this.epoch,
              revision: this.revision,
              authorization: this.authorization,
              remote: this.remote
            }
          : undefined,
      valid: (context) => this.current(context.epoch) && context.revision === this.revision,
      reader: (authorization) => dependencies.legacySync?.(authorization),
      busy: () => this.busy,
      setBusy: (value) => {
        this.busy = value;
        this.update({
          phase: value ? "syncing" : this.status.legacyAvailable ? "conflict" : "idle"
        });
      },
      applying: (context) => {
        this.applyingEpoch = context?.epoch;
      },
      update: (patch) => this.update(patch),
      dirty: () => this.localChanged()
    });
  }
  getSnapshot = (): DriveStatus => this.status;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<DriveStatus>): void {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  profileChanged(): void {
    const profile = this.bridge.profile();
    const changed = profile.owner !== this.owner || profile.session !== this.session;
    if (!changed && profile.authenticated === this.authenticated) {
      if (this.resumeDue && !profile.blocked) {
        this.resumeDue = false;
        void this.sync();
      }
      return;
    }
    if (!profile.authenticated && this.authenticated) this.disconnect();
    else this.suspend();
    this.owner = profile.owner;
    this.session = profile.session;
    this.authenticated = profile.authenticated;
    this.record = undefined;
    this.status = {
      phase: "disconnected",
      prepared: this.status.prepared,
      preparing: false,
      connected: false,
      automatic: true,
      pendingChanges: false,
      authorizationStored: false,
      credentialSaveError: false
    };
    this.listeners.forEach((listener) => listener());
    if (profile.authenticated) void this.restoreProfile(this.epoch);
  }
  private profileCurrent(epoch: number): boolean {
    const profile = this.bridge.profile();
    return (
      epoch === this.epoch &&
      profile.authenticated &&
      profile.owner === this.owner &&
      profile.session === this.session
    );
  }
  private async restoreProfile(epoch: number): Promise<void> {
    if (this.restoredEpoch === epoch) return;
    this.restoredEpoch = epoch;
    try {
      const restored = await restoreDriveProfile(
        this.dependencies,
        this.owner,
        () => this.profileCurrent(epoch),
        (record) => {
          this.record = record;
          this.update({
            automatic: record.automatic,
            pendingChanges: this.status.pendingChanges || record.pendingChanges === true,
            lastSyncedAt: record.lastSyncedAt
          });
        }
      );
      if (!restored) return;
      const { authorization } = restored;
      if (authorization) await this.attach(authorization, epoch, true);
      else this.update({ pauseReason: "auth-required" });
    } catch {
      /* A failed local restore never starts OAuth or blocks an explicit connection. */
    }
  }
  resume(): void {
    this.profileChanged();
    if (this.bridge.profile().authenticated && !this.authorization)
      void this.restoreProfile(this.epoch);
  }
  localChanged(): void {
    if (this.applyingEpoch !== this.epoch) {
      this.revision++;
      this.update({ pendingChanges: true });
      if (this.record) {
        this.record = { ...this.record, pendingChanges: true };
        void this.dependencies.save(this.owner, this.record).catch(() => {});
      }
      this.schedule();
    }
  }
  localIntent(): void {
    if (this.applyingEpoch !== this.epoch) this.revision++;
  }
  private schedule(): void {
    clearTimeout(this.debounce);
    if (!this.status.connected || !this.status.automatic || this.preview) return;
    this.debounce = setTimeout(() => {
      void this.sync();
    }, 1500);
  }
  prepare(): Promise<void> {
    return prepareDriveIdentity(this.dependencies.auth, this.status, (patch) => this.update(patch));
  }
  /** The GIS call occurs synchronously, before the first await in the click path. */
  async connect(): Promise<void> {
    const profile = this.bridge.profile();
    if (
      !profile.authenticated ||
      !this.status.prepared ||
      this.busy ||
      this.status.phase === "connecting"
    )
      return;
    this.owner = profile.owner;
    this.session = profile.session;
    const epoch = ++this.epoch,
      pending = this.dependencies.auth.connectFromUserGesture(profile.owner);
    this.update({ phase: "connecting", error: undefined, conflict: undefined });
    try {
      const authorization = await pending;
      if (!this.profileCurrent(epoch)) {
        authorization.invalidate();
        return;
      }
      await this.attach(authorization, epoch, false);
    } catch (error) {
      if (epoch === this.epoch) this.fail(error);
    }
  }
  private async attach(
    authorization: DriveAuthorization,
    epoch: number,
    restored: boolean
  ): Promise<void> {
    this.authorization = authorization;
    authorization.signal.addEventListener(
      "abort",
      () => {
        if (epoch !== this.epoch) return;
        this.remote = undefined;
        this.authorization = undefined;
        this.preview = undefined;
        clearTimeout(this.debounce);
        this.update({
          phase: "auth-required",
          connected: false,
          conflict: undefined,
          pauseReason: "auth-required",
          error: "auth-required",
          authorizationStored: false,
          credentialSaveError: false
        });
      },
      { once: true }
    );
    const record = this.record ?? (await this.dependencies.load(this.owner));
    if (!this.current(epoch)) return;
    this.record = record;
    this.remote = this.dependencies.sync(authorization);
    this.update({
      phase: "idle",
      connected: true,
      automatic: record.automatic,
      pendingChanges: this.status.pendingChanges || record.pendingChanges === true,
      authorizationStored: authorization.stored === true,
      credentialSaveError: authorization.persistenceError === true,
      pauseReason: undefined,
      ...(record.lastSyncedAt ? { lastSyncedAt: record.lastSyncedAt } : {})
    });
    this.resumeDue = record.automatic && this.bridge.profile().blocked;
    if (!restored || record.automatic) await this.sync();
  }
  suspend = (): void => {
    this.legacy.reset();
    this.epoch++;
    clearTimeout(this.debounce);
    this.authorization = undefined;
    this.remote = undefined;
    this.preview = undefined;
    this.busy = false;
    this.applyingEpoch = undefined;
    this.resumeDue = false;
    this.dependencies.auth.suspend();
    this.update({
      phase: "disconnected",
      connected: false,
      conflict: undefined,
      error: undefined,
      authorizationStored: false,
      credentialSaveError: false,
      pauseReason: undefined,
      legacyAvailable: false
    });
  };
  disconnect = (): void => {
    this.suspend();
    const epoch = this.epoch;
    void this.dependencies.auth.disconnect().catch(() => {
      if (epoch === this.epoch) this.update({ credentialSaveError: true });
    });
  };
  private current(epoch: number): boolean {
    return this.profileCurrent(epoch) && !!this.authorization && !this.authorization.signal.aborted;
  }
  private check(epoch: number, revision?: number): void {
    if (!this.current(epoch) || (revision !== undefined && revision !== this.revision))
      throw cancelled();
  }
  private fail(error: unknown): void {
    driveFailure(this.status, error, this.update.bind(this), this.schedule.bind(this));
  }
  async setAutomatic(automatic: boolean): Promise<void> {
    this.update({ automatic });
    if (this.record) {
      this.record = { ...this.record, automatic };
      await this.dependencies.save(this.owner, this.record);
    }
    if (automatic) this.schedule();
    else clearTimeout(this.debounce);
  }
  private available(): boolean {
    return driveAvailable(this.authorization, this.dependencies, (patch) => this.update(patch));
  }
  async sync(): Promise<void> {
    if (
      this.busy ||
      this.status.legacyAvailable ||
      !this.remote ||
      !this.record ||
      !this.status.connected ||
      this.bridge.profile().blocked ||
      !this.available()
    )
      return;
    clearTimeout(this.debounce);
    const epoch = this.epoch,
      remote = this.remote,
      revision = this.revision;
    this.busy = true;
    this.preview = undefined;
    this.update({
      phase: "syncing",
      error: undefined,
      conflict: undefined,
      pauseReason: undefined
    });
    try {
      const backup = sanitizeDriveBackup(await this.bridge.exportBackup());
      this.check(epoch, revision);
      const digest = await driveBackupDigest(backup),
        inspection = await remote.inspect();
      this.check(epoch, revision);
      if (await this.legacy.detect(inspection)) return;
      if (
        inspection.conflict ||
        (inspection.heads.length &&
          !same(inspection.heads, this.record.baseHeads) &&
          digest !== this.record.lastSyncedDigest)
      ) {
        await this.conflict(inspection, backup, digest, epoch, revision);
        return;
      }
      if (!same(inspection.heads, this.record.baseHeads) && inspection.heads[0]) {
        const incoming = await remote.download(inspection.heads[0]);
        this.check(epoch, revision);
        const latest = await remote.inspect();
        this.check(epoch, revision);
        if (!same(latest.heads, inspection.heads)) {
          await this.conflict(latest, backup, digest, epoch, revision);
          return;
        }
        await this.apply(incoming, inspection.heads, epoch, revision);
        return;
      }
      if (!inspection.heads.length || digest !== this.record.lastSyncedDigest) {
        const result = await remote.publish(backup, {
          deviceId: this.record.deviceId,
          parents: inspection.heads
        });
        this.check(epoch);
        if (result.inspection.conflict) {
          await this.conflict(result.inspection, backup, digest, epoch, revision);
          return;
        }
        await this.accept([result.nodeId], digest, epoch, revision);
      } else await this.accept(inspection.heads, digest, epoch, revision);
    } catch (error) {
      if (this.current(epoch)) {
        if (error instanceof DriveError && error.code === "conflict") {
          this.update({ phase: "idle" });
          this.schedule();
        } else this.fail(error);
      }
    } finally {
      if (epoch === this.epoch) {
        this.busy = false;
        if (revision !== this.revision) this.schedule();
      }
    }
  }
  private async conflict(
    inspection: DriveInspection,
    backup: Backup,
    digest: string,
    epoch: number,
    revision: number
  ): Promise<void> {
    const next = await prepareDriveConflict(
      this.remote!,
      inspection,
      backup,
      digest,
      revision,
      () => this.check(epoch, revision)
    );
    this.preview = next.preview;
    this.update({ phase: "conflict", conflict: next.conflict });
  }
  async choose(nodeId: string): Promise<void> {
    const preview = this.preview,
      remote = this.remote,
      record = this.record;
    if (
      !preview ||
      !remote ||
      !record ||
      this.busy ||
      this.bridge.profile().blocked ||
      !this.available()
    )
      return;
    const epoch = this.epoch,
      revision = this.revision;
    this.busy = true;
    this.update({ phase: "syncing", error: undefined });
    try {
      const local = sanitizeDriveBackup(await this.bridge.exportBackup()),
        digest = await driveBackupDigest(local);
      this.check(epoch, revision);
      const inspection = await remote.inspect();
      this.check(epoch, revision);
      if (
        digest !== preview.digest ||
        revision !== preview.revision ||
        !same(inspection.heads, preview.heads)
      ) {
        await this.conflict(inspection, local, digest, epoch, revision);
        return;
      }
      if (nodeId !== "local" && !preview.heads.includes(nodeId)) return;
      const backup = nodeId === "local" ? local : await remote.download(nodeId);
      this.check(epoch, revision);
      let heads = inspection.heads;
      if (nodeId === "local" || heads.length > 1) {
        const result = await (heads.length > 1
          ? remote.resolve(backup, { deviceId: record.deviceId, parents: heads })
          : remote.publish(backup, { deviceId: record.deviceId, parents: heads }));
        this.check(epoch, revision);
        // The chosen backup belongs to our node. A newer descendant may already be the
        // inspected head; acknowledging it here would silently skip its unseen payload.
        heads = [result.nodeId];
        if (result.inspection.conflict) {
          await this.conflict(result.inspection, local, digest, epoch, revision);
          return;
        }
      } else {
        const latest = await remote.inspect();
        this.check(epoch, revision);
        if (!same(latest.heads, heads)) {
          await this.conflict(latest, local, digest, epoch, revision);
          return;
        }
      }
      if (nodeId === "local") await this.accept(heads, digest, epoch, revision);
      else await this.apply(backup, heads, epoch, revision);
    } catch (error) {
      if (this.current(epoch)) {
        this.preview = undefined;
        this.update({ conflict: undefined });
        this.fail(error);
      }
    } finally {
      if (epoch === this.epoch) {
        this.busy = false;
        if (revision !== this.revision) this.schedule();
      }
    }
  }
  private async apply(
    backup: Backup,
    heads: string[],
    epoch: number,
    revision: number
  ): Promise<void> {
    const signal = this.authorization?.signal;
    if (!signal) throw cancelled();
    const digest = await applyDriveBackup(backup, this.bridge, signal, {
      check: () => this.check(epoch, revision),
      current: () => this.current(epoch) && revision === this.revision,
      applying: (active) => {
        if (active) this.applyingEpoch = epoch;
        else if (this.applyingEpoch === epoch) this.applyingEpoch = undefined;
      }
    });
    await this.accept(heads, digest, epoch, revision);
  }
  private async accept(
    heads: string[],
    digest: string,
    epoch: number,
    revision: number
  ): Promise<void> {
    if (!this.record) throw cancelled();
    const lastSyncedAt = await acceptDriveRecord(this.record, heads, digest, revision, {
      check: () => this.check(epoch),
      revision: () => this.revision,
      save: (record) => this.dependencies.save(this.owner, record),
      assign: (record) => {
        this.record = record;
      }
    });
    this.preview = undefined;
    this.update({
      phase: "idle",
      lastSyncedAt,
      pendingChanges: revision !== this.revision,
      conflict: undefined,
      error: undefined
    });
  }
}

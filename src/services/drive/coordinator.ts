import { driveBackupDigest, sanitizeDriveBackup } from "./backup.js";
import { DriveError } from "./types.js";
import type { Backup } from "../../model/types.js";
import type { DriveAuthorization, DriveInspection } from "./types.js";
import { summarize } from "./coordinator-types.js";
import type {
  DriveBridge,
  DriveDependencies,
  DriveRecord,
  DriveStatus
} from "./coordinator-types.js";

const same = (left: string[], right: string[]) =>
  [...left].sort().join() === [...right].sort().join();
const cancelled = () => new DOMException("Синхронизация прервана", "AbortError");

/** Owns a single bank profile/Google memory session; never owns market or history storage. */
export class DriveCoordinator {
  private status: DriveStatus = {
    phase: "disconnected",
    prepared: false,
    preparing: false,
    connected: false,
    automatic: true
  };
  private readonly listeners = new Set<() => void>();
  private owner = "";
  private session: unknown;
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
  ) {}
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
    if (!changed && profile.authenticated) return;
    if (!changed && !this.status.connected && this.status.phase !== "connecting") return;
    this.owner = profile.owner;
    this.session = profile.session;
    this.disconnect();
    this.record = undefined;
    this.status = {
      phase: "disconnected",
      prepared: this.status.prepared,
      preparing: false,
      connected: false,
      automatic: true
    };
    this.listeners.forEach((listener) => listener());
  }
  localChanged(): void {
    if (this.applyingEpoch !== this.epoch) {
      this.revision++;
      this.schedule();
    }
  }
  /** Invalidates an incoming snapshot before native geometry settles, without requesting upload. */
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
  async prepare(): Promise<void> {
    if (this.status.prepared || this.status.preparing) return;
    this.update({ preparing: true });
    try {
      await this.dependencies.auth.prepare();
      this.update({ prepared: true });
    } catch {
      this.update({ phase: "error", error: "network" });
    } finally {
      this.update({ preparing: false });
    }
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
      pending = this.dependencies.auth.connectFromUserGesture();
    this.update({ phase: "connecting", error: undefined, conflict: undefined });
    try {
      const authorization = await pending;
      if (
        epoch !== this.epoch ||
        this.bridge.profile().owner !== this.owner ||
        this.bridge.profile().session !== this.session ||
        !this.bridge.profile().authenticated
      ) {
        authorization.invalidate();
        return;
      }
      this.authorization = authorization;
      authorization.signal.addEventListener(
        "abort",
        () => {
          if (epoch !== this.epoch) return;
          this.remote = undefined;
          this.authorization = undefined;
          this.preview = undefined;
          clearTimeout(this.debounce);
          this.update({ phase: "auth-required", connected: false, conflict: undefined });
        },
        { once: true }
      );
      const record = await this.dependencies.load(this.owner);
      if (!this.current(epoch)) return;
      this.record = record;
      this.remote = this.dependencies.sync(authorization);
      this.update({
        phase: "idle",
        connected: true,
        automatic: record.automatic,
        ...(record.lastSyncedAt ? { lastSyncedAt: record.lastSyncedAt } : {})
      });
      await this.sync();
    } catch (error) {
      if (epoch === this.epoch) this.fail(error);
    }
  }
  disconnect = (): void => {
    this.epoch++;
    clearTimeout(this.debounce);
    this.authorization = undefined;
    this.remote = undefined;
    this.preview = undefined;
    this.busy = false;
    this.applyingEpoch = undefined;
    void this.dependencies.auth.disconnect().catch(() => {});
    this.update({ phase: "disconnected", connected: false, conflict: undefined, error: undefined });
  };
  private current(epoch: number): boolean {
    const profile = this.bridge.profile();
    return (
      epoch === this.epoch &&
      !!this.authorization &&
      !this.authorization.signal.aborted &&
      profile.owner === this.owner &&
      profile.session === this.session &&
      profile.authenticated
    );
  }
  private check(epoch: number, revision?: number): void {
    if (!this.current(epoch) || (revision !== undefined && revision !== this.revision))
      throw cancelled();
  }
  private fail(error: unknown): void {
    if (!this.status.connected && this.status.phase === "auth-required") return;
    if (error instanceof DOMException && error.name === "AbortError") {
      this.update({ phase: "idle", error: "local-changed" });
      this.schedule();
      return;
    }
    const code = error instanceof DriveError ? error.code : "network";
    this.update({ phase: code === "auth-required" ? "auth-required" : "error", error: code });
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
  /** Bounded polling/focus caller; explicit user sync also works with automatic disabled. */
  async sync(): Promise<void> {
    if (
      this.busy ||
      !this.remote ||
      !this.record ||
      !this.status.connected ||
      this.bridge.profile().blocked
    )
      return;
    clearTimeout(this.debounce);
    const epoch = this.epoch,
      remote = this.remote,
      revision = this.revision;
    this.busy = true;
    this.preview = undefined;
    this.update({ phase: "syncing", error: undefined, conflict: undefined });
    try {
      const backup = sanitizeDriveBackup(await this.bridge.exportBackup());
      this.check(epoch, revision);
      const digest = await driveBackupDigest(backup),
        inspection = await remote.inspect();
      this.check(epoch, revision);
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
        await this.accept([result.nodeId], digest, epoch);
      } else await this.accept(inspection.heads, digest, epoch);
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
    if (inspection.heads.length > 8)
      throw new DriveError("limit", "Слишком много конфликтующих снимков");
    const remotes = [];
    for (const nodeId of inspection.heads) {
      const incoming = await this.remote!.download(nodeId);
      this.check(epoch, revision);
      const date = inspection.snapshots.find((item) => item.manifest.nodeId === nodeId)?.manifest
        .createdAt;
      remotes.push({ ...summarize(incoming, date), nodeId });
    }
    this.check(epoch, revision);
    this.preview = { heads: inspection.heads, digest, revision };
    this.update({ phase: "conflict", conflict: { local: summarize(backup), remotes } });
  }
  async choose(nodeId: string): Promise<void> {
    const preview = this.preview,
      remote = this.remote,
      record = this.record;
    if (!preview || !remote || !record || this.busy || this.bridge.profile().blocked) return;
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
      if (nodeId === "local") await this.accept(heads, digest, epoch);
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
    this.check(epoch, revision);
    if (!backup.layout || !backup.watchlist || !backup.views)
      throw new DriveError("remote-invalid", "Неполный снимок настроек Google Диска");
    const signal = this.authorization?.signal;
    if (!signal) throw cancelled();
    try {
      await this.bridge.importBackup(backup, {
        replacePortable: true,
        signal,
        valid: () => this.current(epoch) && revision === this.revision,
        onCommitted: () => {
          this.applyingEpoch = epoch;
        }
      });
      this.check(epoch, revision);
    } finally {
      if (this.applyingEpoch === epoch) this.applyingEpoch = undefined;
    }
    const applied = await this.bridge.exportBackup();
    this.check(epoch, revision);
    await this.accept(heads, await driveBackupDigest(applied), epoch);
  }
  private async accept(heads: string[], digest: string, epoch: number): Promise<void> {
    this.check(epoch);
    if (!this.record) throw cancelled();
    const record = {
      ...this.record,
      baseHeads: [...heads],
      lastSyncedDigest: digest,
      lastSyncedAt: new Date().toISOString()
    };
    await this.dependencies.save(this.owner, record);
    this.check(epoch);
    this.record = record;
    this.preview = undefined;
    this.update({
      phase: "idle",
      lastSyncedAt: record.lastSyncedAt,
      conflict: undefined,
      error: undefined
    });
  }
}

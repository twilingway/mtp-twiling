import type { Backup } from "../../model/types.js";
import type { CloudProviderId } from "../../model/cloud-sync.js";
import type { TerminalController } from "./controller.js";
import { workspaceCameraPending, flushWorkspaceCamera } from "./controller-camera-sync.js";
import { activeWorkspaceChart } from "./workspace-active-chart.js";
import { driveWorkspaceBinding } from "../../services/drive/workspace-binding.js";
import {
  prepareDriveBackup,
  restoreDriveBackup,
  driveBackupDigest,
  verifyContent,
  MAX_IMAGE_BYTES,
  MAX_PAYLOAD_BYTES,
  MAX_TOTAL_BYTES
} from "../../services/drive/backup.js";
import {
  assertReadableDrivePayload,
  sanitizeLocalDriveBackup
} from "../../services/drive/reader-guard.js";

export interface CloudContentReference {
  readonly sha256: string;
  readonly size: number;
}
export interface PreparedCloudBackup {
  readonly payload: Blob;
  readonly images: readonly {
    index: number;
    body: Blob;
    reference: CloudContentReference;
    mimeType: string;
  }[];
}
export interface CloudHostScope {
  readonly owner: "device";
  readonly session: unknown;
  readonly cloudOwner: string;
  readonly ready: boolean;
  readonly blocked: boolean;
  readonly associationConflict: boolean;
  readonly revision: number;
}
export interface CloudOperationGuard {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
}
export interface CloudPreparedSnapshot {
  readonly backup: Backup;
  readonly prepared: PreparedCloudBackup;
  readonly digest: string;
  readonly revision: number;
}
export interface CloudSyncHost {
  scope(provider: CloudProviderId): CloudHostScope;
  /** Restore an unchanged window from shared canonical storage before any export flush. */
  refresh?(
    provider: CloudProviderId,
    expectedRevision: number,
    guard: CloudOperationGuard
  ): Promise<void>;
  capture(provider: CloudProviderId, guard: CloudOperationGuard): Promise<CloudPreparedSnapshot>;
  decode(prepared: PreparedCloudBackup, guard: CloudOperationGuard): Promise<Backup>;
  apply(
    provider: CloudProviderId,
    backup: Backup,
    expectedRevision: number,
    guard: CloudOperationGuard,
    onCommitted: (acceptedRevision: number) => void
  ): Promise<void>;
}
export class CloudHostError extends Error {
  constructor(
    readonly code: "local-changed" | "remote-invalid" | "limit" | "local-save",
    message: string
  ) {
    super(message);
    this.name = "CloudHostError";
  }
}
const changed = () =>
  new CloudHostError("local-changed", "Локальные данные изменились. Повторите проверку.");
const invalid = () =>
  new CloudHostError("remote-invalid", "Некорректный снимок облака. Данные устройства сохранены.");
const hasImageArray = (value: unknown): boolean => Array.isArray(value);
const hosts = new WeakMap<TerminalController, TerminalCloudSyncHost>();
const hostState = new WeakMap<CloudSyncHost, TerminalCloudSyncHost>();
class TerminalCloudSyncHost implements CloudSyncHost {
  revision = 0;
  applying: CloudProviderId | undefined;
  readonly commits = new Set<(provider: CloudProviderId, revision: number) => void>();
  private lease: Promise<void> = Promise.resolve();
  constructor(private readonly controller: TerminalController) {
    hostState.set(this, this);
  }
  private externalBlocked(): boolean {
    const state = this.controller.getSnapshot(),
      chart = activeWorkspaceChart(this.controller).getSnapshot();
    return !!(
      state.profileTransition ||
      workspaceCameraPending(this.controller) ||
      state.importRecoveryRequired ||
      state.loading ||
      chart.loading ||
      chart.preview ||
      chart.activeTool ||
      (chart.dialog && chart.dialog !== "account") ||
      state.preview ||
      state.activeTool ||
      (state.dialog && state.dialog !== "account")
    );
  }
  scope(provider: CloudProviderId): CloudHostScope {
    const state = this.controller.getSnapshot();
    const binding = this.controller.workspaceBinding();
    const google = driveWorkspaceBinding(binding);
    return {
      owner: "device",
      session: this.controller.cloudSessionKey(),
      cloudOwner: provider === "google-drive" ? (google.cloudOwner ?? "device") : "device",
      associationConflict: provider === "google-drive" && google.associationConflict,
      ready:
        state.owner === "device" &&
        !!binding &&
        this.controller.sessionKey() !== null &&
        !state.workspaceMigrationIncomplete,
      blocked: !!(
        this.externalBlocked() ||
        state.backupBusy ||
        state.importingBackup ||
        this.applying
      ),
      revision: this.revision
    };
  }
  private check(guard: CloudOperationGuard): void {
    guard.signal.throwIfAborted();
    if (!guard.isCurrent()) throw changed();
  }
  async refresh(
    provider: CloudProviderId,
    expectedRevision: number,
    guard: CloudOperationGuard
  ): Promise<void> {
    this.check(guard);
    const before = this.scope(provider);
    if (before.blocked || before.revision !== expectedRevision) throw changed();
    this.applying = provider;
    try {
      await this.controller.recoverBackup(true);
      this.check(guard);
      if (this.scope(provider).revision !== expectedRevision) throw changed();
      const revision = ++this.revision;
      this.commits.forEach((listener) => listener(provider, revision));
    } catch (error) {
      this.check(guard);
      if (error instanceof CloudHostError) throw error;
      throw new CloudHostError("local-save", "Не удалось восстановить состояние другого окна.");
    } finally {
      this.applying = undefined;
    }
  }
  async capture(
    provider: CloudProviderId,
    guard: CloudOperationGuard
  ): Promise<CloudPreparedSnapshot> {
    const scope = this.scope(provider),
      revision = scope.revision;
    const check = () => {
      this.check(guard);
      const next = this.scope(provider);
      if (
        !next.ready ||
        next.blocked ||
        next.session !== scope.session ||
        next.revision !== revision
      )
        throw changed();
    };
    check();
    if (scope.blocked) throw changed();
    await flushWorkspaceCamera(this.controller);
    check();
    const backup = sanitizeLocalDriveBackup(
      await this.controller.exportBackup(false, { captureView: false })
    );
    check();
    const prepared = await prepareDriveBackup(backup);
    check();
    const digest = await driveBackupDigest(backup);
    check();
    return { backup, prepared, digest, revision };
  }
  async decode(prepared: PreparedCloudBackup, guard: CloudOperationGuard): Promise<Backup> {
    this.check(guard);
    if (
      !prepared ||
      !(prepared.payload instanceof Blob) ||
      !hasImageArray(prepared.images) ||
      prepared.payload.size > MAX_PAYLOAD_BYTES ||
      prepared.images.length > 1000
    )
      throw invalid();
    let metadata: unknown;
    try {
      metadata = JSON.parse(await prepared.payload.text());
    } catch {
      throw invalid();
    }
    this.check(guard);
    assertReadableDrivePayload(metadata);
    let total = prepared.payload.size;
    const bodies: Blob[] = [];
    for (const [index, image] of prepared.images.entries()) {
      if (
        !image ||
        !image.reference ||
        typeof image.reference.sha256 !== "string" ||
        image.index !== index ||
        !(image.body instanceof Blob) ||
        image.body.size > MAX_IMAGE_BYTES ||
        !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(image.mimeType) ||
        image.body.type !== image.mimeType ||
        !/^[a-f0-9]{64}$/.test(image.reference.sha256) ||
        !Number.isSafeInteger(image.reference.size) ||
        image.reference.size < 0
      )
        throw invalid();
      total += image.body.size;
      if (total > MAX_TOTAL_BYTES) throw new CloudHostError("limit", "Превышен размер снимка.");
      await verifyContent(image.body, image.reference);
      this.check(guard);
      bodies.push(image.body);
    }
    const backup = await restoreDriveBackup(prepared.payload, bodies);
    this.check(guard);
    if (backup.images.some((image, index) => image.type !== prepared.images[index]?.mimeType))
      throw invalid();
    return backup;
  }
  async apply(
    provider: CloudProviderId,
    input: Backup,
    expectedRevision: number,
    guard: CloudOperationGuard,
    onCommitted: (acceptedRevision: number) => void
  ): Promise<void> {
    const backup = assertReadableDrivePayload(input),
      captured = this.scope(provider);
    this.check(guard);
    const previous = this.lease;
    let release!: () => void;
    this.lease = new Promise<void>((done) => {
      release = done;
    });
    await previous;
    let committed = false;
    let operationRevision = expectedRevision;
    try {
      const check = () => {
        this.check(guard);
        const scope = this.scope(provider);
        if (
          !scope.ready ||
          scope.session !== captured.session ||
          this.externalBlocked() ||
          scope.revision !== operationRevision
        )
          throw changed();
      };
      check();
      if (this.scope(provider).blocked) throw changed();
      this.applying = provider;
      await this.controller.importBackup(backup, {
        replacePortable: true,
        signal: guard.signal,
        valid: () => {
          check();
          return true;
        },
        onCommitted: () => {
          if (committed) return;
          committed = true;
          const acceptedRevision = ++this.revision;
          operationRevision = acceptedRevision;
          this.commits.forEach((listener) => listener(provider, acceptedRevision));
          onCommitted(acceptedRevision);
        }
      });
      if (!committed) throw changed();
      check();
    } finally {
      this.applying = undefined;
      release();
    }
  }
}
export function createCloudSyncHost(controller: TerminalController): CloudSyncHost {
  let host = hosts.get(controller);
  if (!host) {
    host = new TerminalCloudSyncHost(controller);
    hosts.set(controller, host);
  }
  return host;
}
/** The registry alone advances portable revision and identifies accepted remote restoration. */
export function cloudHostIntent(host: CloudSyncHost): void {
  const state = hostState.get(host);
  if (state) state.revision++;
}
export function cloudHostChanged(host: CloudSyncHost): CloudProviderId | undefined {
  const state = hostState.get(host);
  if (state && !state.applying) state.revision++;
  return state?.applying;
}
export function subscribeCloudHostCommit(
  host: CloudSyncHost,
  listener: (provider: CloudProviderId, revision: number) => void
): () => void {
  const state = hostState.get(host);
  state?.commits.add(listener);
  return () => {
    state?.commits.delete(listener);
  };
}

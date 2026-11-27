import { sha256 } from "./backup.js";
import { pinRawLegacyFile } from "./legacy-raw-archive-pin.js";
import { DriveError } from "./types.js";
import {
  endpoint,
  invalidRetention,
  propertiesKey,
  RETENTION_NAMESPACE,
  V2_FILES,
  V2_UPLOAD
} from "./legacy-raw-archive-http.js";
import type { RetentionHttp, RetentionMetadata } from "./legacy-raw-archive-http.js";
import { createRetentionAssigned } from "./legacy-raw-archive-upload.js";
import { deleteProbeJournal } from "./legacy-raw-archive-probe-journal.js";
import type { DeleteProbeJournal, OwnedDeleteProbe } from "./legacy-raw-archive-probe-journal.js";
import type { CompactionOutcome } from "./legacy-compaction-types.js";
import type { RawLegacyFile } from "./legacy-raw-archive-types.js";

const proofBrand: unique symbol = Symbol("retention-delete-proof");
export interface DeleteProof {
  readonly [proofBrand]: true;
}
const missing = (error: unknown) => error instanceof DriveError && error.status === 404;
const probeFailed = () =>
  new DriveError("not-ready", "Условное удаление Google Диска не подтверждено.");
function matches(file: RawLegacyFile, current: RetentionMetadata) {
  return (
    file.fileId === current.fileId &&
    file.etag === current.etag &&
    file.version === current.version &&
    file.size === current.size &&
    file.sha256 === current.sha256 &&
    propertiesKey(file.appProperties) === propertiesKey(current.appProperties)
  );
}

export class RetentionDeletes {
  private readonly issued = new WeakSet<DeleteProof>();
  private proof: DeleteProof | undefined;
  private flight: Promise<DeleteProof> | undefined;
  private pending: readonly string[] = [];
  constructor(
    private readonly http: RetentionHttp,
    private readonly journal: DeleteProbeJournal = deleteProbeJournal
  ) {}
  get pendingProbeIds(): readonly string[] {
    return this.pending;
  }
  private async refreshPending() {
    this.pending = Object.freeze(
      (await this.journal.read())
        .filter((entry) => entry.credentialId === this.http.authorization.credentialId)
        .map((entry) => entry.fileId)
    );
  }
  private async forget(fileId: string, signal: AbortSignal) {
    await this.journal.change((entries) => {
      const index = entries.findIndex((entry) => entry.fileId === fileId);
      if (index >= 0) entries.splice(index, 1);
    }, signal);
    this.pending = Object.freeze(this.pending.filter((id) => id !== fileId));
  }
  private async absent(fileId: string, signal: AbortSignal) {
    try {
      await this.http.metadata(fileId, signal);
      return false;
    } catch (error) {
      if (missing(error)) return true;
      throw error;
    }
  }
  private async cleanup(entry: OwnedDeleteProbe, signal: AbortSignal) {
    await this.http.check(signal);
    if (entry.credentialId !== this.http.authorization.credentialId) return;
    let metadata: RetentionMetadata;
    try {
      metadata = await this.http.metadata(entry.fileId, signal);
    } catch (error) {
      if (missing(error) && entry.observed) await this.forget(entry.fileId, signal);
      return;
    }
    const p = metadata.appProperties;
    if (
      p.mtpNamespace !== RETENTION_NAMESPACE ||
      p.mtpKind !== "probe" ||
      p.mtpOperationId !== entry.operationId ||
      p.mtpWorkspaceId !== entry.workspaceId ||
      p.mtpPublicClientId !== entry.publicClientId
    )
      return;
    const { response } = await this.http.request(`${V2_FILES}/${entry.fileId}`, signal, {
      method: "DELETE",
      headers: { "If-Match": metadata.etag }
    });
    void response.body?.cancel().catch(() => {});
    if (response.status === 204 && (await this.absent(entry.fileId, signal)))
      await this.forget(entry.fileId, signal);
  }
  async runDeleteProbe(signal: AbortSignal): Promise<DeleteProof> {
    await this.http.check(signal);
    if (this.proof) return this.proof;
    if (this.flight) return this.flight;
    const job = this.performProbe(signal);
    this.flight = job;
    try {
      return await job;
    } finally {
      if (this.flight === job) this.flight = undefined;
    }
  }
  private async performProbe(signal: AbortSignal): Promise<DeleteProof> {
    const credentialId = this.http.authorization.credentialId;
    if (!credentialId) throw new DriveError("auth-required", "Нужен повторный вход в Google.");
    for (const old of (await this.journal.read())
      .filter((entry) => entry.credentialId === credentialId)
      .slice(0, 4))
      await this.cleanup(old, signal).catch(() => {});
    await this.http.check(signal);
    const metadata = {
      operationId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      publicClientId: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };
    const fileId = await this.http.reserve(signal);
    const entry: OwnedDeleteProbe = { fileId, credentialId, ...metadata, observed: false };
    await this.journal.change((entries) => {
      if (entries.length >= 16)
        throw new DriveError("quota", "Завершите очистку технических файлов Google Диска.");
      entries.push(entry);
    }, signal);
    this.pending = Object.freeze([...this.pending, fileId]);
    try {
      const beforeBody = new Blob([new Uint8Array(128).fill(31)]),
        afterBody = new Blob([new Uint8Array(256).fill(67)]);
      await createRetentionAssigned(
        this.http,
        fileId,
        "probe",
        beforeBody,
        metadata,
        await sha256(beforeBody),
        signal
      );
      const before = await this.http.readStable(fileId, 1024, signal);
      entry.observed = true;
      await this.journal.change((entries) => {
        const current = entries.find((item) => item.fileId === fileId);
        if (!current) throw invalidRetention();
        current.observed = true;
      }, signal);
      const replaced = await this.http.request(
        endpoint(`${V2_UPLOAD}/${fileId}`, { uploadType: "media", fields: "id,etag" }),
        signal,
        {
          method: "PUT",
          headers: { "If-Match": before.metadata.etag, "Content-Type": "application/octet-stream" },
          body: afterBody
        }
      );
      void replaced.response.body?.cancel().catch(() => {});
      if (replaced.response.status !== 200) throw probeFailed();
      const current = await this.http.readStable(fileId, 1024, signal);
      const hash = await sha256(afterBody);
      if (current.metadata.etag === before.metadata.etag || current.metadata.sha256 !== hash)
        throw probeFailed();
      const stale = await this.http.request(`${V2_FILES}/${fileId}`, signal, {
        method: "DELETE",
        headers: { "If-Match": before.metadata.etag }
      });
      void stale.response.body?.cancel().catch(() => {});
      if (stale.response.status !== 412) throw probeFailed();
      const preserved = await this.http.readStable(fileId, 1024, signal);
      if (preserved.metadata.etag !== current.metadata.etag || preserved.metadata.sha256 !== hash)
        throw probeFailed();
      const fresh = await this.http.request(`${V2_FILES}/${fileId}`, signal, {
        method: "DELETE",
        headers: { "If-Match": current.metadata.etag }
      });
      void fresh.response.body?.cancel().catch(() => {});
      if (fresh.response.status !== 204 || !(await this.absent(fileId, signal)))
        throw probeFailed();
      await this.http.check(signal);
      const proof = Object.freeze({ [proofBrand]: true as const });
      this.issued.add(proof);
      this.proof = proof;
      await this.forget(fileId, signal).catch(() => {});
      return proof;
    } finally {
      if (!signal.aborted && !this.http.authorization.signal.aborted)
        await this.cleanup(entry, signal).catch(() => {});
      await this.refreshPending().catch(() => {});
    }
  }
  async deletePinned(
    input: RawLegacyFile,
    proof: DeleteProof,
    signal: AbortSignal
  ): Promise<CompactionOutcome> {
    const file = pinRawLegacyFile(input);
    if (!this.issued.has(proof)) throw invalidRetention();
    const finish = async (outcome: CompactionOutcome) => {
      await this.http.check(signal);
      return outcome;
    };
    await this.http.check(signal);
    let current: RetentionMetadata;
    try {
      current = await this.http.metadata(file.fileId, signal);
    } catch (error) {
      if (missing(error)) return finish("deleted");
      throw error;
    }
    if (!matches(file, current)) return finish("changed");
    try {
      const { response } = await this.http.request(`${V2_FILES}/${file.fileId}`, signal, {
        method: "DELETE",
        headers: { "If-Match": file.etag }
      });
      void response.body?.cancel().catch(() => {});
      if (response.status === 412) return finish("changed");
      if ([401, 403, 429].includes(response.status))
        throw new DriveError(
          response.status === 401
            ? "auth-required"
            : response.status === 403
              ? "permission"
              : "quota",
          "Удаление Google Диска не разрешено.",
          response.status
        );
    } catch (error) {
      await this.http.check(signal);
      if (error instanceof DriveError && error.code !== "network") throw error;
    }
    await this.http.check(signal);
    try {
      const after = await this.http.metadata(file.fileId, signal);
      return finish(matches(file, after) ? "unknown" : "changed");
    } catch (error) {
      if (missing(error)) return finish("deleted");
      await this.http.check(signal);
      return finish("unknown");
    }
  }
}

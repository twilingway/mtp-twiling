import {
  decodeBundle,
  encodeBundle,
  MAX_BUNDLE_BYTES,
  revisionHeaderSize,
  decodeRevisionHeader,
  revisionHeads,
  revisionName
} from "./bundle.js";
import type { YandexRevision } from "./bundle.js";
import { assertCurrent, YandexError } from "./types.js";
import type { YandexAuthorization, YandexFile, YandexPreparedBackup } from "./types.js";
import type { YandexJournal } from "./journal.js";
import type { YandexTransport } from "./transport.js";

export interface YandexRemote {
  readonly file: YandexFile;
  readonly revision: YandexRevision;
}
const fingerprint = (files: readonly YandexFile[]) =>
  JSON.stringify(files.map(({ name, md5, size, modified }) => [name, md5, size, modified]).sort());
export class YandexRevisions {
  get credentialGeneration(): string {
    return this.auth.credentialGeneration;
  }
  private readonly bodies = new Map<string, YandexPreparedBackup>();
  private downloadedBytes = 0;
  private headerBytes = 0;
  constructor(
    private readonly transport: YandexTransport,
    private readonly journal: YandexJournal,
    private readonly auth: YandexAuthorization,
    private readonly clientId: string,
    private readonly cache = new Map<string, YandexRemote>()
  ) {}
  async inspect(valid: () => boolean): Promise<{ remotes: YandexRemote[]; heads: string[] }> {
    const files = (await this.transport.list()).filter((item) => !item.name.startsWith("probe_"));
    const remotes: YandexRemote[] = [];
    for (const item of files) {
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
    if (
      fingerprint(files) !==
      fingerprint((await this.transport.list()).filter((item) => !item.name.startsWith("probe_")))
    )
      throw new YandexError("conflict");
    assertCurrent(this.auth.signal, valid);
    return { remotes, heads: revisionHeads(remotes.map(({ revision }) => revision)) };
  }
  async read(remote: YandexRemote, valid: () => boolean): Promise<YandexPreparedBackup> {
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
  private async download(file: YandexFile) {
    this.downloadedBytes += file.size;
    if (this.downloadedBytes > MAX_BUNDLE_BYTES * 2) throw new YandexError("limit");
    return decodeBundle(await this.transport.read(file, MAX_BUNDLE_BYTES));
  }
  async publish(
    prepared: YandexPreparedBackup,
    digest: string,
    parents: readonly string[],
    valid: () => boolean,
    rebindConfirmed = false
  ): Promise<YandexRevision> {
    let pending = await this.journal.pending(this.clientId, this.auth.accountId);
    assertCurrent(this.auth.signal, valid);
    if (pending && pending.credentialGeneration !== this.auth.credentialGeneration) {
      if (!rebindConfirmed) throw new YandexError("indeterminate");
      await this.journal.archivePending(this.clientId, pending, this.auth.signal);
      pending = undefined;
    }
    if (pending && pending.revision.digest !== digest && !rebindConfirmed)
      throw new YandexError("indeterminate");
    if (pending && pending.revision.digest !== digest) {
      await this.journal.archivePending(this.clientId, pending, this.auth.signal);
      pending = undefined;
    }
    if (!pending) {
      const deviceId = await this.journal.deviceId(),
        bundle = await encodeBundle(prepared, {
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
    const file = await this.transport.putImmutable(pending.name, pending.body, pending.reference);
    assertCurrent(this.auth.signal, valid);
    this.cache.set(fingerprint([file]), { file, revision: pending.revision });
    this.bodies.set(fingerprint([file]), (await decodeBundle(pending.body)).prepared);
    return pending.revision;
  }
}

import type { CompactionReceipt } from "./legacy-compaction-types.js";
import {
  invalidRetention,
  propertiesKey,
  RETENTION_NAMESPACE,
  RETENTION_RECORD_LIMIT
} from "./legacy-raw-archive-http.js";
import type { RetentionHttp, RetentionMetadata } from "./legacy-raw-archive-http.js";
import { pinCompactionReceipt } from "./legacy-raw-archive-pin.js";

interface CachedRead {
  readonly reference: CompactionReceipt;
  readonly metadata: RetentionMetadata;
  readonly body: Blob;
}
function verifiedMetadata(metadata: RetentionMetadata, reference: CompactionReceipt) {
  const props = metadata.appProperties;
  if (
    props.mtpNamespace !== RETENTION_NAMESPACE ||
    (props.mtpKind !== "rawarchive" && props.mtpKind !== "compaction") ||
    props.mtpHash !== reference.sha256 ||
    metadata.sha256 !== reference.sha256 ||
    metadata.size !== reference.size ||
    (props.mtpKind === "compaction" && metadata.size > RETENTION_RECORD_LIMIT)
  )
    throw invalidRetention();
}
const same = (a: RetentionMetadata, b: RetentionMetadata) =>
  a.fileId === b.fileId &&
  a.size === b.size &&
  a.sha256 === b.sha256 &&
  a.etag === b.etag &&
  a.version === b.version &&
  propertiesKey(a.appProperties) === propertiesKey(b.appProperties);

/** Bounded RAM only. Every hit proves current availability and exact metadata before reuse. */
export class RetentionReadCache {
  private readonly entries = new Map<string, CachedRead>();
  private bytes = 0;
  constructor(
    private readonly http: RetentionHttp,
    private readonly maxBytes = 16 * 1024 * 1024,
    private readonly maxEntries = 8
  ) {
    http.authorization.signal.addEventListener(
      "abort",
      () => {
        this.entries.clear();
        this.bytes = 0;
      },
      { once: true }
    );
  }
  private drop(id: string) {
    const entry = this.entries.get(id);
    if (entry) this.bytes -= entry.body.size;
    this.entries.delete(id);
  }
  async read(input: CompactionReceipt, signal: AbortSignal): Promise<Blob> {
    const reference = pinCompactionReceipt(input);
    await this.http.check(signal);
    const cached = this.entries.get(reference.fileId);
    if (cached) {
      try {
        const metadata = await this.http.metadata(reference.fileId, signal);
        if (
          cached.reference.sha256 === reference.sha256 &&
          cached.reference.size === reference.size &&
          same(cached.metadata, metadata)
        ) {
          verifiedMetadata(metadata, reference);
          await this.http.check(signal);
          this.entries.delete(reference.fileId);
          this.entries.set(reference.fileId, cached);
          return cached.body;
        }
      } catch (error) {
        this.drop(reference.fileId);
        throw error;
      }
      this.drop(reference.fileId);
    }
    const { metadata, body } = await this.http.readStable(reference.fileId, reference.size, signal);
    verifiedMetadata(metadata, reference);
    await this.http.check(signal);
    if (body.size <= this.maxBytes) {
      while (this.entries.size >= this.maxEntries || this.bytes + body.size > this.maxBytes) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.drop(oldest);
      }
      this.entries.set(reference.fileId, { reference, metadata, body });
      this.bytes += body.size;
    }
    return body;
  }
}

export interface RawLegacyFile {
  readonly fileId: string;
  readonly namespace: "mtp-drive-v1" | "mtp-drive-v2";
  readonly kind: "snapshot" | "blob";
  readonly key: string;
  readonly version: string;
  readonly etag: string;
  readonly size: number;
  readonly sha256: string;
  readonly appProperties: Readonly<Record<string, string>>;
}

export interface RawArchiveMetadata {
  readonly operationId: string;
  readonly workspaceId: string;
  readonly publicClientId: string;
  readonly createdAt: string;
}

export interface RawArchiveIndex extends RawArchiveMetadata {
  readonly formatVersion: 1;
  readonly files: readonly (RawLegacyFile & { readonly offset: number })[];
}

export interface RawLegacyObject {
  readonly file: RawLegacyFile;
  readonly body: Blob;
}

export interface RawArchiveReference {
  readonly size: number;
  readonly sha256: string;
  readonly indexDigest?: string;
}

export interface EncodedRawArchive {
  readonly body: Blob;
  readonly index: RawArchiveIndex;
  readonly indexDigest: string;
  readonly inventoryDigest: string;
  readonly sha256: string;
  readonly size: number;
}

export interface DecodedRawArchive extends EncodedRawArchive {
  readonly objects: readonly RawLegacyObject[];
}

export interface ArchiveReceipt {
  readonly fileId: string;
  readonly size: number;
  readonly sha256: string;
  readonly indexDigest: string;
}

export interface CompactionRecord extends RawArchiveMetadata {
  readonly formatVersion: 1;
  readonly archive: ArchiveReceipt;
  readonly inventoryDigest: string;
  readonly v3: {
    readonly fileId: string;
    readonly revisionId: string;
    readonly envelopeHash: string;
  };
}

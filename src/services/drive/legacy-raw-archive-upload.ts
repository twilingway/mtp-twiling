import { isRecord } from "../../model/backup-format.js";
import type { RawArchiveMetadata } from "./legacy-raw-archive-types.js";
import {
  endpoint,
  invalidRetention,
  MULTIPART_LIMIT,
  propertiesKey,
  RETENTION_NAMESPACE,
  retentionLimit,
  V3_UPLOAD
} from "./legacy-raw-archive-http.js";
import type { RetentionHttp, RetentionKind } from "./legacy-raw-archive-http.js";

export type ImmutableMetadata = RawArchiveMetadata & {
  readonly indexDigest?: string;
  readonly reservedFileId?: string;
};
export function retentionProperties(
  kind: RetentionKind,
  metadata: RawArchiveMetadata & { readonly indexDigest?: string },
  hash: string
) {
  const id = /^[A-Za-z0-9_.:@-]{1,256}$/;
  if (
    ![metadata.operationId, metadata.workspaceId, metadata.publicClientId].every(
      (value) => typeof value === "string" && id.test(value)
    ) ||
    !Number.isFinite(Date.parse(metadata.createdAt)) ||
    !/^[a-f\d]{64}$/.test(hash) ||
    (metadata.indexDigest !== undefined && !/^[a-f\d]{64}$/.test(metadata.indexDigest))
  )
    throw invalidRetention();
  return {
    mtpNamespace: RETENTION_NAMESPACE,
    mtpKind: kind,
    mtpOperationId: metadata.operationId,
    mtpWorkspaceId: metadata.workspaceId,
    mtpPublicClientId: metadata.publicClientId,
    mtpHash: hash,
    ...(metadata.indexDigest ? { mtpIndexDigest: metadata.indexDigest } : {})
  };
}
/** The caller must durably journal this assigned ID before invoking the upload. Never retries POST. */
export async function createRetentionAssigned(
  http: RetentionHttp,
  fileId: string,
  kind: RetentionKind,
  body: Blob,
  metadata: ImmutableMetadata,
  hash: string,
  signal: AbortSignal
): Promise<void> {
  if (body.size > MULTIPART_LIMIT) throw retentionLimit();
  const appProperties = retentionProperties(kind, metadata, hash);
  const name = `${RETENTION_NAMESPACE}-${kind}-${metadata.operationId}`;
  const boundary = `mtp_retention_${crypto.randomUUID()}`;
  const descriptor = {
    id: fileId,
    name,
    parents: ["appDataFolder"],
    mimeType: "application/octet-stream",
    appProperties
  };
  const multipart = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(descriptor)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
    body,
    `\r\n--${boundary}--\r\n`
  ]);
  const { response, scope } = await http.request(
    endpoint(V3_UPLOAD, { uploadType: "multipart", fields: "id,size,appProperties" }),
    signal,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: multipart
    }
  );
  if (response.status === 409) {
    void response.body?.cancel().catch(() => {});
    const existing = await http.metadata(fileId, signal);
    if (
      existing.size !== body.size ||
      existing.sha256 !== hash ||
      propertiesKey(existing.appProperties) !== propertiesKey(appProperties)
    )
      throw invalidRetention();
    return;
  }
  const result = await http.json(response, scope);
  if (
    !isRecord(result) ||
    result.id !== fileId ||
    Number(result.size) !== body.size ||
    !isRecord(result.appProperties) ||
    propertiesKey(result.appProperties as Record<string, string>) !== propertiesKey(appProperties)
  )
    throw invalidRetention();
}

import { isRecord } from "../../model/backup-format.js";
import { sha256 } from "./backup.js";
import { strongDeviceSlotTag } from "./device-slot-cas.js";
import { DRIVE_NAMESPACE, LEGACY_DRIVE_NAMESPACE, DriveError } from "./types.js";
import type { DriveAuthorization } from "./types.js";
import type { LegacyCandidate } from "./legacy-compaction-types.js";

export const RETENTION_NAMESPACE = "mtp-drive-retention-v1";
export const RAW_SOURCE_LIMIT = 256 * 1024 * 1024;
export const RAW_ARCHIVE_LIMIT = 512 * 1024 * 1024;
export const RETENTION_RECORD_LIMIT = 1024 * 1024;
export const MULTIPART_LIMIT = 5 * 1024 * 1024;
export const V3_FILES = "https://www.googleapis.com/drive/v3/files";
export const V2_FILES = "https://www.googleapis.com/drive/v2/files";
export const V3_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
export const V2_UPLOAD = "https://www.googleapis.com/upload/drive/v2/files";
export type RetentionKind = "rawarchive" | "compaction" | "probe";
export interface RetentionMetadata {
  fileId: string;
  size: number;
  version: string;
  etag: string;
  sha256: string;
  appProperties: Readonly<Record<string, string>>;
}
export interface RetentionHttpOptions {
  fetch?: typeof fetch;
  check?: (signal: AbortSignal) => Promise<void>;
  timeoutMs?: number;
}
export const invalidRetention = () =>
  new DriveError("remote-invalid", "Некорректные данные архива Google Диска.");
export const retentionLimit = () =>
  new DriveError("limit", "Размер архива превышает поддерживаемую загрузку Google Диска.");
export const validFileId = (id: string) => /^[\w-]{1,200}$/.test(id);
export const validHash = (hash: string) => /^[a-f\d]{64}$/.test(hash);
export const endpoint = (base: string, params: Record<string, string>) =>
  `${base}?${new URLSearchParams(params)}`;
export const propertiesKey = (props: Readonly<Record<string, string>>) =>
  JSON.stringify(Object.entries(props).sort(([a], [b]) => a.localeCompare(b)));

export function parseProperties(value: unknown): Readonly<Record<string, string>> {
  if (
    !isRecord(value) ||
    Object.keys(value).length > 128 ||
    Object.entries(value).some(
      ([key, item]) => key.length > 256 || typeof item !== "string" || item.length > 4096
    )
  )
    throw invalidRetention();
  return Object.freeze(Object.fromEntries(Object.entries(value)) as Record<string, string>);
}
export function parseCandidate(input: unknown): LegacyCandidate {
  if (
    !isRecord(input) ||
    typeof input.id !== "string" ||
    !validFileId(input.id) ||
    typeof input.version !== "string" ||
    !/^\d{1,20}$/.test(input.version)
  )
    throw invalidRetention();
  const size = Number(input.size),
    appProperties = parseProperties(input.appProperties);
  if (!Number.isSafeInteger(size) || size < 0 || size > RAW_SOURCE_LIMIT) throw retentionLimit();
  const namespace = appProperties.mtpNamespace,
    kind = appProperties.mtpKind,
    key = appProperties.mtpKey;
  if (
    (namespace !== DRIVE_NAMESPACE && namespace !== LEGACY_DRIVE_NAMESPACE) ||
    (kind !== "snapshot" && kind !== "blob") ||
    !key ||
    key.length > 512
  )
    throw invalidRetention();
  return Object.freeze({
    fileId: input.id,
    namespace,
    kind,
    key,
    version: input.version,
    size,
    appProperties
  });
}
export function assertResponse(response: Response) {
  if (response.ok) return;
  void response.body?.cancel().catch(() => {});
  const code =
    response.status === 401
      ? "auth-required"
      : response.status === 403
        ? "permission"
        : response.status === 429
          ? "quota"
          : response.status >= 500 || !response.status
            ? "network"
            : "remote-invalid";
  throw new DriveError(code, "Запрос архива Google Диска не выполнен.", response.status);
}

export class RetentionHttp {
  constructor(
    readonly authorization: DriveAuthorization,
    private readonly options: RetentionHttpOptions = {}
  ) {}
  async check(signal: AbortSignal) {
    signal.throwIfAborted();
    this.authorization.signal.throwIfAborted();
    await this.options.check?.(signal);
    signal.throwIfAborted();
    this.authorization.signal.throwIfAborted();
    this.authorization.getAccessToken();
  }
  async request(url: string, signal: AbortSignal, init: RequestInit = {}) {
    await this.check(signal);
    const scope = AbortSignal.any([
      signal,
      this.authorization.signal,
      AbortSignal.timeout(this.options.timeoutMs ?? 20_000)
    ]);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.authorization.getAccessToken()}`);
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        ...init,
        headers,
        signal: scope,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer"
      });
      scope.throwIfAborted();
      if (response.status === 401) this.authorization.invalidate();
      return { response, scope };
    } catch {
      signal.throwIfAborted();
      this.authorization.signal.throwIfAborted();
      throw new DriveError("network", "Нет связи с архивом Google Диска.");
    }
  }
  async body(response: Response, limit: number, signal: AbortSignal): Promise<Blob> {
    assertResponse(response);
    if (response.status !== 200 || !response.body) throw invalidRetention();
    if (Number(response.headers.get("Content-Length")) > limit) {
      void response.body.cancel().catch(() => {});
      throw retentionLimit();
    }
    const reader = response.body.getReader(),
      chunks: ArrayBuffer[] = [];
    let size = 0;
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      for (;;) {
        signal.throwIfAborted();
        const next = await reader.read();
        signal.throwIfAborted();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > limit) throw retentionLimit();
        chunks.push(next.value.slice().buffer);
      }
      return new Blob(chunks);
    } finally {
      signal.removeEventListener("abort", cancel);
      cancel();
      reader.releaseLock();
    }
  }
  async json(response: Response, signal: AbortSignal): Promise<unknown> {
    const body = await this.body(response, RETENTION_RECORD_LIMIT, signal);
    try {
      return JSON.parse(await body.text()) as unknown;
    } catch {
      throw invalidRetention();
    }
  }
  async getJson(url: string, signal: AbortSignal) {
    const { response, scope } = await this.request(url, signal);
    return this.json(response, scope);
  }
  async metadata(fileId: string, signal: AbortSignal): Promise<RetentionMetadata> {
    if (!validFileId(fileId)) throw invalidRetention();
    const v3 = await this.getJson(
      endpoint(`${V3_FILES}/${fileId}`, { fields: "id,size,version,appProperties,trashed" }),
      signal
    );
    const { response, scope } = await this.request(
      endpoint(`${V2_FILES}/${fileId}`, { fields: "id,etag,version,fileSize,sha256Checksum" }),
      signal
    );
    const v2 = await this.json(response, scope);
    if (
      !isRecord(v3) ||
      !isRecord(v2) ||
      v3.id !== fileId ||
      v2.id !== fileId ||
      v3.trashed === true ||
      typeof v3.version !== "string" ||
      !/^\d{1,20}$/.test(v3.version) ||
      v3.version !== v2.version ||
      Number(v3.size) !== Number(v2.fileSize) ||
      typeof v2.etag !== "string" ||
      typeof v2.sha256Checksum !== "string" ||
      !validHash(v2.sha256Checksum.toLowerCase())
    )
      throw invalidRetention();
    const size = Number(v3.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > RAW_ARCHIVE_LIMIT) throw retentionLimit();
    const etag = strongDeviceSlotTag(v2.etag),
      header = response.headers.get("ETag");
    if (header !== null && strongDeviceSlotTag(header) !== etag) throw invalidRetention();
    return Object.freeze({
      fileId,
      size,
      version: v3.version,
      etag,
      sha256: v2.sha256Checksum.toLowerCase(),
      appProperties: parseProperties(v3.appProperties)
    });
  }
  async readStable(fileId: string, limit: number, signal: AbortSignal) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await this.metadata(fileId, signal);
      if (before.size > limit) throw retentionLimit();
      const { response, scope } = await this.request(
        endpoint(`${V3_FILES}/${fileId}`, { alt: "media" }),
        signal
      );
      const body = await this.body(response, before.size, scope);
      const after = await this.metadata(fileId, signal);
      if (
        before.version === after.version &&
        before.etag === after.etag &&
        before.size === after.size &&
        before.sha256 === after.sha256 &&
        propertiesKey(before.appProperties) === propertiesKey(after.appProperties) &&
        body.size === after.size &&
        (await sha256(body)) === after.sha256
      ) {
        await this.check(signal);
        return { metadata: after, body };
      }
    }
    throw new DriveError("conflict", "Версия Google Диска изменилась во время чтения архива.");
  }
  async reserve(signal: AbortSignal): Promise<string> {
    const value = await this.getJson(
      `${V3_FILES}/generateIds?count=1&space=appDataFolder&type=files`,
      signal
    );
    if (
      !isRecord(value) ||
      !Array.isArray(value.ids) ||
      value.ids.length !== 1 ||
      typeof value.ids[0] !== "string" ||
      !validFileId(value.ids[0])
    )
      throw invalidRetention();
    return value.ids[0];
  }
}

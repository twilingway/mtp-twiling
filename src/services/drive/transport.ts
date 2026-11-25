import { isRecord } from "../../model/backup-format.js";
import { shaPattern } from "./backup.js";
import { DRIVE_NAMESPACE, DriveError } from "./types.js";
import type { DriveAuthorization, DriveFile, DriveKind, DriveStore } from "./types.js";

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FIELDS = "id,name,size,appProperties";
const CHUNK = 1024 * 1024;
const MAX_FILES = 10000;
const invalid = () => new DriveError("remote-invalid", "Некорректный ответ Google Диска.");

function parseFile(value: unknown): DriveFile {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !/^[\w-]{1,200}$/.test(value.id) ||
    typeof value.name !== "string" ||
    (typeof value.size !== "string" && typeof value.size !== "number") ||
    !Number.isSafeInteger(Number(value.size)) ||
    Number(value.size) < 0 ||
    !isRecord(value.appProperties) ||
    !Object.values(value.appProperties).every((item) => typeof item === "string")
  )
    throw invalid();
  return {
    id: value.id,
    name: value.name,
    size: Number(value.size),
    appProperties: value.appProperties as Record<string, string>
  };
}
function namespaced(file: DriveFile, kind: DriveKind, namespace: string): boolean {
  return file.appProperties.mtpNamespace === namespace && file.appProperties.mtpKind === kind;
}
function accessToken(authorization: DriveAuthorization): string {
  if (authorization.signal.aborted)
    throw new DriveError("auth-required", "Подключение Google Диска закрыто.");
  try {
    return authorization.getAccessToken();
  } catch {
    throw new DriveError("auth-required", "Подключите Google Диск повторно.");
  }
}
async function boundedBody(
  response: Response,
  maxBytes: number,
  authorization: DriveAuthorization
): Promise<Blob> {
  accessToken(authorization);
  if (Number(response.headers.get("Content-Length")) > maxBytes)
    throw new DriveError("limit", "Файл Google Диска слишком большой.");
  if (!response.body) throw invalid();
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch {
    accessToken(authorization);
    throw new DriveError("network", "Не удалось прочитать ответ Google Диска.");
  }
  const chunks: ArrayBuffer[] = [];
  let total = 0;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  authorization.signal.addEventListener("abort", cancel, { once: true });
  try {
    accessToken(authorization);
    while (true) {
      const result = await reader.read();
      accessToken(authorization);
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) throw new DriveError("limit", "Файл Google Диска слишком большой.");
      chunks.push(result.value.slice().buffer);
    }
  } catch (error) {
    accessToken(authorization);
    if (error instanceof DriveError) throw error;
    throw new DriveError("network", "Не удалось получить данные Google Диска.");
  } finally {
    authorization.signal.removeEventListener("abort", cancel);
    cancel();
  }
  return new Blob(chunks);
}
async function json(response: Response, authorization: DriveAuthorization): Promise<unknown> {
  const body = await boundedBody(response, 8 * 1024 * 1024, authorization);
  try {
    const text = await body.text();
    accessToken(authorization);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof DriveError) throw error;
    throw invalid();
  }
}
async function retryable(response: Response, authorization: DriveAuthorization): Promise<boolean> {
  if (response.status === 429 || response.status >= 500) return true;
  if (response.status !== 403) return false;
  try {
    const value = await json(response, authorization);
    return (
      isRecord(value) &&
      isRecord(value.error) &&
      Array.isArray(value.error.errors) &&
      value.error.errors.some(
        (item: unknown) =>
          isRecord(item) &&
          ["rateLimitExceeded", "userRateLimitExceeded"].includes(String(item.reason))
      )
    );
  } catch (error) {
    if (error instanceof DriveError && error.code !== "remote-invalid") throw error;
    return false;
  }
}
function query(base: string, params: Record<string, string>): string {
  return `${base}?${new URLSearchParams(params)}`;
}

export interface DriveTransportOptions {
  namespace?: "mtp-drive-v1" | "mtp-drive-v2";
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}
export class DriveTransport implements DriveStore {
  private readonly namespace: "mtp-drive-v1" | "mtp-drive-v2";
  private readonly fetcher: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  constructor(
    private readonly authorization: DriveAuthorization,
    options: DriveTransportOptions = {}
  ) {
    this.namespace = options.namespace ?? DRIVE_NAMESPACE;
    this.fetcher = options.fetch ?? fetch.bind(globalThis);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
  }

  private async request(
    url: string,
    init: RequestInit = {},
    allowed: number[] = [],
    retry = true
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = accessToken(this.authorization);
      let response: Response;
      try {
        response = await this.fetcher(url, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init.headers)),
            Authorization: `Bearer ${token}`
          },
          signal: this.authorization.signal,
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer"
        });
      } catch {
        accessToken(this.authorization);
        if (!retry || attempt >= 3) throw new DriveError("network", "Нет связи с Google Диском.");
        await this.backoff(attempt);
        continue;
      }
      accessToken(this.authorization);
      if (response.status === 401) {
        this.authorization.invalidate();
        throw new DriveError("auth-required", "Подключите Google Диск повторно.", 401);
      }
      if (response.ok || allowed.includes(response.status)) return response;
      const transient = await retryable(response, this.authorization);
      if (retry && transient && attempt < 3) {
        await this.backoff(attempt, response.headers.get("Retry-After"));
        continue;
      }
      throw new DriveError(
        transient ? "quota" : response.status === 403 ? "permission" : "remote-invalid",
        "Запрос Google Диска не выполнен.",
        response.status
      );
    }
  }
  private async backoff(attempt: number, retryAfter: string | null = null): Promise<void> {
    const seconds = retryAfter === null ? 0 : Number(retryAfter);
    const delay = Number.isFinite(seconds) ? Math.min(60000, Math.max(0, seconds * 1000)) : 0;
    await this.sleep(Math.max(delay, Math.min(16000, 1000 * 2 ** attempt + this.random() * 1000)));
    accessToken(this.authorization);
  }

  async list(kind: DriveKind): Promise<DriveFile[]> {
    const files = new Map<string, DriveFile>();
    const pages = new Set<string>();
    let pageToken = "";
    do {
      if (pages.has(pageToken) || pages.size >= 100)
        throw new DriveError("limit", "Слишком много страниц Google Диска.");
      pages.add(pageToken);
      const response = await this.request(
        query(API, {
          spaces: "appDataFolder",
          pageSize: "1000",
          pageToken,
          fields: `files(${FIELDS}),nextPageToken,incompleteSearch`,
          q: `trashed = false and appProperties has { key='mtpNamespace' and value='${this.namespace}' } and appProperties has { key='mtpKind' and value='${kind}' }`
        })
      );
      const value = await json(response, this.authorization);
      if (
        !isRecord(value) ||
        !Array.isArray(value.files) ||
        value.incompleteSearch === true ||
        (value.nextPageToken !== undefined && typeof value.nextPageToken !== "string")
      )
        throw invalid();
      for (const item of value.files) {
        const file = parseFile(item);
        if (!namespaced(file, kind, this.namespace)) throw invalid();
        files.set(file.id, file);
      }
      if (files.size > MAX_FILES)
        throw new DriveError("limit", "Слишком много снимков Google Диска.");
      pageToken = typeof value.nextPageToken === "string" ? value.nextPageToken : "";
    } while (pageToken);
    return [...files.values()];
  }

  async read(file: DriveFile, maxBytes: number): Promise<Blob> {
    if (
      (!namespaced(file, "blob", this.namespace) &&
        !namespaced(file, "snapshot", this.namespace)) ||
      file.size > maxBytes ||
      !/^[\w-]{1,200}$/.test(file.id)
    )
      throw invalid();
    const response = await this.request(
      query(`${API}/${encodeURIComponent(file.id)}`, { alt: "media" })
    );
    const body = await boundedBody(response, maxBytes, this.authorization);
    if (body.size !== file.size) throw invalid();
    return body;
  }

  async create(kind: DriveKind, key: string, hash: string, body: Blob): Promise<DriveFile> {
    if (this.namespace !== DRIVE_NAMESPACE)
      throw new DriveError("permission", "Legacy Google Диск доступен только для чтения.");
    if (!/^[\w-]{1,100}$/.test(key) || !shaPattern.test(hash)) throw invalid();
    const generated = await json(
      await this.request(
        query(`${API}/generateIds`, { count: "1", space: "appDataFolder", type: "files" })
      ),
      this.authorization
    );
    if (
      !isRecord(generated) ||
      !Array.isArray(generated.ids) ||
      typeof generated.ids[0] !== "string" ||
      !/^[\w-]{1,200}$/.test(generated.ids[0])
    )
      throw invalid();
    const id = generated.ids[0];
    const metadata = {
      id,
      name: `mtp-v1-${kind}-${key}`,
      parents: ["appDataFolder"],
      mimeType: body.type || "application/octet-stream",
      appProperties: { mtpNamespace: this.namespace, mtpKind: kind, mtpKey: key, mtpHash: hash }
    };
    let result: unknown;
    if (body.size <= 5 * 1024 * 1024) {
      const boundary = `mtp_${crypto.randomUUID()}`;
      const multipart = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`,
        body,
        `\r\n--${boundary}--\r\n`
      ]);
      const response = await this.request(
        query(UPLOAD, { uploadType: "multipart", fields: FIELDS }),
        {
          method: "POST",
          headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
          body: multipart
        },
        [409]
      );
      result =
        response.status === 409
          ? await this.existing(id)
          : await json(response, this.authorization);
    } else result = await this.resumable(metadata, body);
    const file = parseFile(result);
    if (
      file.id !== id ||
      !namespaced(file, kind, this.namespace) ||
      file.appProperties.mtpKey !== key ||
      file.appProperties.mtpHash !== hash ||
      file.size !== body.size
    )
      throw invalid();
    return file;
  }
  private async existing(id: string): Promise<unknown> {
    return json(
      await this.request(query(`${API}/${encodeURIComponent(id)}`, { fields: FIELDS })),
      this.authorization
    );
  }
  private async resumable(
    metadata: { id: string; mimeType: string },
    body: Blob
  ): Promise<unknown> {
    for (let sessionAttempt = 0; sessionAttempt < 3; sessionAttempt++) {
      const initial = await this.request(
        query(UPLOAD, { uploadType: "resumable", fields: FIELDS }),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": metadata.mimeType,
            "X-Upload-Content-Length": String(body.size)
          },
          body: JSON.stringify(metadata)
        },
        [409]
      );
      if (initial.status === 409) return this.existing(metadata.id);
      const location = initial.headers.get("Location");
      if (!location) throw invalid();
      let url: URL;
      try {
        url = new URL(location);
      } catch {
        throw invalid();
      }
      if (
        url.protocol !== "https:" ||
        url.hostname !== "www.googleapis.com" ||
        url.port ||
        !/^\/upload\/drive\/v3\/files(?:\/[\w-]+)?$/.test(url.pathname) ||
        url.username ||
        url.password
      )
        throw invalid();
      let offset = 0;
      let stalls = 0;
      while (offset < body.size && stalls < 4) {
        const end = Math.min(offset + CHUNK, body.size);
        let response: Response;
        try {
          response = await this.request(
            location,
            {
              method: "PUT",
              headers: {
                "Content-Type": metadata.mimeType,
                "Content-Range": `bytes ${offset}-${end - 1}/${body.size}`
              },
              body: body.slice(offset, end)
            },
            [308, 404],
            false
          );
        } catch (error) {
          if (!(error instanceof DriveError) || !["network", "quota"].includes(error.code))
            throw error;
          await this.backoff(stalls++);
          response = await this.request(
            location,
            {
              method: "PUT",
              headers: { "Content-Range": `bytes */${body.size}` },
              body: new Blob()
            },
            [308, 404]
          );
        }
        if (response.ok) return json(response, this.authorization);
        if (response.status === 404) break;
        const range = response.headers.get("Range");
        const match = range?.match(/^bytes=0-(\d+)$/);
        if (range && !match) throw invalid();
        const received = match ? Number(match[1]) + 1 : 0;
        if (!Number.isSafeInteger(received) || received > body.size || received < 0)
          throw invalid();
        if (received > offset) stalls = 0;
        else stalls++;
        offset = received;
        if (offset === body.size) {
          const status = await this.request(
            location,
            {
              method: "PUT",
              headers: { "Content-Range": `bytes */${body.size}` },
              body: new Blob()
            },
            [308, 404]
          );
          if (status.ok) return json(status, this.authorization);
          throw invalid();
        }
      }
      if (stalls >= 4) throw new DriveError("network", "Передача Google Диска не продвигается.");
    }
    throw new DriveError("network", "Не удалось возобновить передачу Google Диска.");
  }
}

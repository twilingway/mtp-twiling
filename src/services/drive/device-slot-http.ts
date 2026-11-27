import { isRecord } from "../../model/backup-format.js";
import { strongDeviceSlotTag } from "./device-slot-cas.js";
import { DEVICE_SLOT_NAMESPACE, MAX_DEVICE_SLOTS } from "./device-slot-model.js";
import {
  MAX_DEVICE_SLOT_PACKAGE_BYTES,
  MAX_DEVICE_SLOT_PACKAGE_HEADER_BYTES
} from "./device-slot-package.js";
import { DriveError } from "./types.js";
import type { DriveAuthorization } from "./types.js";

const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FIELDS = "id,name,size,appProperties";
export const PROBE_NAMESPACE = "mtp-drive-cas-probe";
export type SlotNamespace = typeof DEVICE_SLOT_NAMESPACE | typeof PROBE_NAMESPACE;
export interface SlotLocation {
  readonly id: string;
  readonly key: string;
  readonly size: number;
  readonly namespace: SlotNamespace;
}

const idPattern = /^[\w-]{1,200}$/;
const keyPattern = /^[0-9a-f-]{36}_[0-9a-f-]{36}$/;
const invalid = () => new DriveError("remote-invalid", "Некорректный файл Google Диска.");
const limit = () => new DriveError("limit", "Превышен допустимый размер Google Диска.");
const endpoint = (url: string, params: Record<string, string>) =>
  `${url}?${new URLSearchParams(params)}`;

export function assertSlotHttp(response: Response): void {
  if (response.ok) return;
  void response.body?.cancel().catch(() => {});
  const status = response.status;
  let code: "auth-required" | "permission" | "quota" | "network" | "remote-invalid" =
    "remote-invalid";
  if (status === 401) code = "auth-required";
  else if (status === 403) code = "permission";
  else if (status === 429) code = "quota";
  else if (!status || status === 408 || status >= 500) code = "network";
  throw new DriveError(code, "Запрос Google Диска не выполнен.", status);
}

async function bodyOf(response: Response, limitBytes: number, signal: AbortSignal, prefix = false) {
  if (!response.body) throw invalid();
  if (!prefix) {
    if (Number(response.headers.get("Content-Length")) > limitBytes) {
      void response.body.cancel().catch(() => {});
      throw limit();
    }
    let bytes = 0;
    const bounded = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > limitBytes) throw limit();
        controller.enqueue(chunk);
      }
    });
    return new Response(response.body.pipeThrough(bounded, { signal })).blob();
  }
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: BlobPart[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      const take = Math.min(next.value.byteLength, limitBytes - bytes);
      chunks.push(next.value.slice(0, take).buffer);
      bytes += take;
      if (bytes === limitBytes) break;
    }
    return new Blob(chunks);
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

function location(input: unknown, namespace: SlotNamespace): SlotLocation {
  if (
    !isRecord(input) ||
    typeof input.id !== "string" ||
    !idPattern.test(input.id) ||
    !isRecord(input.appProperties) ||
    input.appProperties.mtpNamespace !== namespace ||
    input.appProperties.mtpKind !== "device-slot" ||
    typeof input.appProperties.mtpKey !== "string" ||
    !keyPattern.test(input.appProperties.mtpKey) ||
    (typeof input.size !== "string" && typeof input.size !== "number")
  )
    throw invalid();
  const size = Number(input.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_DEVICE_SLOT_PACKAGE_BYTES)
    throw limit();
  return Object.freeze({ id: input.id, key: input.appProperties.mtpKey, size, namespace });
}

export class DeviceSlotHttp {
  constructor(
    private readonly auth: DriveAuthorization,
    private readonly fetcher: typeof fetch,
    readonly namespace: SlotNamespace = DEVICE_SLOT_NAMESPACE
  ) {}

  private async request(url: string, signal: AbortSignal, init: RequestInit = {}) {
    const scope = AbortSignal.any([signal, this.auth.signal]);
    scope.throwIfAborted();
    const headers = new Headers(init.headers);
    try {
      headers.set("Authorization", `Bearer ${this.auth.getAccessToken()}`);
    } catch {
      throw new DriveError("auth-required", "Подключите Google Диск повторно.");
    }
    try {
      const response = await this.fetcher(url, {
        ...init,
        signal: AbortSignal.any([scope, AbortSignal.timeout(120_000)]),
        headers,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer"
      });
      scope.throwIfAborted();
      if (response.status === 401) this.auth.invalidate();
      return response;
    } catch {
      scope.throwIfAborted();
      throw new DriveError("network", "Нет связи с Google Диском.");
    }
  }

  private async json(url: string, signal: AbortSignal, init?: RequestInit): Promise<unknown> {
    const response = await this.request(url, signal, init);
    assertSlotHttp(response);
    const body = await bodyOf(response, 1024 * 1024, AbortSignal.any([signal, this.auth.signal]));
    try {
      return JSON.parse(await body.text()) as unknown;
    } catch {
      throw invalid();
    }
  }

  async list(signal: AbortSignal): Promise<SlotLocation[]> {
    const seen = new Set<string>();
    const files: SlotLocation[] = [];
    let pageToken = "";
    do {
      if (seen.has(pageToken) || seen.size >= 16) throw limit();
      seen.add(pageToken);
      const result = await this.json(
        endpoint(FILES, {
          spaces: "appDataFolder",
          pageSize: "200",
          pageToken,
          fields: `files(${FIELDS}),nextPageToken,incompleteSearch`,
          q: `trashed = false and appProperties has { key='mtpNamespace' and value='${this.namespace}' } and appProperties has { key='mtpKind' and value='device-slot' }`
        }),
        signal
      );
      if (
        !isRecord(result) ||
        !Array.isArray(result.files) ||
        result.incompleteSearch === true ||
        (result.nextPageToken !== undefined && typeof result.nextPageToken !== "string")
      )
        throw invalid();
      files.push(...result.files.map((item: unknown) => location(item, this.namespace)));
      if (files.length > MAX_DEVICE_SLOTS) throw limit();
      pageToken = typeof result.nextPageToken === "string" ? result.nextPageToken : "";
    } while (pageToken);
    return files;
  }

  async read(id: string, signal: AbortSignal, prefix = false) {
    if (!idPattern.test(id)) throw invalid();
    const response = await this.request(endpoint(`${FILES}/${id}`, { alt: "media" }), signal);
    assertSlotHttp(response);
    if (response.status !== 200) throw invalid();
    const body = await bodyOf(
      response,
      prefix ? MAX_DEVICE_SLOT_PACKAGE_HEADER_BYTES : MAX_DEVICE_SLOT_PACKAGE_BYTES,
      AbortSignal.any([signal, this.auth.signal]),
      prefix
    );
    return { body, etag: response.headers.get("ETag") };
  }

  async reserve(signal: AbortSignal): Promise<string> {
    const result = await this.json(
      `${FILES}/generateIds?count=1&space=appDataFolder&type=files`,
      signal
    );
    if (
      !isRecord(result) ||
      !Array.isArray(result.ids) ||
      result.ids.length !== 1 ||
      typeof result.ids[0] !== "string" ||
      !idPattern.test(result.ids[0])
    )
      throw invalid();
    return result.ids[0];
  }

  async create(id: string, key: string, body: Blob, signal: AbortSignal): Promise<SlotLocation> {
    if (!idPattern.test(id) || !keyPattern.test(key)) throw invalid();
    if (!body.size || body.size > MAX_DEVICE_SLOT_PACKAGE_BYTES) throw limit();
    const mimeType = "application/octet-stream";
    const metadata = {
      id,
      name: `${this.namespace}-${key}`,
      parents: ["appDataFolder"],
      mimeType,
      appProperties: { mtpNamespace: this.namespace, mtpKind: "device-slot", mtpKey: key }
    };
    const boundary = `mtp_slot_${crypto.randomUUID()}`;
    const data = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      body,
      `\r\n--${boundary}--\r\n`
    ]);
    const result = location(
      await this.json(endpoint(UPLOAD, { uploadType: "multipart", fields: FIELDS }), signal, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: data
      }),
      this.namespace
    );
    if (result.id !== id || result.key !== key || result.size !== body.size) throw invalid();
    return result;
  }

  patch(id: string, etag: string, body: Blob, signal: AbortSignal): Promise<Response> {
    if (!idPattern.test(id)) return Promise.reject(invalid());
    if (!body.size || body.size > MAX_DEVICE_SLOT_PACKAGE_BYTES) return Promise.reject(limit());
    return this.request(endpoint(`${UPLOAD}/${id}`, { uploadType: "media" }), signal, {
      method: "PATCH",
      headers: {
        "If-Match": strongDeviceSlotTag(etag),
        "Content-Type": "application/octet-stream"
      },
      body
    });
  }
}

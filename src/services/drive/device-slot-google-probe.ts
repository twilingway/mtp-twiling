import { isRecord } from "../../model/backup-format.js";
import {
  createDeviceSlotCasProbe,
  DeviceSlotCas,
  DeviceSlotCasError,
  encodeDeviceSlotEnvelope,
  probeDeviceSlotCas
} from "./device-slot-cas.js";
import { DriveError } from "./types.js";
import type { DriveAuthorization, DriveErrorCode } from "./types.js";

const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const PROBE_NAMESPACE = "mtp-drive-cas-probe";
const PROBE_KIND = "synthetic-device-slot";
const TIMEOUT_MS = 20_000;
const MAX_METADATA_BYTES = 16 * 1024;
type Stage = "reserve" | "create" | "compare";
const statusCodes: Partial<Record<number, DriveErrorCode>> = {
  401: "auth-required",
  403: "permission",
  429: "quota"
};

export interface DeviceSlotGoogleProbeOptions {
  fetch: typeof fetch;
  signal?: AbortSignal;
}

export class DeviceSlotGoogleProbeError extends DriveError {
  constructor(
    public readonly stage: Stage,
    public readonly fileId: string | undefined,
    code: DriveErrorCode,
    status?: number,
    public readonly casIssue?: DeviceSlotCasError["issue"]
  ) {
    super(code, "Проверка условной записи Google Диска не завершена.", status);
    this.name = "DeviceSlotGoogleProbeError";
  }
}

const invalid = () => new DriveError("remote-invalid", "Некорректный ответ на пробу Google Диска.");

async function metadata(response: Response): Promise<unknown> {
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    const status = response.status;
    const code =
      statusCodes[status] ?? (status === 0 || status >= 500 ? "network" : "remote-invalid");
    throw new DriveError(code, "Запрос пробы Google Диска не выполнен.", status);
  }
  if (!response.body || Number(response.headers.get("Content-Length")) > MAX_METADATA_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw invalid();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_METADATA_BYTES) throw invalid();
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch (error) {
    if (error instanceof DriveError) throw error;
    throw invalid();
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function url(base: string, params: Record<string, string>): string {
  return `${base}?${new URLSearchParams(params)}`;
}

/** Explicit diagnostic entry point. Its only writable target is the generated synthetic file. */
export async function runDeviceSlotGoogleProbe(
  authorization: DriveAuthorization,
  options: DeviceSlotGoogleProbeOptions
) {
  const signal = options.signal
    ? AbortSignal.any([authorization.signal, options.signal])
    : authorization.signal;
  let stage: Stage = "reserve";
  let fileId: string | undefined;
  const request = async (endpoint: string, init: RequestInit = {}) => {
    signal.throwIfAborted();
    const headers = new Headers(init.headers);
    try {
      const token = authorization.getAccessToken();
      if (!token) throw invalid();
      headers.set("Authorization", `Bearer ${token}`);
    } catch {
      throw new DriveError("auth-required", "Подключите Google Диск повторно.");
    }
    try {
      return await options.fetch(endpoint, {
        ...init,
        headers,
        signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer"
      });
    } catch {
      signal.throwIfAborted();
      throw new DriveError("network", "Не удалось выполнить пробу Google Диска.");
    }
  };

  try {
    signal.throwIfAborted();
    const fixture = await createDeviceSlotCasProbe();
    const generated = await metadata(
      await request(`${FILES}/generateIds?count=1&space=appDataFolder&type=files`)
    );
    if (
      !isRecord(generated) ||
      !Array.isArray(generated.ids) ||
      generated.ids.length !== 1 ||
      typeof generated.ids[0] !== "string" ||
      !/^[\w-]{1,200}$/.test(generated.ids[0])
    )
      throw invalid();
    const id = generated.ids[0];
    fileId = id;
    stage = "create";
    const seed = encodeDeviceSlotEnvelope(fixture.seed);
    const name = `${PROBE_NAMESPACE}-${fixture.seed.current.workspaceId}.json`;
    const appProperties = { mtpNamespace: PROBE_NAMESPACE, mtpKind: PROBE_KIND };
    const create = { id, name, parents: ["appDataFolder"], mimeType: seed.type, appProperties };
    const boundary = `mtp_cas_${crypto.randomUUID()}`;
    const prefix = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`;
    const suffix = `\r\n--${boundary}--\r\n`;
    const body = new Blob([prefix, JSON.stringify(create), `\r\n${prefix}`, seed, suffix]);
    const destination = url(UPLOAD, {
      uploadType: "multipart",
      fields: "id,name,size,mimeType,appProperties"
    });
    const created = await metadata(
      await request(destination, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body
      })
    );
    if (
      !isRecord(created) ||
      created.id !== id ||
      created.name !== name ||
      created.mimeType !== seed.type ||
      Number(created.size) !== seed.size ||
      !isRecord(created.appProperties) ||
      created.appProperties.mtpNamespace !== PROBE_NAMESPACE ||
      created.appProperties.mtpKind !== PROBE_KIND
    )
      throw invalid();

    stage = "compare";
    const cas = new DeviceSlotCas((target, init) => {
      if (target !== id) throw invalid();
      if (init.method === "GET") return request(url(`${FILES}/${id}`, { alt: "media" }), init);
      if (init.method === "PATCH")
        return request(url(`${UPLOAD}/${id}`, { uploadType: "media" }), init);
      throw invalid();
    });
    const proof = await probeDeviceSlotCas(cas, id, fixture, signal);
    return { fileId: id, ...proof };
  } catch (error) {
    const code = signal.aborted
      ? "auth-cancelled"
      : error instanceof DriveError
        ? error.code
        : "remote-invalid";
    throw new DeviceSlotGoogleProbeError(
      stage,
      fileId,
      code,
      error instanceof DriveError ? error.status : undefined,
      error instanceof DeviceSlotCasError ? error.issue : undefined
    );
  }
}

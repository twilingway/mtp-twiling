import { reference, sha256, shaPattern } from "./backup.js";
import { DEVICE_SLOT_PROTOCOL, parseDeviceSlotEnvelope } from "./device-slot-model.js";
import type {
  DeviceSlotEnvelope,
  DeviceSlotFile,
  DeviceSlotManifest
} from "./device-slot-model.js";
import { DriveError } from "./types.js";

export const MAX_DEVICE_SLOT_ENVELOPE_BYTES = 256 * 1024;

export type DeviceSlotCasRequest = (fileId: string, init: RequestInit) => Promise<Response>;
export interface DeviceSlotCasRead extends DeviceSlotFile {
  readonly etag: string;
}
export type DeviceSlotCasResult =
  | {
      readonly outcome: "committed";
      readonly snapshot: DeviceSlotCasRead;
      readonly recovered: boolean;
    }
  | { readonly outcome: "conflict"; readonly status: 412 };

export interface DeviceSlotCasPending {
  readonly fileId: string;
  readonly baseEtag: string;
  readonly envelope: DeviceSlotEnvelope;
}
export type DeviceSlotCasReconciliation =
  | {
      readonly outcome: "committed";
      readonly retained: "current" | "previous";
      readonly snapshot: DeviceSlotCasRead;
    }
  | { readonly outcome: "conflict" | "unconfirmed"; readonly snapshot: DeviceSlotCasRead };

const messages = {
  validator: ["not-ready", "Google Диск не предоставил пригодную метку для условной записи."],
  hash: ["remote-invalid", "Контрольная сумма файла устройства не совпала."],
  base: ["conflict", "Условная запись не соответствует прочитанной версии устройства."],
  unconfirmed: ["network", "Google Диск не подтвердил запись файла устройства повторным чтением."],
  probe: ["not-ready", "Проверка условной записи файла устройства не пройдена."]
} as const;
export class DeviceSlotCasError extends DriveError {
  constructor(public readonly issue: keyof typeof messages) {
    const [code, message] = messages[issue];
    super(code, message);
    this.name = "DeviceSlotCasError";
  }
}

// An entity-tag is opaque. Weak tags, wildcard and combined tags cannot authorize replacement.
export function strongDeviceSlotTag(value: string | null): string {
  if (value === null || !/^"[\x21\x23-\x7e\x80-\xff]{0,512}"$/.test(value))
    throw new DeviceSlotCasError("validator");
  return value;
}

function httpFailure(status: number): DriveError {
  const code =
    status === 401
      ? "auth-required"
      : status === 403
        ? "permission"
        : status === 429
          ? "quota"
          : status === 408 || status >= 500
            ? "network"
            : "remote-invalid";
  return new DriveError(code, "Запрос файла устройства Google Диска не выполнен.", status);
}

const sizeLimit = () => new DriveError("limit", "Файл устройства Google Диска слишком большой.");

async function deviceSlotBody(response: Response, signal: AbortSignal): Promise<Blob> {
  if (Number(response.headers.get("Content-Length")) > MAX_DEVICE_SLOT_ENVELOPE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw sizeLimit();
  }
  if (!response.body) throw httpFailure(response.status);
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let bytes = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_DEVICE_SLOT_ENVELOPE_BYTES) throw sizeLimit();
      chunks.push(chunk.value.slice().buffer);
    }
    signal.throwIfAborted();
    return new Blob(chunks, { type: "application/json" });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof DriveError) throw error;
    throw new DriveError("network", "Не удалось прочитать файл устройства Google Диска.");
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

function requestOptions(signal: AbortSignal): RequestInit {
  return {
    signal,
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer"
  };
}

export function encodeDeviceSlotEnvelope(envelope: DeviceSlotEnvelope): Blob {
  return new Blob([JSON.stringify(parseDeviceSlotEnvelope(envelope))], {
    type: "application/json"
  });
}

const manifestDigest = (manifest: DeviceSlotManifest) =>
  sha256(new Blob([JSON.stringify(manifest)], { type: "application/json" }));

export class DeviceSlotCas {
  private readonly verified = new WeakSet<DeviceSlotCasRead>();

  constructor(private readonly request: DeviceSlotCasRequest) {}

  async read(
    fileId: string,
    signal: AbortSignal,
    expectedEnvelopeHash?: string
  ): Promise<DeviceSlotCasRead> {
    signal.throwIfAborted();
    if (!/^[\w-]{1,200}$/.test(fileId)) throw new DeviceSlotCasError("base");
    if (expectedEnvelopeHash !== undefined && !shaPattern.test(expectedEnvelopeHash))
      throw new DeviceSlotCasError("hash");
    let response: Response;
    try {
      response = await this.request(fileId, { ...requestOptions(signal), method: "GET" });
    } catch {
      signal.throwIfAborted();
      throw new DriveError("network", "Не удалось прочитать файл устройства Google Диска.");
    }
    signal.throwIfAborted();
    if (response.status !== 200) throw httpFailure(response.status);
    const etag = strongDeviceSlotTag(response.headers.get("ETag"));
    const body = await deviceSlotBody(response, signal);
    const envelopeHash = await sha256(body);
    signal.throwIfAborted();
    if (expectedEnvelopeHash !== undefined && expectedEnvelopeHash !== envelopeHash)
      throw new DeviceSlotCasError("hash");
    let input: unknown;
    try {
      input = JSON.parse(await body.text()) as unknown;
    } catch {
      throw new DriveError("remote-invalid", "Некорректный JSON файла устройства Google Диска.");
    }
    signal.throwIfAborted();
    const envelope = parseDeviceSlotEnvelope(input);
    const snapshot = Object.freeze({ fileId, envelopeHash, envelope, etag });
    this.verified.add(snapshot);
    return snapshot;
  }

  async replace(
    base: DeviceSlotCasRead,
    next: DeviceSlotEnvelope,
    signal: AbortSignal
  ): Promise<DeviceSlotCasResult> {
    signal.throwIfAborted();
    if (!this.verified.has(base)) throw new DeviceSlotCasError("base");
    const envelope = parseDeviceSlotEnvelope(next);
    if (JSON.stringify(envelope.previous) !== JSON.stringify(base.envelope.current))
      throw new DeviceSlotCasError("base");
    const body = encodeDeviceSlotEnvelope(envelope);
    if (body.size > MAX_DEVICE_SLOT_ENVELOPE_BYTES) throw sizeLimit();
    const expectedHash = await sha256(body);
    signal.throwIfAborted();
    let response: Response | undefined;
    try {
      response = await this.request(base.fileId, {
        ...requestOptions(signal),
        method: "PATCH",
        headers: { "If-Match": strongDeviceSlotTag(base.etag), "Content-Type": body.type },
        body
      });
    } catch {
      signal.throwIfAborted();
      // A response can be lost after commit. Never replay the PATCH to test that outcome.
    }
    signal.throwIfAborted();
    void response?.body?.cancel().catch(() => {});
    if (response?.status === 412) return { outcome: "conflict", status: 412 };
    if (
      response &&
      !response.ok &&
      response.status !== 0 &&
      response.status !== 408 &&
      response.status < 500
    )
      throw httpFailure(response.status);
    let snapshot: DeviceSlotCasRead;
    try {
      snapshot = await this.read(base.fileId, signal, expectedHash);
    } catch {
      signal.throwIfAborted();
      throw new DeviceSlotCasError("unconfirmed");
    }
    if (snapshot.etag === base.etag) throw new DeviceSlotCasError("unconfirmed");
    return { outcome: "committed", snapshot, recovered: response?.ok !== true };
  }

  /** Verify a saved intended write, including after reloading. Never sends a PATCH. */
  async reconcile(
    pending: DeviceSlotCasPending,
    signal: AbortSignal
  ): Promise<DeviceSlotCasReconciliation> {
    signal.throwIfAborted();
    const baseEtag = strongDeviceSlotTag(pending.baseEtag);
    const intended = parseDeviceSlotEnvelope(pending.envelope);
    if (!intended.previous) throw new DeviceSlotCasError("base");
    const snapshot = await this.read(pending.fileId, signal);
    const { current, previous } = snapshot.envelope;
    const target = intended.current;
    if (
      current.workspaceId !== target.workspaceId ||
      current.deviceId !== target.deviceId ||
      current.legacyArchive !== target.legacyArchive
    )
      throw new DeviceSlotCasError("base");
    if (snapshot.etag === baseEtag) return { outcome: "unconfirmed", snapshot };
    const retained =
      current.seq === target.seq ? "current" : previous?.seq === target.seq ? "previous" : null;
    if (!retained) return { outcome: "unconfirmed", snapshot };
    const observed = retained === "current" ? current : previous!;
    if (observed.revisionId !== target.revisionId) return { outcome: "conflict", snapshot };
    const matches =
      retained === "current"
        ? snapshot.envelopeHash === (await sha256(encodeDeviceSlotEnvelope(intended)))
        : (await manifestDigest(observed)) === (await manifestDigest(target));
    signal.throwIfAborted();
    if (!matches) throw new DeviceSlotCasError("hash");
    return { outcome: "committed", retained, snapshot };
  }
}

export interface DeviceSlotCasProbe {
  readonly seed: DeviceSlotEnvelope;
  readonly candidates: readonly [DeviceSlotEnvelope, DeviceSlotEnvelope];
}
const disposableFixtures = new WeakSet<DeviceSlotCasProbe>();

/** Seed a disposable media file with the encoded fixture before invoking the explicit probe. */
export async function createDeviceSlotCasProbe(): Promise<DeviceSlotCasProbe> {
  const workspaceId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const make = async (variant: string, previous: DeviceSlotManifest | null) => {
    const revision = { deviceId, seq: previous ? 2 : 1, revisionId: crypto.randomUUID() };
    const payload = await reference(new Blob([`mtp-cas-probe:${workspaceId}:${variant}`]));
    return parseDeviceSlotEnvelope({
      protocol: DEVICE_SLOT_PROTOCOL,
      previous,
      current: {
        protocol: DEVICE_SLOT_PROTOCOL,
        workspaceId,
        legacyArchive: null,
        ...revision,
        previousRevisionId: previous?.revisionId ?? null,
        accepted: [revision],
        payload
      }
    });
  };
  const seed = await make("seed", null);
  const candidates = await Promise.all([make("a", seed.current), make("b", seed.current)]);
  const fixture = Object.freeze({ seed, candidates: Object.freeze(candidates) });
  disposableFixtures.add(fixture);
  return fixture;
}

/** A passing result describes only the supplied endpoint, file and browser context. */
export async function probeDeviceSlotCas(
  cas: DeviceSlotCas,
  fileId: string,
  fixture: DeviceSlotCasProbe,
  signal: AbortSignal
): Promise<{ readonly winner: DeviceSlotCasRead; readonly loserStatus: 412 }> {
  if (!disposableFixtures.has(fixture)) throw new DeviceSlotCasError("probe");
  const before = await cas.read(
    fileId,
    signal,
    await sha256(encodeDeviceSlotEnvelope(fixture.seed))
  );
  const settled = await Promise.allSettled(
    fixture.candidates.map((next) => cas.replace(before, next, signal))
  );
  signal.throwIfAborted();
  const outcomes = settled.flatMap((item) => (item.status === "fulfilled" ? [item.value] : []));
  const committed = outcomes.find((result) => result.outcome === "committed");
  const conflict = outcomes.find((result) => result.outcome === "conflict");
  if (!committed || !conflict) throw new DeviceSlotCasError("probe");
  let winner: DeviceSlotCasRead;
  try {
    winner = await cas.read(fileId, signal, committed.snapshot.envelopeHash);
  } catch {
    signal.throwIfAborted();
    throw new DeviceSlotCasError("probe");
  }
  if (winner.etag !== committed.snapshot.etag) throw new DeviceSlotCasError("probe");
  return { winner, loserStatus: conflict.status };
}

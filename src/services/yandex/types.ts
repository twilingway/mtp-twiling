export const YANDEX_SCOPE = "cloud_api:disk.app_folder";
export const YANDEX_ROOT = "app:/mtp-yandex-v1";
export const YANDEX_CAPABILITIES = Object.freeze({
  replaceIfMatch: false,
  serverRevisionHistory: false,
  automaticPhysicalCleanup: false,
  retentionRequiresSessionProof: true,
  destinationExclusion: "probe-required" as const
});
export interface YandexPublicConfig {
  readonly clientId: string;
  readonly redirectUri: string;
}
export type YandexErrorCode =
  | "configuration-required"
  | "auth-required"
  | "auth-cancelled"
  | "not-ready"
  | "busy"
  | "network"
  | "local-save"
  | "quota"
  | "permission"
  | "remote-invalid"
  | "unsupported-format"
  | "conflict"
  | "limit"
  | "local-changed"
  | "indeterminate";
export class YandexError extends Error {
  constructor(
    readonly code: YandexErrorCode,
    readonly status?: number
  ) {
    super(`Yandex Disk: ${code}`);
    this.name = "YandexError";
  }
}
export function yandexErrorCode(error: unknown): YandexErrorCode {
  const candidate = object(error)?.code;
  const codes: readonly YandexErrorCode[] = [
    "configuration-required",
    "auth-required",
    "auth-cancelled",
    "not-ready",
    "busy",
    "network",
    "local-save",
    "quota",
    "permission",
    "remote-invalid",
    "unsupported-format",
    "conflict",
    "limit",
    "local-changed",
    "indeterminate"
  ];
  return codes.find((code) => code === candidate) ?? "network";
}
export interface YandexAuthorization {
  readonly connectionId: string;
  readonly credentialGeneration: string;
  readonly accountId: string;
  readonly signal: AbortSignal;
  readonly stored: boolean;
  readonly persistenceError: boolean;
  getAccessToken(): string;
  invalidate(): void;
}
export interface YandexFile {
  readonly name: string;
  readonly path: string;
  readonly size: number;
  readonly md5: string;
  readonly modified: string;
}
export interface YandexReference {
  readonly sha256: string;
  readonly size: number;
}
export interface YandexPreparedBackup {
  readonly payload: Blob;
  readonly images: readonly {
    index: number;
    body: Blob;
    reference: YandexReference;
    mimeType: string;
  }[];
}
export const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
export const uuidPattern = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
export const hashPattern = /^[a-f\d]{64}$/;
export function validateYandexConfig(config: YandexPublicConfig | undefined): YandexPublicConfig {
  if (!config || !/^[a-f\d]{32}$/i.test(config.clientId))
    throw new YandexError("configuration-required");
  let uri: URL;
  try {
    uri = new URL(config.redirectUri);
  } catch {
    throw new YandexError("configuration-required");
  }
  if (
    (uri.protocol !== "https:" &&
      !(uri.protocol === "http:" && ["localhost", "127.0.0.1"].includes(uri.hostname))) ||
    uri.username ||
    uri.password ||
    uri.search ||
    uri.hash ||
    !["/yandex-callback.html", "/__dev/app/yandex-callback.html"].includes(uri.pathname)
  )
    throw new YandexError("configuration-required");
  return Object.freeze({ clientId: config.clientId, redirectUri: uri.href });
}
export function hasYandexConfig(config: YandexPublicConfig | undefined): boolean {
  try {
    validateYandexConfig(config);
    return true;
  } catch {
    return false;
  }
}
export async function sha256(body: Blob): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", await body.arrayBuffer()));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function assertCurrent(signal: AbortSignal, valid: () => boolean = () => true): void {
  signal.throwIfAborted();
  if (!valid()) throw new YandexError("local-changed");
}

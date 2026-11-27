import { object, YANDEX_SCOPE, YandexError } from "./types.js";
import { yandexLocalStore } from "./local.js";
import type { YandexLocalStore } from "./local.js";

export interface YandexCredential {
  readonly version: 1;
  readonly generation: string;
  readonly clientId: string;
  readonly accountId: string;
  readonly accessToken: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly scopes: readonly string[];
}
export interface YandexCredentialVault {
  load(clientId: string): Promise<YandexCredential | undefined>;
  save(credential: YandexCredential, signal: AbortSignal): Promise<void>;
  remove(clientId: string, generation?: string): Promise<void>;
}
const id = (clientId: string) => `mtp:yandex:device:credential:${clientId}`;
const aad = (clientId: string) =>
  new TextEncoder().encode(
    JSON.stringify(["mtp-yandex-auth-v1", "device", clientId, YANDEX_SCOPE])
  );
export function validCredential(
  value: unknown,
  clientId: string,
  now: number
): value is YandexCredential {
  const v = object(value);
  return (
    !!v &&
    v.version === 1 &&
    v.clientId === clientId &&
    typeof v.generation === "string" &&
    v.generation.length > 0 &&
    typeof v.accountId === "string" &&
    /^\d{1,30}$/.test(v.accountId) &&
    typeof v.accessToken === "string" &&
    v.accessToken.length > 0 &&
    v.accessToken.length <= 16384 &&
    Number.isSafeInteger(v.issuedAt) &&
    Number(v.issuedAt) <= now &&
    Number.isSafeInteger(v.expiresAt) &&
    Number(v.expiresAt) > now &&
    Number(v.expiresAt) > Number(v.issuedAt) &&
    Array.isArray(v.scopes) &&
    v.scopes.length <= 20 &&
    v.scopes.includes(YANDEX_SCOPE) &&
    v.scopes.every((scope: unknown) => typeof scope === "string" && scope.length < 256)
  );
}
export class EncryptedYandexVault implements YandexCredentialVault {
  constructor(
    private readonly backend: () => Promise<YandexLocalStore> = yandexLocalStore,
    private readonly now = Date.now
  ) {}
  async load(clientId: string): Promise<YandexCredential | undefined> {
    const backend = await this.backend(),
      sealed = object(await backend.read(id(clientId)));
    if (!sealed) return undefined;
    try {
      if (
        sealed.version !== 1 ||
        !(sealed.iv instanceof Uint8Array) ||
        sealed.iv.length !== 12 ||
        !(sealed.data instanceof ArrayBuffer) ||
        sealed.data.byteLength > 65536
      )
        return undefined;
      const bytes = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(sealed.iv), additionalData: aad(clientId) },
        await backend.key(),
        sealed.data
      );
      const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
      return validCredential(value, clientId, this.now()) && value.generation === sealed.generation
        ? value
        : undefined;
    } catch {
      return undefined;
    }
  }
  async save(credential: YandexCredential, signal: AbortSignal): Promise<void> {
    if (!validCredential(credential, credential.clientId, this.now()))
      throw new YandexError("auth-required");
    const backend = await this.backend(),
      iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(credential.clientId) },
      await backend.key(),
      new TextEncoder().encode(JSON.stringify(credential))
    );
    signal.throwIfAborted();
    await backend.write(
      id(credential.clientId),
      { version: 1, generation: credential.generation, iv, data },
      signal
    );
  }
  async remove(clientId: string, generation?: string): Promise<void> {
    const backend = await this.backend();
    await backend.remove(id(clientId), undefined, generation);
  }
}

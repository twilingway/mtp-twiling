import { DRIVE_CLIENT_ID, DRIVE_SCOPE } from "./types.js";
import { driveCredentialId } from "./auth-credential-id.js";

export interface DriveCredential {
  version: 1;
  credentialId: string;
  owner: string;
  clientId: string;
  token: string;
  issuedAt: number;
  expiresAt: number;
  scopes: string[];
}
export interface DriveAuthVault {
  load(owner: string, clientId: string): Promise<DriveCredential | undefined>;
  save(credential: DriveCredential, signal: AbortSignal): Promise<void>;
  remove(owner: string, clientId: string, credentialId?: string): Promise<void>;
}
export interface AuthVaultBackend {
  key(): Promise<CryptoKey>;
  read(id: string): Promise<unknown>;
  write(record: object, signal: AbortSignal): Promise<void>;
  remove(id: string, credentialId?: string): Promise<void>;
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const aad = (owner: string, clientId: string) =>
  new TextEncoder().encode(JSON.stringify(["mtp-drive-auth-v1", owner, clientId, DRIVE_SCOPE]));

async function localBackend(): Promise<AuthVaultBackend> {
  const storage = await import("../storage-db.js"),
    { deviceKey } = await import("../storage.js");
  return {
    key: deviceKey,
    read: (key) => storage.get("vault", key),
    write: (value, signal) =>
      storage.transaction(
        ["vault"],
        (tx) => {
          tx.objectStore("vault").put(value);
        },
        signal
      ),
    remove: (key, credentialId) =>
      storage.transaction(["vault"], (tx) => {
        const store = tx.objectStore("vault"),
          request = store.get(key);
        request.onsuccess = () => {
          if (!credentialId || record(request.result)?.credentialId === credentialId)
            store.delete(key);
        };
      })
  };
}
export function validDriveCredential(
  value: unknown,
  owner: string,
  clientId: string,
  now: number
): value is DriveCredential {
  const v = record(value);
  return (
    !!v &&
    v.version === 1 &&
    typeof v.credentialId === "string" &&
    !!v.credentialId &&
    !!owner &&
    v.owner === owner &&
    v.clientId === clientId &&
    typeof v.token === "string" &&
    v.token.length > 0 &&
    v.token.length <= 16384 &&
    typeof v.issuedAt === "number" &&
    Number.isSafeInteger(v.issuedAt) &&
    v.issuedAt <= now &&
    typeof v.expiresAt === "number" &&
    Number.isSafeInteger(v.expiresAt) &&
    v.expiresAt > now &&
    v.expiresAt > v.issuedAt &&
    v.expiresAt - v.issuedAt <= 86400000 &&
    Array.isArray(v.scopes) &&
    v.scopes.length <= 100 &&
    v.scopes.every((scope: unknown) => typeof scope === "string" && scope.length <= 2048) &&
    v.scopes.includes(DRIVE_SCOPE)
  );
}

/** The only credential persistence path. This store is never part of portable backups. */
export class EncryptedDriveAuthVault implements DriveAuthVault {
  constructor(
    private readonly backend = localBackend,
    private readonly now = Date.now
  ) {}

  async load(owner: string, clientId = DRIVE_CLIENT_ID): Promise<DriveCredential | undefined> {
    if (!owner) return undefined;
    const backend = await this.backend(),
      key = driveCredentialId(owner, clientId),
      sealed = record(await backend.read(key));
    if (!sealed) return undefined;
    try {
      if (
        sealed.version !== 1 ||
        !(sealed.iv instanceof Uint8Array) ||
        sealed.iv.length !== 12 ||
        !(sealed.data instanceof ArrayBuffer) ||
        sealed.data.byteLength > 65536
      )
        throw new Error("Invalid encrypted Google credential.");
      const data = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(sealed.iv), additionalData: aad(owner, clientId) },
        await backend.key(),
        sealed.data
      );
      const value: unknown = JSON.parse(new TextDecoder().decode(data));
      if (
        !validDriveCredential(value, owner, clientId, this.now()) ||
        value.credentialId !== sealed.credentialId
      )
        throw new Error("Invalid Google credential binding or expiry.");
      return value;
    } catch {
      // A malformed record without a generation cannot safely delete a concurrent new save.
      if (typeof sealed.credentialId === "string" && sealed.credentialId)
        await backend.remove(key, sealed.credentialId);
      return undefined;
    }
  }
  async save(credential: DriveCredential, signal: AbortSignal): Promise<void> {
    if (!validDriveCredential(credential, credential.owner, credential.clientId, this.now()))
      throw new Error("Invalid Google credential.");
    const backend = await this.backend(),
      iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(credential.owner, credential.clientId) },
      await backend.key(),
      new TextEncoder().encode(JSON.stringify(credential))
    );
    if (signal.aborted) throw new DOMException("Google credential save cancelled.", "AbortError");
    await backend.write(
      {
        id: driveCredentialId(credential.owner, credential.clientId),
        version: 1,
        credentialId: credential.credentialId,
        iv,
        data
      },
      signal
    );
  }
  async remove(owner: string, clientId: string, credentialId?: string): Promise<void> {
    if (owner)
      await (await this.backend()).remove(driveCredentialId(owner, clientId), credentialId);
  }
}

import { DRIVE_CLIENT_ID, DRIVE_SCOPE, DriveError } from "./types.js";
import type { DriveAuthorization } from "./types.js";
import { EncryptedDriveAuthVault } from "./auth-vault.js";
import type { DriveAuthVault, DriveCredential } from "./auth-vault.js";

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
}
export interface GoogleIdentityOAuth {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    include_granted_scopes: false;
    callback(response: TokenResponse): void;
    error_callback(error: { type?: string }): void;
  }): { requestAccessToken(config: { prompt: "select_account" }): void };
  revoke(token: string, done: (response: { successful: boolean }) => void): void;
}
type IdentityWindow = Window & { google?: { accounts?: { oauth2?: GoogleIdentityOAuth } } };
let loading: Promise<GoogleIdentityOAuth> | undefined;
export function loadGoogleIdentity(): Promise<GoogleIdentityOAuth> {
  const identity = (window as IdentityWindow).google?.accounts?.oauth2;
  if (identity) return Promise.resolve(identity);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    const timer = setTimeout(fail, 20000);
    function fail() {
      clearTimeout(timer);
      script.remove();
      loading = undefined;
      reject(new DriveError("network", "Не удалось загрузить авторизацию Google."));
    }
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timer);
      const loaded = (window as IdentityWindow).google?.accounts?.oauth2;
      if (loaded) resolve(loaded);
      else fail();
    };
    document.head.append(script);
  });
  return loading;
}

export class DriveAuth {
  private sdk: GoogleIdentityOAuth | undefined;
  private credential: DriveCredential | undefined;
  private owner = "";
  private epoch = 0;
  private controller = new AbortController();
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private popupTimer: ReturnType<typeof setTimeout> | undefined;
  private pending:
    { resolve(value: DriveAuthorization): void; reject(error: DriveError): void } | undefined;

  constructor(
    private readonly loader = loadGoogleIdentity,
    private readonly now = Date.now,
    private readonly vault: DriveAuthVault = new EncryptedDriveAuthVault()
  ) {}

  async prepare(): Promise<void> {
    if (this.sdk) return;
    this.sdk = await this.loader();
  }

  /** Call directly inside a click handler, after prepare() has completed. */
  connectFromUserGesture(owner: string): Promise<DriveAuthorization> {
    if (!this.sdk)
      return Promise.reject(new DriveError("not-ready", "Авторизация Google ещё загружается."));
    if (this.pending)
      return Promise.reject(new DriveError("busy", "Подключение Google уже выполняется."));
    if (!owner)
      return Promise.reject(new DriveError("auth-required", "Подключите банковский профиль."));
    this.suspend();
    this.owner = owner;
    const epoch = this.epoch;
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.popupTimer = setTimeout(
        () => this.fail("auth-cancelled", "Время подключения Google истекло."),
        120000
      );
      try {
        const client = this.sdk?.initTokenClient({
          client_id: DRIVE_CLIENT_ID,
          scope: DRIVE_SCOPE,
          include_granted_scopes: false,
          callback: (response) => {
            if (epoch === this.epoch) void this.accept(response, epoch);
          },
          error_callback: () => {
            if (epoch === this.epoch) this.fail("auth-cancelled", "Подключение Google отменено.");
          }
        });
        client?.requestAccessToken({ prompt: "select_account" });
      } catch {
        this.fail("auth-cancelled", "Не удалось открыть окно Google.");
      }
    });
  }

  /** Restores only a still-valid local credential. Never loads GIS or opens OAuth. */
  async restore(owner: string): Promise<DriveAuthorization | undefined> {
    this.suspend();
    this.owner = owner;
    const epoch = this.epoch;
    let credential: DriveCredential | undefined;
    try {
      credential = await this.vault.load(owner, DRIVE_CLIENT_ID);
    } catch {
      return undefined;
    }
    if (epoch !== this.epoch || !credential) return undefined;
    this.install(credential);
    return this.authorization(epoch, true, false);
  }

  private async accept(response: TokenResponse, epoch: number): Promise<void> {
    if (!this.pending) return;
    const seconds = Number(response.expires_in);
    if (
      response.error ||
      !response.access_token ||
      !response.scope?.split(/\s+/).includes(DRIVE_SCOPE) ||
      !Number.isFinite(seconds) ||
      seconds <= 30 ||
      seconds > 86400
    ) {
      this.fail("auth-required", "Google не предоставил доступ к данным приложения.");
      return;
    }
    clearTimeout(this.popupTimer);
    this.popupTimer = undefined;
    const issuedAt = this.now(),
      credential: DriveCredential = {
        version: 1,
        credentialId: crypto.randomUUID(),
        owner: this.owner,
        clientId: DRIVE_CLIENT_ID,
        token: response.access_token,
        issuedAt,
        expiresAt: Math.floor(issuedAt + (seconds - 30) * 1000),
        scopes: [...new Set(response.scope.split(/\s+/).filter(Boolean))]
      };
    this.install(credential);
    let stored = false;
    try {
      await this.vault.remove(credential.owner, credential.clientId);
      if (epoch !== this.epoch) return;
      await this.vault.save(credential, this.controller.signal);
      stored = true;
    } catch {
      /* A usable current session must survive unavailable device storage. */
    }
    if (epoch !== this.epoch || !this.pending) return;
    const pending = this.pending;
    this.pending = undefined;
    pending.resolve(this.authorization(epoch, stored, !stored));
  }
  private install(credential: DriveCredential): void {
    this.credential = credential;
    this.expiryTimer = setTimeout(
      () => this.expire(),
      Math.max(0, credential.expiresAt - this.now())
    );
  }
  private authorization(
    epoch: number,
    stored: boolean,
    persistenceError: boolean
  ): DriveAuthorization {
    return {
      connectionId: crypto.randomUUID(),
      signal: this.controller.signal,
      stored,
      persistenceError,
      getAccessToken: () => {
        if (epoch !== this.epoch || !this.credential || this.now() >= this.credential.expiresAt) {
          if (epoch === this.epoch) this.expire();
          throw new DriveError("auth-required", "Подключите Google Диск повторно.");
        }
        return this.credential.token;
      },
      invalidate: () => {
        if (epoch === this.epoch) this.expire();
      }
    };
  }

  private fail(code: "auth-required" | "auth-cancelled", message: string): void {
    const pending = this.pending;
    this.pending = undefined;
    this.reset();
    pending?.reject(new DriveError(code, message));
  }

  private expire(): void {
    const credential = this.credential,
      pending = this.pending;
    this.pending = undefined;
    this.reset();
    pending?.reject(new DriveError("auth-required", "Войдите в Google повторно."));
    if (credential)
      void this.vault
        .remove(credential.owner, credential.clientId, credential.credentialId)
        .catch(() => {});
  }
  private reset(): void {
    clearTimeout(this.expiryTimer);
    clearTimeout(this.popupTimer);
    this.popupTimer = undefined;
    this.expiryTimer = undefined;
    this.credential = undefined;
    this.epoch++;
    this.controller.abort();
    this.controller = new AbortController();
  }

  /** Page teardown/profile suspension aborts handles without forgetting a valid saved token. */
  suspend(): void {
    const pending = this.pending;
    this.pending = undefined;
    this.reset();
    pending?.reject(new DriveError("auth-cancelled", "Google Диск приостановлен."));
  }

  /** Stop this lease and forget only its owner's saved credential. */
  async forgetOwner(owner: string): Promise<void> {
    this.suspend();
    await this.vault.remove(owner, DRIVE_CLIENT_ID);
  }

  /** revoke=true is reserved for a separate explicit user action. */
  async disconnect(revoke = false): Promise<void> {
    const token = this.credential?.token,
      owner = this.owner;
    this.suspend();
    await this.vault.remove(owner, DRIVE_CLIENT_ID);
    if (revoke && token) {
      const sdk = this.sdk ?? (await this.loader());
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new DriveError("network", "Отзыв доступа Google не подтверждён.")),
          10000
        );
        sdk.revoke(token, (response) => {
          clearTimeout(timer);
          if (response.successful) resolve();
          else reject(new DriveError("permission", "Google не подтвердил отзыв доступа."));
        });
      });
    }
  }
}

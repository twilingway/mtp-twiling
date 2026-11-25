import { DRIVE_CLIENT_ID, DRIVE_SCOPE, DriveError } from "./types.js";
import type { DriveAuthorization } from "./types.js";

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
  private token: string | undefined;
  private expiresAt = 0;
  private epoch = 0;
  private controller = new AbortController();
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private popupTimer: ReturnType<typeof setTimeout> | undefined;
  private pending:
    { resolve(value: DriveAuthorization): void; reject(error: DriveError): void } | undefined;

  constructor(
    private readonly loader = loadGoogleIdentity,
    private readonly now = Date.now
  ) {}

  async prepare(): Promise<void> {
    if (this.sdk) return;
    this.sdk = await this.loader();
  }

  /** Call directly inside a click handler, after prepare() has completed. */
  connectFromUserGesture(): Promise<DriveAuthorization> {
    if (!this.sdk)
      return Promise.reject(new DriveError("not-ready", "Авторизация Google ещё загружается."));
    if (this.pending)
      return Promise.reject(new DriveError("busy", "Подключение Google уже выполняется."));
    this.clear();
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
            if (epoch === this.epoch) this.accept(response);
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

  private accept(response: TokenResponse): void {
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
    this.token = response.access_token;
    clearTimeout(this.popupTimer);
    this.popupTimer = undefined;
    this.expiresAt = this.now() + (seconds - 30) * 1000;
    this.expiryTimer = setTimeout(() => this.clear(), (seconds - 30) * 1000);
    const epoch = this.epoch;
    const authorization: DriveAuthorization = {
      connectionId: crypto.randomUUID(),
      signal: this.controller.signal,
      getAccessToken: () => {
        if (epoch !== this.epoch || !this.token || this.now() >= this.expiresAt) {
          if (epoch === this.epoch) this.clear();
          throw new DriveError("auth-required", "Подключите Google Диск повторно.");
        }
        return this.token;
      },
      invalidate: () => {
        if (epoch === this.epoch) this.clear();
      }
    };
    const pending = this.pending;
    this.pending = undefined;
    pending.resolve(authorization);
  }

  private fail(code: "auth-required" | "auth-cancelled", message: string): void {
    const pending = this.pending;
    this.pending = undefined;
    this.clear();
    pending?.reject(new DriveError(code, message));
  }

  private clear(): void {
    clearTimeout(this.expiryTimer);
    clearTimeout(this.popupTimer);
    this.popupTimer = undefined;
    this.expiryTimer = undefined;
    this.token = undefined;
    this.expiresAt = 0;
    this.epoch++;
    this.controller.abort();
    this.controller = new AbortController();
  }

  /** revoke=true is reserved for a separate explicit user action. */
  async disconnect(revoke = false): Promise<void> {
    const token = this.token;
    this.fail("auth-cancelled", "Google Диск отключён.");
    if (revoke && token && this.sdk) {
      const sdk = this.sdk;
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

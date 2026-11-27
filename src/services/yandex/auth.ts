import { EncryptedYandexVault } from "./auth-vault.js";
import type { YandexCredential, YandexCredentialVault } from "./auth-vault.js";
import { object, validateYandexConfig, YANDEX_SCOPE, YandexError } from "./types.js";
import type { YandexAuthorization, YandexPublicConfig } from "./types.js";

const ATTEMPT = "mtp:yandex:pkce:v1";
const ATTEMPT_TTL = 10 * 60 * 1000;
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
export interface YandexAuthEnvironment {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  url(): string;
  cleanUrl(url: string): void;
  navigate(url: string): void;
  fetch: typeof fetch;
  now(): number;
}
const browser = (): YandexAuthEnvironment => ({
  storage: sessionStorage,
  url: () => location.href,
  cleanUrl: (url) => history.replaceState(null, "", url),
  navigate: (url) => location.assign(url),
  fetch: fetch.bind(globalThis),
  now: Date.now
});
export class YandexAuth {
  private controller = new AbortController();
  private credential: YandexCredential | undefined;
  private epoch = 0;
  constructor(
    private readonly config: YandexPublicConfig | undefined,
    private readonly vault: YandexCredentialVault = new EncryptedYandexVault(),
    private readonly environment: () => YandexAuthEnvironment = browser
  ) {}
  suspend(cancelAttempt = false): void {
    this.epoch++;
    this.controller.abort();
    this.controller = new AbortController();
    this.credential = undefined;
    if (cancelAttempt) this.environment().storage.removeItem(ATTEMPT);
  }
  async begin(): Promise<void> {
    const config = validateYandexConfig(this.config),
      env = this.environment();
    this.suspend(true);
    const epoch = this.epoch,
      verifier = base64url(crypto.getRandomValues(new Uint8Array(32))),
      state = base64url(crypto.getRandomValues(new Uint8Array(32))),
      digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    if (epoch !== this.epoch) throw new YandexError("auth-cancelled");
    try {
      env.storage.setItem(
        ATTEMPT,
        JSON.stringify({
          clientId: config.clientId,
          redirectUri: config.redirectUri,
          state,
          verifier,
          createdAt: env.now()
        })
      );
    } catch {
      throw new YandexError("local-save");
    }
    const url = new URL("https://oauth.yandex.ru/authorize");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: YANDEX_SCOPE,
      state,
      code_challenge: base64url(new Uint8Array(digest)),
      code_challenge_method: "S256",
      force_confirm: "yes"
    }).toString();
    env.navigate(url.href);
  }
  async restore(): Promise<YandexAuthorization | undefined> {
    const config = validateYandexConfig(this.config);
    this.suspend();
    const epoch = this.epoch,
      credential = await this.vault.load(config.clientId);
    if (epoch !== this.epoch) return undefined;
    if (!credential) return undefined;
    return this.activate(credential, true, false);
  }
  async completeCallback(): Promise<YandexAuthorization | undefined> {
    const config = validateYandexConfig(this.config),
      env = this.environment(),
      url = new URL(env.url());
    if (url.origin + url.pathname !== config.redirectUri) return undefined;
    const code = url.searchParams.get("code"),
      state = url.searchParams.get("state"),
      error = url.searchParams.get("error");
    if (!code && !error) return undefined;
    const raw = env.storage.getItem(ATTEMPT);
    env.storage.removeItem(ATTEMPT);
    env.cleanUrl(config.redirectUri);
    let attempt: Record<string, unknown> | undefined;
    try {
      attempt = object(JSON.parse(raw ?? "null"));
    } catch {
      /* Invalid attempts fail closed. */
    }
    if (
      !attempt ||
      attempt.clientId !== config.clientId ||
      attempt.redirectUri !== config.redirectUri ||
      typeof attempt.state !== "string" ||
      !/^[\w-]{43}$/.test(attempt.state) ||
      attempt.state !== state ||
      typeof attempt.verifier !== "string" ||
      !/^[\w-]{43,128}$/.test(attempt.verifier) ||
      !Number.isSafeInteger(attempt.createdAt) ||
      Number(attempt.createdAt) > env.now() ||
      env.now() - Number(attempt.createdAt) > ATTEMPT_TTL ||
      error ||
      !code ||
      code.length > 4096 ||
      url.searchParams.getAll("code").length !== 1 ||
      url.searchParams.getAll("state").length !== 1
    )
      throw new YandexError("auth-cancelled");
    this.suspend();
    const epoch = this.epoch,
      signal = this.controller.signal;
    const issuedAt = env.now();
    const token = object(
      await this.json(
        "https://oauth.yandex.ru/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: config.clientId,
            code,
            code_verifier: attempt.verifier
          })
        },
        signal
      )
    );
    if (
      !token ||
      typeof token.access_token !== "string" ||
      !token.access_token ||
      token.access_token.length > 16384 ||
      token.token_type !== "bearer" ||
      !Number.isSafeInteger(token.expires_in) ||
      Number(token.expires_in) <= 0 ||
      Number(token.expires_in) > (Number.MAX_SAFE_INTEGER - env.now()) / 1000
    )
      throw new YandexError("auth-required");
    const scopes = typeof token.scope === "string" ? token.scope.split(" ") : [YANDEX_SCOPE];
    if (!scopes.includes(YANDEX_SCOPE)) throw new YandexError("permission");
    const account = object(
      await this.json(
        "https://login.yandex.ru/info?format=json",
        {
          headers: { Authorization: `OAuth ${token.access_token}` }
        },
        signal
      )
    );
    if (
      !account ||
      typeof account.id !== "string" ||
      !/^\d{1,30}$/.test(account.id) ||
      account.client_id !== config.clientId
    )
      throw new YandexError("auth-required");
    const credential: YandexCredential = {
      version: 1,
      generation: crypto.randomUUID(),
      clientId: config.clientId,
      accountId: account.id,
      accessToken: token.access_token,
      issuedAt,
      expiresAt: issuedAt + Number(token.expires_in) * 1000,
      scopes
    };
    signal.throwIfAborted();
    if (env.now() >= credential.expiresAt) throw new YandexError("auth-required");
    if (epoch !== this.epoch) throw new YandexError("auth-cancelled");
    let stored = true;
    try {
      await this.vault.save(credential, signal);
    } catch {
      signal.throwIfAborted();
      stored = false;
    }
    signal.throwIfAborted();
    return this.activate(credential, stored, !stored);
  }
  async disconnect(expectedGeneration?: string): Promise<void> {
    const generation = expectedGeneration ?? this.credential?.generation;
    this.suspend(true);
    if (this.config && generation) await this.vault.remove(this.config.clientId, generation);
  }
  private activate(
    credential: YandexCredential,
    stored: boolean,
    persistenceError: boolean
  ): YandexAuthorization {
    this.credential = credential;
    const epoch = this.epoch,
      signal = this.controller.signal;
    return Object.freeze({
      connectionId: crypto.randomUUID(),
      credentialGeneration: credential.generation,
      accountId: credential.accountId,
      signal,
      stored,
      persistenceError,
      getAccessToken: () => {
        if (
          signal.aborted ||
          epoch !== this.epoch ||
          !this.credential ||
          this.environment().now() >= credential.expiresAt
        )
          throw new YandexError("auth-required");
        return credential.accessToken;
      },
      invalidate: () => {
        if (epoch === this.epoch) {
          this.suspend();
          void this.vault.remove(credential.clientId, credential.generation).catch(() => undefined);
        }
      }
    });
  }
  private async json(url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    const deadline = AbortSignal.timeout(20000);
    try {
      const response = await this.environment().fetch(url, {
        ...init,
        signal: AbortSignal.any([signal, deadline]),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer"
      });
      if (!response.ok)
        throw new YandexError(response.status === 401 ? "auth-required" : "network");
      if (Number(response.headers.get("Content-Length")) > 65536) throw new YandexError("limit");
      const reader = response.body?.getReader();
      if (!reader) throw new YandexError("remote-invalid");
      let total = 0;
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      try {
        for (;;) {
          const next = await reader.read();
          signal.throwIfAborted();
          if (next.done) break;
          total += next.value.byteLength;
          if (total > 65536) throw new YandexError("limit");
          chunks.push(new Uint8Array(next.value));
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      return JSON.parse(await new Blob(chunks).text()) as unknown;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof YandexError) throw error;
      throw new YandexError("network");
    }
  }
}

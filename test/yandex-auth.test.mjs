import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader, config, deferred, localBackend } from "./helpers/yandex-source.mjs";

const load = sourceLoader(),
  { YandexAuth } = load("services/yandex/auth.ts"),
  { EncryptedYandexVault } = load("services/yandex/auth-vault.ts"),
  { YANDEX_SCOPE, validateYandexConfig } = load("services/yandex/types.ts");
function environment() {
  const values = new Map(),
    calls = [];
  let url = "http://localhost:5290/__dev/app/",
    now = 1000000;
  const env = {
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key)
    },
    url: () => url,
    cleanUrl: (value) => {
      url = value;
    },
    navigate: (value) => {
      url = value;
    },
    now: () => now,
    fetch: async (target, init) => {
      calls.push({ target, init });
      if (target.endsWith("/token"))
        return Response.json({
          access_token: "unit-yandex-access",
          token_type: "bearer",
          expires_in: 3600 * 24 * 365,
          scope: YANDEX_SCOPE
        });
      return Response.json({ id: "123", client_id: config.clientId });
    }
  };
  return {
    env,
    values,
    calls,
    setUrl: (value) => {
      url = value;
    },
    advance: (value) => {
      now += value;
    }
  };
}
async function started() {
  const f = environment(),
    backend = await localBackend(),
    vault = new EncryptedYandexVault(async () => backend, f.env.now),
    auth = new YandexAuth(config, vault, () => f.env);
  await auth.begin();
  const authorize = new URL(f.env.url()),
    callback = `${config.redirectUri}?code=unit-code&state=${authorize.searchParams.get("state")}`;
  f.setUrl(callback);
  return { ...f, backend, vault, auth, authorize, callback };
}
test("public config only allows exact safe callback paths and loopback HTTP", () => {
  assert.deepEqual(validateYandexConfig(config), config);
  assert.equal(
    validateYandexConfig({
      ...config,
      redirectUri: config.redirectUri.replace("localhost", "127.0.0.1")
    }).redirectUri.includes("127.0.0.1"),
    true
  );
  for (const value of [
    undefined,
    { ...config, clientId: config.clientId + "d" },
    { ...config, redirectUri: "http://example.org/yandex-callback.html" },
    { ...config, redirectUri: config.redirectUri + "?leak=1" }
  ])
    assert.throws(
      () => validateYandexConfig(value),
      (error) => error.code === "configuration-required"
    );
});
test("PKCE survives reload, consumes callback once, binds account, persists real encrypted credential without hourly lifetime cap", async () => {
  const f = await started(),
    attempt = JSON.parse([...f.values.values()][0]);
  assert.equal(f.authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(f.authorize.searchParams.get("scope"), YANDEX_SCOPE);
  assert.equal(f.authorize.searchParams.has("client_secret"), false);
  const expected = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(attempt.verifier))
  ).toString("base64url");
  assert.equal(f.authorize.searchParams.get("code_challenge"), expected);
  const reloaded = new YandexAuth(config, f.vault, () => f.env),
    result = await reloaded.completeCallback();
  assert.equal(result.accountId, "123");
  assert.equal(result.stored, true);
  assert.equal(f.env.url(), config.redirectUri);
  assert.equal(f.values.size, 0);
  assert.equal(f.calls[0].init.body.has("client_secret"), false);
  assert.equal(f.calls[0].init.body.get("code_verifier"), attempt.verifier);
  assert.equal(f.calls[1].init.headers.Authorization, "OAuth unit-yandex-access");
  assert.equal([...f.backend.records.values()][0].accessToken, undefined);
  assert.equal(
    JSON.stringify([...f.backend.records.values()]).includes("unit-yandex-access"),
    false
  );
  const stored = await f.vault.load(config.clientId);
  assert.ok(stored.expiresAt - stored.issuedAt > 86400000);
  const originalExpiry = stored.expiresAt;
  reloaded.suspend();
  f.advance(3600000);
  const restored = await new YandexAuth(config, f.vault, () => f.env).restore();
  assert.equal(restored.getAccessToken(), "unit-yandex-access");
  assert.equal(f.calls.length, 2);
  assert.equal((await f.vault.load(config.clientId)).expiresAt, originalExpiry);
  f.setUrl(f.callback);
  await assert.rejects(reloaded.completeCallback(), (error) => error.code === "auth-cancelled");
  assert.equal(f.calls.length, 2);
});
test("mismatched, duplicated, expired and future state fail before network and remove callback query", async () => {
  for (const mutate of [
    (f) => f.setUrl(f.callback.replace("state=", "state=wrong")),
    (f) => f.setUrl(f.callback + "&code=second"),
    (f) => f.advance(600001),
    (f) => f.advance(-1)
  ]) {
    const f = await started();
    mutate(f);
    await assert.rejects(f.auth.completeCallback(), (error) => error.code === "auth-cancelled");
    assert.equal(f.calls.length, 0);
    assert.equal(f.env.url(), config.redirectUri);
    assert.equal(f.values.size, 0);
  }
});
test("cancel after callback request ignores late token response and never stores credentials", async () => {
  const f = await started(),
    wait = deferred();
  f.env.fetch = async () => wait.promise;
  const pending = f.auth.completeCallback();
  await new Promise(setImmediate);
  f.auth.suspend(true);
  wait.resolve(
    Response.json({ access_token: "unit-yandex-access", token_type: "bearer", expires_in: 3600 })
  );
  await assert.rejects(pending);
  assert.equal(f.backend.records.size, 0);
});
test("account client binding and returned scopes are verified before persistence", async () => {
  for (const response of [
    { id: "123", client_id: "wrong" },
    { id: 123, client_id: config.clientId }
  ]) {
    const f = await started(),
      original = f.env.fetch;
    f.env.fetch = async (url, init) =>
      url.includes("login.yandex") ? Response.json(response) : original(url, init);
    await assert.rejects(f.auth.completeCallback(), (error) => error.code === "auth-required");
    assert.equal(f.backend.records.size, 0);
  }
});
test("vault detects ciphertext mutation, cross-client substitution and expires without extending token", async () => {
  const f = await started();
  await f.auth.completeCallback();
  const [key, value] = [...f.backend.records][0];
  const copied = structuredClone(value);
  new Uint8Array(copied.data)[0] ^= 1;
  f.backend.records.set(key, copied);
  assert.equal(await f.vault.load(config.clientId), undefined);
  f.backend.records.set(key, value);
  f.advance(366 * 86400000);
  assert.equal(await f.vault.load(config.clientId), undefined);
});
test("credential save error is visible while in-memory authorization remains usable", async () => {
  const f = await started();
  f.backend.write = async () => {
    throw new Error("quota");
  };
  const result = await f.auth.completeCallback();
  assert.equal(result.persistenceError, true);
  assert.equal(result.stored, false);
  assert.equal(result.getAccessToken(), "unit-yandex-access");
});

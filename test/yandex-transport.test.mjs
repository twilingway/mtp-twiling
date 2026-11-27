import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader, authorization } from "./helpers/yandex-source.mjs";
import { diskFixture, metadata } from "./helpers/yandex-disk.mjs";

const load = sourceLoader(),
  { YandexTransport } = load("services/yandex/transport.ts"),
  { sha256 } = load("services/yandex/types.ts");
const name = `${crypto.randomUUID()}_${crypto.randomUUID()}.mtp`;
test("immutable upload uses app-folder, no uploader OAuth, verified bytes and same-path idempotence", async () => {
  const f = diskFixture(),
    body = new Blob(["settings"]),
    ref = { size: body.size, sha256: await sha256(body) };
  await f.transport.putImmutable(name, body, ref);
  await f.transport.putImmutable(name, body, ref);
  assert.equal(f.puts(), 1);
  assert.equal((await f.transport.list()).length, 1);
  for (const { url } of f.calls.filter(({ url }) => url.hostname === "cloud-api.yandex.net"))
    assert.ok(url.searchParams.get("path").startsWith("app:/mtp-yandex-v1"));
  assert.equal(
    f.calls.some(({ url }) => url.searchParams.get("overwrite") === "true"),
    false
  );
});
test("lost PUT response reconciles written bytes without repeating PUT", async () => {
  const f = diskFixture(),
    body = new Blob(["lost reply"]);
  f.hooks.afterPut = () => {
    throw new Error("connection dropped");
  };
  await f.transport.putImmutable(name, body, { size: body.size, sha256: await sha256(body) });
  assert.equal(f.puts(), 1);
});
test("202 is only accepted after exact readback; missing completed file remains indeterminate", async () => {
  const f = diskFixture(),
    body = new Blob(["accepted"]);
  f.hooks.afterPut = () => new Response(null, { status: 202 });
  await f.transport.putImmutable(name, body, { size: body.size, sha256: await sha256(body) });
  const g = diskFixture();
  g.hooks.afterPut = () => {
    g.files.clear();
    return new Response(null, { status: 202 });
  };
  await assert.rejects(
    g.transport.putImmutable(name, body, { size: body.size, sha256: await sha256(body) }),
    (error) => error.code === "indeterminate"
  );
  assert.equal(g.puts(), 1);
});
test("existing different bytes are conflict, never overwritten", async () => {
  const f = diskFixture(),
    body = new Blob(["one"]);
  f.files.set(name, new Blob(["two"]));
  await assert.rejects(
    f.transport.putImmutable(name, body, { size: body.size, sha256: await sha256(body) }),
    (error) => error.code === "conflict"
  );
  assert.equal(f.puts(), 0);
});
test("unexpected transfer host is rejected before disclosing authorization or content", async () => {
  const f = diskFixture(),
    original = f.fetcher;
  const transport = new YandexTransport(f.auth, {
    fetch: async (target, init) =>
      new URL(target).pathname.endsWith("/upload")
        ? Response.json({
            href: "https://attacker.invalid/upload",
            method: "PUT",
            templated: false
          })
        : original(target, init),
    sleep: async () => {}
  });
  const body = new Blob(["one"]);
  await assert.rejects(
    transport.putImmutable(name, body, { size: body.size, sha256: await sha256(body) }),
    (error) => error.code === "remote-invalid"
  );
  assert.equal(f.puts(), 0);
});
test("bounded stream stops on bytes without Content-Length and idle deadline", async () => {
  const auth = authorization(),
    item = metadata(new Blob(["abc"]));
  const fetched = async (target) =>
    new URL(target).hostname === "cloud-api.yandex.net"
      ? Response.json({
          href: "https://downloader.dst.yandex.ru/disk/",
          method: "GET",
          templated: false
        })
      : new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(5));
              controller.close();
            }
          })
        );
  const transport = new YandexTransport(auth, { fetch: fetched, timeoutMs: 5 });
  await assert.rejects(transport.read(item, 3), (error) => error.code === "limit");
  const idle = new YandexTransport(auth, {
    fetch: async (target) =>
      new URL(target).hostname === "cloud-api.yandex.net"
        ? Response.json({
            href: "https://downloader.dst.yandex.ru/disk/",
            method: "GET",
            templated: false
          })
        : new Response(new ReadableStream()),
    timeoutMs: 5
  });
  await assert.rejects(idle.read(item, 3), (error) => error.code === "network");
});
test("401 invalidates just this authorization, directory disappearance mid-list is conflict", async () => {
  const auth = authorization(),
    transport = new YandexTransport(auth, {
      fetch: async () => new Response(null, { status: 401 })
    });
  await assert.rejects(transport.list(), (error) => error.code === "auth-required");
  assert.equal(auth.signal.aborted, true);
  let calls = 0;
  const list = new YandexTransport(authorization(), {
    fetch: async () =>
      ++calls === 1
        ? Response.json({ _embedded: { total: 2, items: [metadata(new Blob(["a"]))] } })
        : new Response(null, { status: 404 })
  });
  await assert.rejects(list.list(), (error) => error.code === "conflict");
});
test("probe cleanup rejects normal revisions and uses MD5 conditional parameter", async () => {
  const f = diskFixture(),
    body = new Blob(["test"]);
  await assert.rejects(
    f.transport.removeProbe(metadata(body)),
    (error) => error.code === "permission"
  );
  const probe = metadata(body, `probe_${crypto.randomUUID()}.mtp`);
  f.files.set(probe.name, body);
  await f.transport.removeProbe(probe);
  assert.equal(f.calls.at(-1).url.searchParams.get("md5"), probe.md5);
  assert.equal(f.calls.at(-1).url.searchParams.get("permanently"), "true");
});
test("synthetic diagnostic verifies binary bytes and returns no credentials/account/download href", async () => {
  const f = diskFixture(),
    { runYandexSyntheticProbe } = load("services/yandex/probe.ts");
  const result = await runYandexSyntheticProbe(
    f.auth,
    { fetch: f.fetcher, sleep: async () => {} },
    true
  );
  assert.equal(result.completed, true);
  assert.equal(result.binaryRoundtripVerified, true);
  assert.equal(result.cleanup, "removed");
  assert.equal(f.files.size, 0);
  assert.equal(JSON.stringify(result).includes("unit-yandex-access"), false);
  assert.equal(JSON.stringify(result).includes("https://"), false);
  assert.equal(Object.hasOwn(result, "accountId"), false);
});

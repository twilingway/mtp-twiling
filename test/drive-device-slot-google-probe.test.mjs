import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const { runDeviceSlotGoogleProbe, DeviceSlotGoogleProbeError } = sourceLoader()(
  "services/drive/device-slot-google-probe.ts"
);

const id = "generated-probe-test-id";
const token = "synthetic-test-token";
const validAuth = () => ({
  connectionId: "probe-test",
  signal: new AbortController().signal,
  getAccessToken: () => token,
  invalidate: () => assert.fail("the diagnostic must not alter the current authorization")
});

function google(options = {}) {
  let seed;
  let media;
  let sequence = 1;
  const calls = [];
  const responses = [];
  const tag = () => `"strong-${sequence}"`;
  const answer = (status, body = null, headers = {}) => {
    responses.push(status);
    return new Response(body, { status, headers });
  };
  let allowConditionalRequests;
  const both = new Promise((resolve) => {
    allowConditionalRequests = resolve;
  });
  const fetch = async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://www.googleapis.com");
    assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.equal(init.referrerPolicy, "no-referrer");
    init.signal.throwIfAborted();
    const headers = new Headers(init.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${token}`);
    const method = init.method ?? "GET";
    calls.push({ url, method, etag: headers.get("If-Match") });
    if (url.pathname === "/drive/v3/files/generateIds") {
      assert.equal(method, "GET");
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        count: "1",
        space: "appDataFolder",
        type: "files"
      });
      return answer(200, JSON.stringify({ ids: [options.id ?? id] }));
    }
    if (url.pathname === "/upload/drive/v3/files") {
      assert.equal(method, "POST");
      assert.equal(url.searchParams.get("uploadType"), "multipart");
      const boundary = /^multipart\/related; boundary=([\w-]+)$/.exec(
        headers.get("Content-Type")
      )[1];
      const parts = (await init.body.text()).split(`--${boundary}\r\n`);
      const data = (part) => part.slice(part.indexOf("\r\n\r\n") + 4);
      const fields = JSON.parse(data(parts[1]));
      const close = `\r\n--${boundary}--\r\n`;
      seed = data(parts[2]).slice(0, -close.length);
      media = seed;
      const envelope = JSON.parse(seed);
      assert.deepEqual(fields, {
        id,
        name: `mtp-drive-cas-probe-${envelope.current.workspaceId}.json`,
        parents: ["appDataFolder"],
        mimeType: "application/json",
        appProperties: {
          mtpNamespace: "mtp-drive-cas-probe",
          mtpKind: "synthetic-device-slot"
        }
      });
      assert.equal(envelope.current.seq, 1);
      assert.equal(envelope.previous, null);
      assert.ok(!seed.includes(token));
      if (options.createLost) throw new Error(`unsafe driver exception ${token}`);
      return answer(
        200,
        JSON.stringify({
          ...fields,
          size: String(Buffer.byteLength(seed)),
          ...(options.foreignNamespace && { appProperties: { mtpNamespace: "mtp-drive-v2" } })
        })
      );
    }
    if (url.pathname === `/drive/v3/files/${id}`) {
      assert.equal(method, "GET");
      assert.deepEqual(Object.fromEntries(url.searchParams), { alt: "media" });
      assert.equal(headers.has("If-Match"), false);
      return answer(200, media, options.hideTag ? {} : { ETag: tag() });
    }
    assert.equal(url.pathname, `/upload/drive/v3/files/${id}`);
    assert.equal(method, "PATCH");
    assert.deepEqual(Object.fromEntries(url.searchParams), { uploadType: "media" });
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.equal(headers.get("If-Match"), '"strong-1"');
    if (calls.filter((entry) => entry.method === "PATCH").length === 2) allowConditionalRequests();
    await both;
    if (headers.get("If-Match") !== tag()) return answer(412);
    const next = await init.body.text();
    // Check the precondition and update the file with no await between them.
    if (headers.get("If-Match") !== tag()) return answer(412);
    media = next;
    sequence++;
    return answer(204);
  };
  return { fetch, calls, responses, media: () => media };
}

test("Google probe creates one isolated synthetic file and passes through conditional HTTP results", async () => {
  const server = google();
  const result = await runDeviceSlotGoogleProbe(validAuth(), { fetch: server.fetch });
  assert.equal(result.fileId, id);
  assert.equal(result.loserStatus, 412);
  assert.equal(result.winner.etag, '"strong-2"');
  assert.equal(
    result.winner.envelopeHash,
    createHash("sha256").update(server.media()).digest("hex")
  );
  assert.equal(server.calls.filter(({ method }) => method === "POST").length, 1);
  assert.equal(server.calls.filter(({ method }) => method === "PATCH").length, 2);
  assert.equal(
    server.calls.some(({ method }) => method === "DELETE"),
    false
  );
  assert.equal(server.responses.filter((status) => status === 412).length, 1);
  assert.deepEqual(
    server.calls.map(({ method }) => method),
    ["GET", "POST", "GET", "PATCH", "PATCH", "GET", "GET"]
  );
  assert.ok(!JSON.stringify(result).includes(token));
});

test("a missing media ETag fails closed and preserves the synthetic file id", async () => {
  const server = google({ hideTag: true });
  await assert.rejects(
    runDeviceSlotGoogleProbe(validAuth(), { fetch: server.fetch }),
    (error) =>
      error instanceof DeviceSlotGoogleProbeError &&
      error.stage === "compare" &&
      error.fileId === id &&
      error.casIssue === "validator"
  );
  assert.deepEqual(
    server.calls.map(({ method }) => method),
    ["GET", "POST", "GET"]
  );
});

test("creation ambiguity preserves the reserved file id without replay or raw exceptions", async () => {
  const server = google({ createLost: true });
  await assert.rejects(runDeviceSlotGoogleProbe(validAuth(), { fetch: server.fetch }), (error) => {
    assert.ok(error instanceof DeviceSlotGoogleProbeError);
    assert.equal(error.stage, "create");
    assert.equal(error.fileId, id);
    assert.equal(error.code, "network");
    assert.ok(!String(error).includes(token));
    assert.ok(!JSON.stringify(error).includes(token));
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.deepEqual(
    server.calls.map(({ method }) => method),
    ["GET", "POST"]
  );
});

test("invalid generated ids and foreign metadata cannot become writable targets", async () => {
  for (const options of [{ id: "../untrusted-file" }, { foreignNamespace: true }]) {
    const server = google(options);
    await assert.rejects(runDeviceSlotGoogleProbe(validAuth(), { fetch: server.fetch }), {
      code: "remote-invalid",
      fileId: options.id ? undefined : id
    });
    assert.ok(server.calls.every(({ method }) => method !== "PATCH"));
    if (options.id)
      assert.deepEqual(
        server.calls.map(({ method }) => method),
        ["GET"]
      );
  }
});

test("an aborted or invalid authorization cannot cause a network request", async () => {
  const stop = new AbortController();
  stop.abort(token);
  const fetch = () => assert.fail("the probe must stop before fetch");
  await assert.rejects(runDeviceSlotGoogleProbe(validAuth(), { fetch, signal: stop.signal }), {
    code: "auth-cancelled",
    stage: "reserve"
  });
  const authorization = {
    ...validAuth(),
    getAccessToken: () => {
      throw new Error(token);
    }
  };
  await assert.rejects(
    runDeviceSlotGoogleProbe(authorization, { fetch }),
    (error) => error.code === "auth-required" && !String(error).includes(token)
  );
});

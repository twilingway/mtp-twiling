import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const { DeviceSlotHttp } = sourceLoader()("services/drive/device-slot-http.ts");
const id = "synthetic-validator-test";
const current = "media-new";
const old = "media-old";
const signal = new AbortController().signal;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const meta = (content, version, etag = `"v${version}"`) => ({
  id,
  version: String(version),
  etag,
  fileSize: String(Buffer.byteLength(content)),
  md5Checksum: createHash("md5").update(content).digest("hex"),
  sha256Checksum: digest(content)
});

function fixture(options) {
  let metaReads = 0;
  let mediaReads = 0;
  let puts = 0;
  const calls = [];
  const io = new DeviceSlotHttp(
    {
      signal: options.authSignal ?? signal,
      getAccessToken: () => "synthetic-readonly-token",
      invalidate: () => assert.fail("Unexpected auth invalidation")
    },
    async (input, init) => {
      const url = new URL(input);
      const headers = new Headers(init.headers);
      assert.equal(url.origin, "https://www.googleapis.com");
      assert.equal(init.cache, "no-store");
      assert.equal(init.credentials, "omit");
      assert.equal(init.redirect, "error");
      assert.equal(init.referrerPolicy, "no-referrer");
      assert.equal(headers.get("Authorization"), "Bearer synthetic-readonly-token");
      if (init.method === "PUT") {
        assert.equal(url.pathname, `/upload/drive/v2/files/${id}`);
        assert.equal(url.searchParams.get("uploadType"), "media");
        assert.equal(url.searchParams.has("newRevision"), false);
        assert.equal(headers.get("If-Match"), '"v1"');
        assert.equal(headers.get("Content-Type"), "application/octet-stream");
        assert.equal(await init.body.text(), current);
        calls.push("put");
        puts++;
        return options.replace();
      }
      if (url.pathname === `/drive/v2/files/${id}`) {
        assert.equal(
          url.searchParams.get("fields"),
          "id,etag,version,fileSize,md5Checksum,sha256Checksum"
        );
        calls.push("metadata");
        return options.metadata(metaReads++);
      }
      assert.equal(url.pathname, `/drive/v3/files/${id}`);
      assert.equal(url.searchParams.get("alt"), "media");
      calls.push("media");
      return options.media(mediaReads++);
    }
  );
  return { io, calls, puts: () => puts };
}

test("the full v3 media body is pinned by the coherent v2 JSON tag and server checksum", async () => {
  const { io, calls } = fixture({
    metadata: () => Response.json(meta(current, 2)),
    media: () => new Response(current)
  });
  const read = await io.read(id, signal);
  assert.equal(await read.body.text(), current);
  assert.equal(read.etag, '"v2"');
  assert.equal(read.metadata.version, "2");
  assert.deepEqual(calls, ["metadata", "media", "metadata"]);
});

test("prefix inspection retains its one media GET and cannot supply a write validator", async () => {
  const { io, calls } = fixture({
    metadata: () => assert.fail("Prefix inspection should use only the media request"),
    media: () => new Response(current)
  });
  const result = await io.read(id, signal, true);
  assert.equal(await result.body.text(), current);
  assert.equal(result.etag, null);
  assert.equal(result.metadata, undefined);
  assert.deepEqual(calls, ["media"]);
});

test("coherence retries a changed metadata version and same-length stale bytes without writing", async () => {
  const { io, calls, puts } = fixture({
    metadata: (index) => Response.json(index === 0 ? meta(old, 1) : meta(current, 2)),
    media: (index) => new Response(index < 2 ? old : current)
  });
  const read = await io.read(id, signal);
  assert.equal(await read.body.text(), current);
  assert.equal(read.etag, '"v2"');
  assert.deepEqual(
    calls,
    Array.from({ length: 3 }, () => ["metadata", "media", "metadata"]).flat()
  );
  assert.equal(puts(), 0);
});

test("stable fresh tags and MD5 cannot validate same-length stale media without SHA-256", async () => {
  const { io, calls, puts } = fixture({
    metadata: () => Response.json({ ...meta(current, 2), sha256Checksum: undefined }),
    media: () => new Response(old)
  });
  await assert.rejects(io.read(id, signal), { issue: "validator" });
  assert.deepEqual(calls, ["metadata", "metadata", "metadata"]);
  assert.equal(puts(), 0);
});

test("a temporarily missing checksum permits only a later completely verified attempt", async () => {
  const { io, calls } = fixture({
    metadata: (index) =>
      Response.json(
        index === 0 ? { ...meta(current, 2), sha256Checksum: undefined } : meta(current, 2)
      ),
    media: () => new Response(current)
  });
  const read = await io.read(id, signal);
  assert.equal(await read.body.text(), current);
  assert.equal(read.metadata.sha256Checksum, digest(current));
  assert.deepEqual(calls, ["metadata", "metadata", "media", "metadata"]);
});

test("a persistent media hash mismatch never yields a strong replacement validator", async () => {
  const { io, calls, puts } = fixture({
    metadata: () => Response.json(meta(current, 2)),
    media: () => new Response(old)
  });
  await assert.rejects(io.read(id, signal), { issue: "validator" });
  assert.equal(calls.filter((call) => call === "media").length, 3);
  assert.equal(puts(), 0);
});

test("a stable but wrong receipt version is retried and never accepted after three attempts", async () => {
  const { io, calls, puts } = fixture({
    metadata: () => Response.json(meta(old, 1)),
    media: () => new Response(old)
  });
  await assert.rejects(io.read(id, signal, false, { id, etag: '"v2"', size: current.length }), {
    code: "conflict"
  });
  assert.equal(calls.filter((call) => call === "media").length, 3);
  assert.equal(puts(), 0);
});

test("missing or weak v2 JSON tags and conflicting header tags stop before media download", async () => {
  for (const [body, headers] of [
    [{ ...meta(old, 1), etag: undefined }, { ETag: '"v1"' }],
    [meta(old, 1, 'W/"v1"'), {}],
    [meta(old, 1), { ETag: '"foreign"' }]
  ]) {
    const { io, calls } = fixture({
      metadata: () => Response.json(body, { headers }),
      media: () => assert.fail("An invalid validator must stop the read")
    });
    await assert.rejects(io.read(id, signal), { issue: "validator" });
    assert.deepEqual(calls, ["metadata"]);
  }
});

test("an aborted authorization stops a coherence retry", async () => {
  const auth = new AbortController();
  const { io, calls } = fixture({
    authSignal: auth.signal,
    metadata: () => Response.json(meta(current, 2)),
    media: () => {
      auth.abort();
      return new Response(current);
    }
  });
  await assert.rejects(io.read(id, signal), { name: "AbortError" });
  assert.deepEqual(calls, ["metadata", "media"]);
});

test("the v2 PUT keeps 412 and fails closed after an invalid success receipt", async () => {
  for (const [response, outcome] of [
    [new Response("synthetic stale acknowledgement", { status: 412 }), 412],
    [Response.json(meta(current, 2), { headers: { ETag: '"wrong"' } }), "unconfirmed"],
    [Response.json(meta(current, 1)), "unconfirmed"]
  ]) {
    const { io, calls } = fixture({ replace: () => response });
    const result = io.patch(id, '"v1"', new Blob([current]), signal);
    if (outcome === 412) {
      const returned = await result;
      assert.equal(returned.response.status, 412);
      assert.equal(returned.receipt, undefined);
    } else await assert.rejects(result, { issue: outcome });
    assert.deepEqual(calls, ["put"]);
  }
});

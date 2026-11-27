import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const {
  DeviceSlotCas,
  MAX_DEVICE_SLOT_ENVELOPE_BYTES,
  encodeDeviceSlotEnvelope,
  createDeviceSlotCasProbe,
  probeDeviceSlotCas
} = sourceLoader()("services/drive/device-slot-cas.ts");

const fileId = "disposable-device-slot-probe";
const sha256 = async (blob) =>
  createHash("sha256")
    .update(Buffer.from(await blob.arrayBuffer()))
    .digest("hex");
const issue = (expected) => (error) => error.issue === expected;

function fakeFile(initial, overrides = {}) {
  let body = initial;
  let version = 1;
  let writes = 0;
  const tag = () => `"version-${version}"`;
  const requests = [];
  const setBody = (next, changeTag = true) => {
    body = next;
    if (changeTag) version++;
  };
  const state = { setBody, tag, readBody: () => body, requests };
  async function request(id, options) {
    assert.equal(id, fileId);
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    options.signal.throwIfAborted();
    const headers = new Headers(options.headers);
    const entry = { method: options.method, ifMatch: headers.get("If-Match"), status: null };
    requests.push(entry);
    if (options.method === "GET") {
      const response = overrides.read?.(state) ?? new Response(body, { headers: { ETag: tag() } });
      entry.status = response.status;
      return response;
    }
    assert.equal(options.method, "PATCH");
    assert.ok(options.body instanceof Blob);
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.ok(entry.ifMatch);
    writes++;
    if (overrides.beforePatch) await overrides.beforePatch(entry, state);
    if (overrides.lose === "before") throw new TypeError("simulated network failure");
    if (!overrides.ignorePrecondition && entry.ifMatch !== tag()) {
      entry.status = 412;
      return new Response(null, { status: 412 });
    }
    setBody(overrides.changeBody?.(options.body) ?? options.body, !overrides.keepTag);
    if (overrides.lose === "after") throw new TypeError("simulated lost response");
    entry.status = overrides.status ?? 204;
    return new Response(null, { status: entry.status });
  }
  return { ...state, request, writes: () => writes };
}

async function disposable(options) {
  const fixture = await createDeviceSlotCasProbe();
  const server = fakeFile(encodeDeviceSlotEnvelope(fixture.seed), options);
  const cas = new DeviceSlotCas(server.request);
  return { fixture, server, cas, signal: new AbortController().signal };
}

test("the explicit mock probe sees two concurrent PATCH requests, one 412, and the exact winner", async () => {
  let release;
  const both = new Promise((resolve) => {
    release = resolve;
  });
  const { fixture, server, cas, signal } = await disposable({
    beforePatch: async (_, { requests }) => {
      if (requests.filter(({ method }) => method === "PATCH").length === 2) release();
      await both;
    }
  });
  const result = await probeDeviceSlotCas(cas, fileId, fixture, signal);
  assert.equal(result.loserStatus, 412);
  assert.equal(server.writes(), 2);
  const patches = server.requests.filter(({ method }) => method === "PATCH");
  assert.deepEqual(patches.map(({ status }) => status).sort(), [204, 412]);
  assert.deepEqual(
    patches.map(({ ifMatch }) => ifMatch),
    ['"version-1"', '"version-1"']
  );
  assert.equal(server.requests.length, 5);
  assert.equal(server.requests.at(-1).method, "GET");
  assert.equal(result.winner.etag, '"version-2"');
  assert.equal(result.winner.envelopeHash, await sha256(server.readBody()));
  assert.ok(
    fixture.candidates.some(
      ({ current }) => current.revisionId === result.winner.envelope.current.revisionId
    )
  );
  assert.equal(result.winner.envelope.previous.revisionId, fixture.seed.current.revisionId);
});

test("the explicit probe rejects an endpoint that ignores If-Match", async () => {
  const { fixture, server, cas, signal } = await disposable({ ignorePrecondition: true });
  await assert.rejects(probeDeviceSlotCas(cas, fileId, fixture, signal), issue("probe"));
  assert.equal(server.writes(), 2);
  assert.equal(
    server.requests.some(({ status }) => status === 412),
    false
  );
});

test("the probe rejects an endpoint that returns different bytes in the final winner read", async () => {
  const fixture = await createDeviceSlotCasProbe();
  const seed = encodeDeviceSlotEnvelope(fixture.seed);
  let reads = 0;
  const server = fakeFile(seed, {
    read: (state) =>
      new Response(++reads === 3 ? seed : state.readBody(), {
        headers: { ETag: state.tag() }
      })
  });
  const cas = new DeviceSlotCas(server.request);
  await assert.rejects(
    probeDeviceSlotCas(cas, fileId, fixture, new AbortController().signal),
    issue("probe")
  );
  assert.equal(reads, 3);
  assert.equal(server.writes(), 2);
  assert.ok(server.requests.some(({ status }) => status === 412));
});

test("the probe verifies its disposable fixture before it attempts any write", async () => {
  const { fixture, server, cas, signal } = await disposable();
  const another = await createDeviceSlotCasProbe();
  await assert.rejects(probeDeviceSlotCas(cas, fileId, another, signal), issue("hash"));
  await assert.rejects(probeDeviceSlotCas(cas, fileId, { ...fixture }, signal), issue("probe"));
  assert.equal(server.writes(), 0);
});

test("missing, weak and invalid validators never lead to a replacement", async () => {
  const fixture = await createDeviceSlotCasProbe();
  for (const etag of [null, 'W/"weak"', "*", "version-1", '"one", "two"', '"with space"']) {
    const headers = etag === null ? {} : { ETag: etag };
    const server = fakeFile(encodeDeviceSlotEnvelope(fixture.seed), {
      read: (state) => new Response(state.readBody(), { headers })
    });
    const cas = new DeviceSlotCas(server.request);
    const signal = new AbortController().signal;
    await assert.rejects(cas.read(fileId, signal), issue("validator"));
    assert.equal(server.writes(), 0);
    assert.equal(server.requests.length, 1);
  }
});

test("a stale validator returns 412 and leaves the other writer's version intact", async () => {
  const { fixture, server, cas, signal } = await disposable();
  const before = await cas.read(fileId, signal, await sha256(server.readBody()));
  const [first, second] = fixture.candidates;
  server.setBody(encodeDeviceSlotEnvelope(second));
  assert.deepEqual(await cas.replace(before, first, signal), { outcome: "conflict", status: 412 });
  assert.equal(server.writes(), 1);
  assert.deepEqual(
    server.requests.map(({ method }) => method),
    ["GET", "PATCH"]
  );
  assert.equal(await sha256(server.readBody()), await sha256(encodeDeviceSlotEnvelope(second)));
});

test("the write base must come from this CAS and the new envelope must repeat its exact current revision", async () => {
  const { fixture, server, cas, signal } = await disposable();
  const before = await cas.read(fileId, signal);
  const external = await new DeviceSlotCas(server.request).read(fileId, signal);
  const [next] = fixture.candidates;
  await assert.rejects(cas.replace({ ...before }, next, signal), issue("base"));
  await assert.rejects(cas.replace(external, next, signal), issue("base"));
  const changed = {
    ...next,
    previous: { ...next.previous, payload: { ...next.previous.payload, size: 1 } }
  };
  await assert.rejects(cas.replace(before, changed, signal), issue("base"));
  assert.equal(server.writes(), 0);
});

test("a lost PATCH response succeeds only after exact readback and without replay", async () => {
  for (const options of [{ lose: "after" }, { status: 503 }]) {
    const { fixture, server, cas, signal } = await disposable(options);
    const before = await cas.read(fileId, signal);
    const [next] = fixture.candidates;
    const result = await cas.replace(before, next, signal);
    assert.equal(result.outcome, "committed");
    assert.equal(result.recovered, true);
    assert.equal(result.snapshot.envelopeHash, await sha256(encodeDeviceSlotEnvelope(next)));
    assert.equal(result.snapshot.etag, '"version-2"');
    assert.deepEqual(
      server.requests.map(({ method }) => method),
      ["GET", "PATCH", "GET"]
    );
  }
});

test("the CAS rejects unconfirmed outcomes, a reused tag, and unverified replacement bytes", async () => {
  for (const options of [
    { lose: "before" },
    { keepTag: true },
    { changeBody: (body) => new Blob([body, " "], { type: body.type }) }
  ]) {
    const { fixture, server, cas, signal } = await disposable(options);
    const before = await cas.read(fileId, signal);
    await assert.rejects(cas.replace(before, fixture.candidates[0], signal), issue("unconfirmed"));
    assert.deepEqual(
      server.requests.map(({ method }) => method),
      ["GET", "PATCH", "GET"]
    );
  }
});

test("read verification rejects an incorrect digest and both declared and streamed size overflow", async () => {
  const { server, cas, signal } = await disposable();
  await assert.rejects(cas.read(fileId, signal, "a".repeat(64)), issue("hash"));
  assert.equal(server.writes(), 0);
  const huge = MAX_DEVICE_SLOT_ENVELOPE_BYTES + 1;
  for (const declared of [false, true]) {
    const body = declared ? "[]" : new Blob([new Uint8Array(huge)]);
    const reader = new DeviceSlotCas(
      async () =>
        new Response(body, {
          headers: { ETag: '"some-tag"', ...(declared && { "Content-Length": String(huge) }) }
        })
    );
    await assert.rejects(reader.read(fileId, signal), { code: "limit" });
  }
});

test("a cancelled PATCH does not issue a follow-up request", async () => {
  const abort = new AbortController();
  const { fixture, server, cas } = await disposable({
    beforePatch: () => abort.abort()
  });
  const before = await cas.read(fileId, abort.signal);
  await assert.rejects(cas.replace(before, fixture.candidates[0], abort.signal), {
    name: "AbortError"
  });
  assert.deepEqual(
    server.requests.map(({ method }) => method),
    ["GET", "PATCH"]
  );
});

function nextAfter(previous) {
  const revision = {
    deviceId: previous.deviceId,
    seq: previous.seq + 1,
    revisionId: crypto.randomUUID()
  };
  return {
    protocol: 3,
    previous,
    current: {
      ...previous,
      ...revision,
      previousRevisionId: previous.revisionId,
      accepted: [revision]
    }
  };
}

test("read-only reconciliation confirms a known commit after lost verification and reloading", async () => {
  let reads = 0;
  const { fixture, server, cas, signal } = await disposable({
    read: (state) =>
      ++reads === 2
        ? new Response(null, { status: 503 })
        : new Response(state.readBody(), { headers: { ETag: state.tag() } })
  });
  const base = await cas.read(fileId, signal);
  const pending = { fileId, baseEtag: base.etag, envelope: fixture.candidates[0] };
  await assert.rejects(cas.replace(base, pending.envelope, signal), issue("unconfirmed"));
  const reloaded = new DeviceSlotCas(server.request);
  const result = await reloaded.reconcile(structuredClone(pending), signal);
  assert.equal(result.outcome, "committed");
  assert.equal(result.retained, "current");
  assert.equal(
    result.snapshot.envelopeHash,
    await sha256(encodeDeviceSlotEnvelope(pending.envelope))
  );
  assert.deepEqual(
    server.requests.map(({ method }) => method),
    ["GET", "PATCH", "GET", "GET"]
  );
});

test("reconciliation recognizes a retained previous version and a different known same-sequence winner", async () => {
  const { fixture, server, cas, signal } = await disposable();
  const base = await cas.read(fileId, signal);
  const pending = { fileId, baseEtag: base.etag, envelope: fixture.candidates[0] };
  const later = nextAfter(pending.envelope.current);
  server.setBody(encodeDeviceSlotEnvelope(later));
  const result = await cas.reconcile(pending, signal);
  assert.equal(result.outcome, "committed");
  assert.equal(result.retained, "previous");
  assert.equal(result.snapshot.envelope.current.seq, 3);
  server.setBody(encodeDeviceSlotEnvelope(nextAfter(fixture.candidates[1].current)));
  assert.equal((await cas.reconcile(pending, signal)).outcome, "conflict");
  assert.equal(server.writes(), 0);
});

test("reconciliation fails closed for reused tags, evicted revisions and changed manifest contents", async () => {
  const { fixture, server, cas, signal } = await disposable();
  const base = await cas.read(fileId, signal);
  const pending = { fileId, baseEtag: base.etag, envelope: fixture.candidates[0] };
  server.setBody(encodeDeviceSlotEnvelope(pending.envelope), false);
  assert.equal((await cas.reconcile(pending, signal)).outcome, "unconfirmed");
  const later = nextAfter(pending.envelope.current);
  server.setBody(encodeDeviceSlotEnvelope(nextAfter(later.current)));
  assert.equal((await cas.reconcile(pending, signal)).outcome, "unconfirmed");
  server.setBody(
    encodeDeviceSlotEnvelope(
      nextAfter({
        ...pending.envelope.current,
        payload: {
          ...pending.envelope.current.payload,
          size: pending.envelope.current.payload.size + 1
        }
      })
    )
  );
  await assert.rejects(cas.reconcile(pending, signal), issue("hash"));
  assert.equal(server.writes(), 0);
});

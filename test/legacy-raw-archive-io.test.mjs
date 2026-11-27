import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader({ "services/storage-db.ts": {} });
const { LegacyCompactionHttp } = load("services/drive/legacy-raw-archive-io.ts");
const { RETENTION_NAMESPACE } = load("services/drive/legacy-raw-archive-http.ts");
const hash = async (body) => createHash("sha256").update(Buffer.from(await body.arrayBuffer())).digest("hex");
const metadata = { operationId: "operation-test", workspaceId: "workspace-test", publicClientId: "client-test", createdAt: "2026-11-27T00:00:00.000Z" };
function fixture() {
  const files = new Map(), calls = [], journalRows = [], hooks = {};
  const controller = new AbortController();
  const authorization = { credentialId: crypto.randomUUID(), connectionId: crypto.randomUUID(), signal: controller.signal, getAccessToken: () => "synthetic-test", invalidate() { controller.abort(); } };
  const journal = { async read() { return structuredClone(journalRows); }, async change(edit, signal) { signal.throwIfAborted(); const next = structuredClone(journalRows); edit(next); signal.throwIfAborted(); journalRows.splice(0, journalRows.length, ...next); } };
  let reserved = 0;
  const seed = (id, namespace = "mtp-drive-v2", kind = "snapshot", body = new Blob([`raw ${id} exact bytes`])) => {
    files.set(id, { id, version: 1, body, props: { mtpNamespace: namespace, mtpKind: kind, mtpKey: id, extraUnknownProperty: "preserve-exactly" } });
  };
  const describe = async (id) => {
    const file = files.get(id);
    return { id, version: String(file.version), etag: `"tag-${file.version}"`, fileSize: String(file.body.size), sha256Checksum: await hash(file.body) };
  };
  const fetcher = async (input, init = {}) => {
    init.signal?.throwIfAborted();
    const url = new URL(input), method = init.method ?? "GET", id = url.pathname.split("/").at(-1), headers = new Headers(init.headers);
    assert.equal(headers.get("Authorization"), "Bearer synthetic-test");
    assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
    calls.push({ url, method, id, match: headers.get("If-Match") });
    if (id === "generateIds") return Response.json({ ids: [`own-id-${++reserved}`] });
    if (method === "POST") {
      const boundary = headers.get("Content-Type").match(/boundary=([^;]+)$/)[1], bytes = Buffer.from(await init.body.arrayBuffer());
      const separator = Buffer.from(`\r\n--${boundary}\r\n`), after = bytes.indexOf(separator);
      const descriptor = JSON.parse(bytes.subarray(bytes.indexOf("\r\n\r\n") + 4, after).toString());
      if (files.has(descriptor.id)) return new Response(null, { status: 409 });
      if (descriptor.appProperties.mtpKind === "probe") assert.equal(journalRows.some((row) => row.fileId === descriptor.id), true, "probe ID must be durably owned before create");
      const start = bytes.indexOf("\r\n\r\n", after + separator.length) + 4;
      const body = new Blob([bytes.subarray(start, bytes.lastIndexOf(Buffer.from(`\r\n--${boundary}--`)))]);
      files.set(descriptor.id, { id: descriptor.id, version: 1, body, props: descriptor.appProperties });
      await hooks.afterCreate?.(descriptor.id);
      return Response.json({ id: descriptor.id, size: String(body.size), appProperties: descriptor.appProperties });
    }
    if (method === "PUT") {
      const file = files.get(id);
      assert.equal(file.props.mtpKind, "probe");
      if (headers.get("If-Match") !== `"tag-${file.version}"`) return new Response(null, { status: 412 });
      file.body = init.body; file.version++;
      return Response.json(await describe(id));
    }
    if (method === "DELETE") {
      await hooks.beforeDelete?.(id);
      const file = files.get(id);
      if (!file) return new Response(null, { status: 404 });
      if (!hooks.ignoreDeleteCondition && headers.get("If-Match") !== `"tag-${file.version}"`) return new Response(null, { status: 412 });
      if (hooks.loseBeforeDelete === id) throw new TypeError("unknown delete response");
      files.delete(id);
      if (hooks.loseAfterDelete === id) throw new TypeError("unknown delete response");
      return new Response(null, { status: 204 });
    }
    if (id === "files") {
      if (hooks.incompleteSearch) return Response.json({ files: [], incompleteSearch: true });
      const query = url.searchParams.get("q"), namespace = query.match(/key='mtpNamespace' and value='([^']+)'/)[1], kind = query.match(/key='mtpKind' and value='([^']+)'/)[1];
      return Response.json({ files: [...files].filter(([, f]) => f.props.mtpNamespace === namespace && f.props.mtpKind === kind).map(([id, f]) => ({ id, size: String(f.body.size), version: String(f.version), appProperties: f.props })) });
    }
    const file = files.get(id);
    if (!file) { await hooks.onMissing?.(id); return new Response(null, { status: 404 }); }
    if (url.searchParams.get("alt") === "media") {
      await hooks.beforeMedia?.(id);
      return new Response(hooks.mediaOverride ?? file.body);
    }
    if (url.pathname.startsWith("/drive/v2/")) {
      const value = await describe(id);
      if (hooks.weakTag) value.etag = "W/\"weak\"";
      if (hooks.missingChecksum) delete value.sha256Checksum;
      await hooks.afterMetadata?.(id);
      return Response.json(value, { headers: hooks.weakTag ? {} : { ETag: value.etag } });
    }
    return Response.json({ id, size: String(file.body.size), version: String(file.version), appProperties: file.props });
  };
  const io = new LegacyCompactionHttp(authorization, { fetch: fetcher, probeJournal: journal, check: async (signal) => { signal.throwIfAborted(); if (hooks.stale) throw new DOMException("stale", "AbortError"); } });
  return { io, authorization, controller, files, calls, hooks, journalRows, journal, fetcher, seed, reserved: () => reserved };
}

test("complete raw inventory includes both namespaces/kinds and orphan bytes without semantic normalization", async () => {
  const f = fixture();
  f.seed("v1-snapshot", "mtp-drive-v1"); f.seed("orphan-blob", "mtp-drive-v1", "blob"); f.seed("v2-snapshot"); f.seed("v2-blob", "mtp-drive-v2", "blob");
  const list = await f.io.listLegacy(f.controller.signal);
  assert.equal(list.length, 4);
  const before = f.calls.length;
  const raw = await f.io.captureRaw(list[0], f.controller.signal);
  assert.equal(await raw.body.text(), "raw v1-snapshot exact bytes");
  assert.equal(raw.file.appProperties.extraUnknownProperty, "preserve-exactly");
  assert.equal(raw.file.sha256, await hash(raw.body));
  assert.equal(raw.file.etag, '"tag-1"');
  assert.deepEqual(f.calls.slice(before).map((c) => c.url.pathname.split("/")[2]), ["v3", "v2", "v3", "v3", "v2"]);
});

test("incomplete listing and malformed/missing strong validators stop before deletion", async () => {
  const f = fixture(); f.seed("source");
  f.hooks.incompleteSearch = true;
  await assert.rejects(f.io.listLegacy(f.controller.signal));
  f.hooks.incompleteSearch = false;
  const [candidate] = await f.io.listLegacy(f.controller.signal);
  for (const defect of ["weakTag", "missingChecksum"]) {
    f.hooks[defect] = true;
    await assert.rejects(f.io.captureRaw(candidate, f.controller.signal));
    delete f.hooks[defect];
  }
  assert.equal(f.calls.some((c) => c.method === "DELETE"), false);
});

test("same-length stale bytes and a changed listing version cannot enter a raw archive", async () => {
  const f = fixture(); f.seed("source"); const [candidate] = await f.io.listLegacy(f.controller.signal);
  f.hooks.mediaOverride = new Blob(["x".repeat(candidate.size)]);
  await assert.rejects(f.io.captureRaw(candidate, f.controller.signal), { code: "conflict" });
  delete f.hooks.mediaOverride;
  f.files.get("source").version++;
  await assert.rejects(f.io.captureRaw(candidate, f.controller.signal), { code: "conflict" });
});

test("immutable create journals assigned ID before dispatch and verifies full remote readback", async () => {
  const f = fixture(), body = new Blob(["immutable archive exact bytes"]);
  let reserved;
  const receipt = await f.io.createImmutable("rawarchive", body, metadata, async (id) => { reserved = id; assert.equal(f.files.has(id), false); }, f.controller.signal);
  assert.equal(receipt.fileId, reserved);
  assert.equal(await (await f.io.readVerified(receipt, f.controller.signal)).text(), await body.text());
  const listed = await f.io.listRetention("rawarchive", f.controller.signal);
  assert.equal(listed.length, 1); assert.equal(listed[0].sha256, receipt.sha256);
  assert.equal(listed[0].appProperties.mtpPublicClientId, metadata.publicClientId);
  assert.equal(f.calls.some((c) => c.method === "DELETE"), false);
});

test("failed journal commit prevents immutable create; unsupported larger upload fails before reserve", async () => {
  const f = fixture();
  await assert.rejects(f.io.createImmutable("rawarchive", new Blob(["abc"]), metadata, async () => { throw new Error("journal commit failed"); }, f.controller.signal), /journal commit failed/);
  assert.equal(f.calls.some((c) => c.method === "POST"), false);
  const before = f.reserved();
  await assert.rejects(f.io.createImmutable("rawarchive", new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]), metadata, async () => assert.fail(), f.controller.signal), { code: "limit" });
  assert.equal(f.reserved(), before);
});

test("lost immutable create resumes the exact reserved ID and never overwrites a mismatched existing object", async () => {
  const f = fixture(), body = new Blob(["exact archive"]); let id;
  f.hooks.afterCreate = async () => { throw new TypeError("create response lost"); };
  await assert.rejects(f.io.createImmutable("rawarchive", body, metadata, async (next) => { id = next; }, f.controller.signal), { code: "network" });
  delete f.hooks.afterCreate;
  const receipt = await f.io.createImmutable("rawarchive", body, { ...metadata, reservedFileId: id }, async (next) => assert.equal(next, id), f.controller.signal);
  assert.equal(f.reserved(), 1); assert.equal(receipt.fileId, id);
  await assert.rejects(f.io.createImmutable("rawarchive", new Blob(["different"]), { ...metadata, reservedFileId: id }, async () => {}, f.controller.signal));
  assert.equal(await f.files.get(id).body.text(), "exact archive");
});

test("missing verified archive reports status404 rather than an empty archive", async () => {
  const f = fixture();
  await assert.rejects(f.io.readVerified({ fileId: "missing", size: 1, sha256: "a".repeat(64) }, f.controller.signal), { status: 404 });
});

test("actual synthetic DELETE proof requires stale412 with preserved bytes then fresh204 and confirmed404", async () => {
  const f = fixture(); const proof = await f.io.runDeleteProbe(f.controller.signal);
  assert.ok(proof); assert.equal(f.journalRows.length, 0); assert.equal(f.io.pendingProbeIds.length, 0); assert.equal(f.files.size, 0);
  const deletes = f.calls.filter((c) => c.method === "DELETE");
  assert.equal(deletes.length, 2); assert.equal(deletes[0].match, '"tag-1"'); assert.equal(deletes[1].match, '"tag-2"');
  assert.equal(await f.io.runDeleteProbe(f.controller.signal), proof);
});

test("a service that ignores stale If-Match cannot issue deletion authority", async () => {
  const f = fixture(); f.hooks.ignoreDeleteCondition = true;
  await assert.rejects(f.io.runDeleteProbe(f.controller.signal), { code: "not-ready" });
});

test("proof is opaque per IO/session and cannot authorize changed or nonlegacy namespaces", async () => {
  const f = fixture(); f.seed("source"); const [candidate] = await f.io.listLegacy(f.controller.signal); const { file } = await f.io.captureRaw(candidate, f.controller.signal);
  const proof = await f.io.runDeleteProbe(f.controller.signal);
  const other = new LegacyCompactionHttp(f.authorization, { fetch: f.fetcher, probeJournal: f.journal });
  await assert.rejects(other.deletePinned(file, proof, f.controller.signal));
  await assert.rejects(f.io.deletePinned({ ...file, namespace: RETENTION_NAMESPACE }, proof, f.controller.signal));
  f.files.get("source").version++;
  assert.equal(await f.io.deletePinned(file, proof, f.controller.signal), "changed");
  assert.equal(f.files.has("source"), true);
});

test("pinned deletion uses original If-Match; a dispatch race412 preserves the changed file", async () => {
  const f = fixture(); f.seed("source"); const [candidate] = await f.io.listLegacy(f.controller.signal); const { file } = await f.io.captureRaw(candidate, f.controller.signal);
  const proof = await f.io.runDeleteProbe(f.controller.signal);
  f.hooks.beforeDelete = async (id) => { if (id === "source") f.files.get(id).version++; };
  assert.equal(await f.io.deletePinned(file, proof, f.controller.signal), "changed");
  const call = f.calls.filter((c) => c.method === "DELETE" && c.id === "source").at(-1);
  assert.equal(call.match, file.etag); assert.equal(f.files.has("source"), true);
});

test("unknown DELETE response reconciles404 once and never replays deletion blindly", async () => {
  for (const result of ["deleted", "unknown"]) {
    const f = fixture(); f.seed("source"); const [candidate] = await f.io.listLegacy(f.controller.signal); const { file } = await f.io.captureRaw(candidate, f.controller.signal);
    const proof = await f.io.runDeleteProbe(f.controller.signal);
    f.hooks[result === "deleted" ? "loseAfterDelete" : "loseBeforeDelete"] = "source";
    assert.equal(await f.io.deletePinned(file, proof, f.controller.signal), result);
    assert.equal(f.calls.filter((c) => c.method === "DELETE" && c.id === "source").length, 1);
  }
});

test("disable/account fence and auth cancellation prevent late original-file DELETE", async () => {
  const f = fixture(); f.seed("source"); const [candidate] = await f.io.listLegacy(f.controller.signal); const { file } = await f.io.captureRaw(candidate, f.controller.signal);
  const proof = await f.io.runDeleteProbe(f.controller.signal);
  f.hooks.stale = true;
  await assert.rejects(f.io.deletePinned(file, proof, f.controller.signal), { name: "AbortError" });
  assert.equal(f.calls.some((c) => c.method === "DELETE" && c.id === "source"), false);
  f.hooks.stale = false; f.controller.abort();
  await assert.rejects(f.io.deletePinned(file, proof, new AbortController().signal), { name: "AbortError" });
});

test("unknown probe create keeps its exact owned ID pending even if the final journal read fails", async () => {
  const f = fixture();
  let ownedId;
  f.hooks.afterCreate = async (id) => {
    ownedId = id; f.files.delete(id);
    f.journal.read = async () => { throw new Error("temporary journal read failure"); };
    throw new TypeError("unknown create response");
  };
  await assert.rejects(f.io.runDeleteProbe(f.controller.signal), { code: "network" });
  assert.deepEqual(f.io.pendingProbeIds, [ownedId]);
  assert.equal(f.journalRows[0].fileId, ownedId);
  assert.equal(f.journalRows[0].observed, false);
  assert.equal(f.calls.some((c) => c.method === "DELETE"), false);
});

test("mutable deletion arguments cannot redirect an archived target to a different physical file", async () => {
  const f = fixture(); f.seed("archived-A"); f.seed("unarchived-B");
  const candidates = await f.io.listLegacy(f.controller.signal);
  const a = (await f.io.captureRaw(candidates.find((file) => file.fileId === "archived-A"), f.controller.signal)).file;
  const b = (await f.io.captureRaw(candidates.find((file) => file.fileId === "unarchived-B"), f.controller.signal)).file;
  const proof = await f.io.runDeleteProbe(f.controller.signal);
  const input = { ...a, appProperties: { ...a.appProperties } };
  const deleting = f.io.deletePinned(input, proof, f.controller.signal);
  Object.assign(input, { ...b, appProperties: { ...b.appProperties } }); input.appProperties.mtpKey = "retargeted";
  assert.equal(await deleting, "deleted");
  assert.equal(f.files.has("archived-A"), false); assert.equal(f.files.has("unarchived-B"), true);
  assert.equal(f.calls.some((call) => call.method === "DELETE" && call.id === "unarchived-B"), false);
});

test("nested ownership mutation is pinned and accessors are rejected without invoking their getters", async () => {
  const f = fixture(); f.seed("source"); const [candidate] = await f.io.listLegacy(f.controller.signal);
  const { file } = await f.io.captureRaw(candidate, f.controller.signal); const proof = await f.io.runDeleteProbe(f.controller.signal);
  let calls = 0;
  const accessor = { ...file, appProperties: { ...file.appProperties } };
  Object.defineProperty(accessor, "fileId", { enumerable: true, get() { calls++; return "other-target"; } });
  await assert.rejects(f.io.deletePinned(accessor, proof, f.controller.signal));
  const nestedAccessor = { ...file, appProperties: { ...file.appProperties } };
  Object.defineProperty(nestedAccessor.appProperties, "mtpKey", { enumerable: true, get() { calls++; return "other-target"; } });
  await assert.rejects(f.io.deletePinned(nestedAccessor, proof, f.controller.signal));
  assert.equal(calls, 0); assert.equal(f.files.has("source"), true);
  const input = { ...file, appProperties: { ...file.appProperties } };
  const deleting = f.io.deletePinned(input, proof, f.controller.signal);
  input.appProperties.mtpNamespace = RETENTION_NAMESPACE; input.appProperties.mtpKey = "mutated";
  assert.equal(await deleting, "deleted");
});

for (const terminal of ["missing", "changed", "412"]) test(`a stale account after terminal ${terminal} response cannot acknowledge a deletion`, async () => {
  const f = fixture(); f.seed("source"); const [candidate] = await f.io.listLegacy(f.controller.signal);
  const { file } = await f.io.captureRaw(candidate, f.controller.signal); const proof = await f.io.runDeleteProbe(f.controller.signal);
  if (terminal === "missing") { f.files.delete("source"); f.hooks.onMissing = async (id) => { if (id === "source") f.hooks.stale = true; }; }
  else if (terminal === "changed") { f.files.get("source").version++; f.hooks.afterMetadata = async (id) => { if (id === "source") f.hooks.stale = true; }; }
  else f.hooks.beforeDelete = async (id) => { if (id === "source") { f.files.get(id).version++; f.hooks.stale = true; } };
  await assert.rejects(f.io.deletePinned(file, proof, f.controller.signal), { name: "AbortError" });
});

test("verified archive cache revalidates metadata on every hit while downloading the body only once", async () => {
  const f = fixture(), body = new Blob([new Uint8Array(2 * 1024 * 1024).fill(83)]);
  const reference = await f.io.createImmutable("rawarchive", body, metadata, async () => {}, f.controller.signal);
  const first = await f.io.readVerified(reference, f.controller.signal), before = f.calls.length;
  const second = await f.io.readVerified(reference, f.controller.signal);
  assert.equal(first, second);
  assert.equal(f.calls.slice(before).length, 2, "a cache hit reads both current v3 and v2 metadata");
  assert.equal(f.calls.filter((call) => call.url.searchParams.get("alt") === "media").length, 1);
  assert.equal(f.journalRows.length, 0, "payload cache is RAM-only");
});

test("cache metadata changes force coherent full re-read, and disappearance or changed bytes fail closed", async () => {
  const f = fixture(), reference = await f.io.createImmutable("rawarchive", new Blob(["raw archive bytes"]), metadata, async () => {}, f.controller.signal);
  await f.io.readVerified(reference, f.controller.signal);
  f.files.get(reference.fileId).version++;
  await f.io.readVerified(reference, f.controller.signal);
  assert.equal(f.calls.filter((call) => call.url.searchParams.get("alt") === "media").length, 2);
  f.files.get(reference.fileId).body = new Blob(["xxxxxxxxxxxxxxxxx"]); f.files.get(reference.fileId).version++;
  await assert.rejects(f.io.readVerified(reference, f.controller.signal));
  f.files.delete(reference.fileId);
  await assert.rejects(f.io.readVerified(reference, f.controller.signal), { status: 404 });
  assert.equal(f.calls.some((call) => call.method === "DELETE"), false);
});

test("verified read cache evicts old entries after its bounded entry budget", async () => {
  const f = fixture(), references = [];
  for (let index = 0; index < 9; index++) {
    const reference = await f.io.createImmutable("rawarchive", new Blob([`archive-${index}`]), { ...metadata, operationId: `operation-${index}` }, async () => {}, f.controller.signal);
    references.push(reference); await f.io.readVerified(reference, f.controller.signal);
  }
  const before = f.calls.filter((call) => call.url.searchParams.get("alt") === "media").length;
  await f.io.readVerified(references[0], f.controller.signal);
  assert.equal(f.calls.filter((call) => call.url.searchParams.get("alt") === "media").length, before + 1);
});

test("verified read cache also evicts by total Blob byte budget", async () => {
  const f = fixture();
  const { RetentionHttp } = load("services/drive/legacy-raw-archive-http.ts");
  const { RetentionReadCache } = load("services/drive/legacy-raw-archive-cache.ts");
  const cache = new RetentionReadCache(new RetentionHttp(f.authorization, { fetch: f.fetcher }), 16, 8);
  const a = await f.io.createImmutable("rawarchive", new Blob(["aaaaaaaaaa"]), metadata, async () => {}, f.controller.signal);
  const b = await f.io.createImmutable("rawarchive", new Blob(["bbbbbbbbbb"]), { ...metadata, operationId: "operation-b" }, async () => {}, f.controller.signal);
  await cache.read(a, f.controller.signal); await cache.read(b, f.controller.signal); await cache.read(a, f.controller.signal);
  assert.equal(f.calls.filter((call) => call.url.searchParams.get("alt") === "media").length, 3);
});

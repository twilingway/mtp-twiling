import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const backup = (symbol) => ({ application: "personal-terminal", schemaVersion: 2, layout: { symbol }, watchlist: [], drawings: [], images: [], views: [] });
function fixture(t) {
  const privateRows = new Map();
  const load = sourceLoader({
    "services/storage-db.ts": {
      get: async (_name, id) => structuredClone(privateRows.get(id)),
      async transaction(_names, action, signal) {
        signal?.throwIfAborted();
        const copy = structuredClone(privateRows), reads = [];
        let aborted = false;
        action({ abort() { aborted = true; }, objectStore() { return {
          get(id) { const req = {}; reads.push(() => { req.result = copy.get(id); req.onsuccess(); }); return req; },
          put(row) { copy.set(row.id, structuredClone(row)); }
        }; } });
        for (const read of reads) read();
        signal?.throwIfAborted();
        if (aborted) throw new DOMException("aborted", "AbortError");
        privateRows.clear(); for (const [id, row] of copy) privateRows.set(id, row);
      }
    },
    "services/drive/device-slot-identity.ts": { defaultDriveSlotMode: () => "normal", loadDriveDeviceId: async () => uid(1) }
  });
  const { GoogleSlotProvider } = load("services/drive/device-slot-provider.ts");
  const { prepareDriveBackup, driveBackupDigest } = load("services/drive/backup.ts");
  const { decodeDeviceSlotPackage, restoreDeviceSlotVersion } = load("services/drive/device-slot-package.ts");
  const { DEVICE_SLOT_NAMESPACE } = load("services/drive/device-slot-model.ts");
  const scope = { owner: "device", cloudOwner: "device", session: {}, ready: true, blocked: false, associationConflict: false, revision: 1 };
  let local = backup("SBER"), record = { schemaVersion: 3, generation: 0, enabled: true, automatic: true, mode: "normal", scope: { workspaceId: uid(50), legacyArchive: null }, baseHeads: [] };
  const authAbort = new AbortController();
  let authActive = false;
  const authorization = { connectionId: uid(70), credentialId: uid(71), signal: authAbort.signal, getAccessToken: () => "synthetic-token", invalidate() { authAbort.abort(); } };
  const files = new Map(), calls = [], saved = [], createdProbe = deferred(), releaseProbe = deferred();
  let ids = 0, paused = false;
  const meta = async (id) => {
    const file = files.get(id);
    return { id, etag: `"v${file.version}"`, version: String(file.version), fileSize: String(file.body.size), sha256Checksum: createHash("sha256").update(Buffer.from(await file.body.arrayBuffer())).digest("hex") };
  };
  const fetcher = async (input, init = {}) => {
    const url = new URL(input), method = init.method ?? "GET", id = url.pathname.split("/").at(-1);
    calls.push({ path: url.pathname, method, id });
    if (id === "about") return Response.json({ user: { permissionId: "synthetic-account" } });
    if (id === "generateIds") return Response.json({ ids: [`reserved-${++ids}`] });
    if (method === "POST") {
      const boundary = new Headers(init.headers).get("Content-Type").match(/boundary=([^;]+)$/)[1];
      const bytes = Buffer.from(await init.body.arrayBuffer()), delimiter = Buffer.from(`\r\n--${boundary}\r\n`);
      const afterMetadata = bytes.indexOf(delimiter), start = bytes.indexOf("\r\n\r\n", afterMetadata + delimiter.length) + 4;
      const metadata = JSON.parse(bytes.subarray(bytes.indexOf("\r\n\r\n") + 4, afterMetadata).toString());
      const body = new Blob([bytes.subarray(start, bytes.lastIndexOf(Buffer.from(`\r\n--${boundary}--`)))]);
      files.set(metadata.id, { ...metadata, body, version: 1 });
      if (metadata.appProperties.mtpNamespace === "mtp-drive-cas-probe" && !paused) { paused = true; createdProbe.resolve(); await releaseProbe.promise; }
      return Response.json({ ...metadata, size: String(body.size) });
    }
    if (method === "PUT") {
      const file = files.get(id);
      if (new Headers(init.headers).get("If-Match") !== `"v${file.version}"`) return new Response(null, { status: 412 });
      file.body = init.body; file.version++;
      return Response.json(await meta(id), { headers: { ETag: `"v${file.version}"` } });
    }
    if (method === "DELETE") { files.delete(id); return new Response(null, { status: 204 }); }
    if (url.pathname.startsWith("/drive/v2/files/")) return Response.json(await meta(id));
    if (url.searchParams.get("alt") === "media") return new Response(files.get(id).body);
    if (id !== "files") {
      const file = files.get(id); return file ? Response.json({ id, name: file.name, appProperties: file.appProperties }) : new Response(null, { status: 404 });
    }
    const namespace = url.searchParams.get("q")?.match(/key='mtpNamespace' and value='([^']+)'/)?.[1];
    return Response.json({ files: [...files].filter(([, f]) => f.appProperties.mtpNamespace === namespace).map(([id, f]) => ({ id, name: f.name, size: String(f.body.size), appProperties: f.appProperties })) });
  };
  const provider = new GoogleSlotProvider({
    scope: () => scope,
    capture: async () => { const captured = local, revision = scope.revision; return { backup: captured, digest: await driveBackupDigest(captured), prepared: await prepareDriveBackup(captured), revision }; },
    apply: async () => assert.fail("local publish must not import")
  }, {
    auth: { prepare: async () => {}, restore: async () => { authActive = true; return authorization; }, suspend() { if (authActive) authAbort.abort(); }, forgetOwner: async () => {}, connectFromUserGesture: async () => authorization },
    load: async () => record,
    save: async (_owner, prior, patch, signal) => { signal.throwIfAborted(); assert.equal(prior.generation, record.generation); saved.push(patch); record = { ...record, ...patch, generation: record.generation + 1 }; return record; },
    hasHistory: async () => false, fetch: fetcher, online: () => true
  });
  // The idle receipt precedes the optional maintenance job. Track the whole public sync promise.
  let currentSync;
  const synchronize = provider.sync;
  provider.sync = () => { currentSync = synchronize(); return currentSync; };
  t.after(() => { releaseProbe.resolve(); provider.dispose(); });
  const proofRecord = () => privateRows.get("private:google-write-capability:v1")?.value;
  return { provider, scope, calls, saved, files, proofRecord, createdProbe, releaseProbe,
    async completeSync() { assert.ok(currentSync, "an automatic sync must already have started"); await currentSync; },
    edit() { local = backup("GAZP"); scope.revision++; provider.localChanged(); },
    userFiles: () => [...files.values()].filter((f) => f.appProperties.mtpNamespace === DEVICE_SLOT_NAMESPACE),
    async userBackup() { const file = [...files.values()].find((f) => f.appProperties.mtpNamespace === DEVICE_SLOT_NAMESPACE); return restoreDeviceSlotVersion((await decodeDeviceSlotPackage(file.body)).current); }
  };
}

test("portable edit during first automatic proof keeps one proof and automatically publishes only the latest capture", { timeout: 10000 }, async (t) => {
  const f = fixture(t); f.provider.resume(); await f.provider.prepare();
  const old = f.provider.sync(); await Promise.race([f.createdProbe.promise, old.then(() => assert.fail(JSON.stringify({ status: f.provider.getSnapshot(), calls: f.calls })))]);
  f.edit(); f.releaseProbe.resolve(); await old;
  assert.equal(f.proofRecord().proofs.length, 1);
  assert.equal(f.proofRecord().journal.length, 0);
  assert.equal(f.calls.filter((c) => c.id === "generateIds").length, 1, "the stale user packet must not reserve an ID");
  assert.equal(f.saved.some((patch) => patch.pending), false);
  assert.equal(f.userFiles().length, 0);
  assert.equal(f.provider.getSnapshot().phase, "idle");
  assert.equal(f.provider.getSnapshot().pendingChanges, true);
  assert.equal(f.provider.getSnapshot().error, undefined);
  await new Promise((resolve, reject) => {
    const stop = f.provider.subscribe(() => {
      const state = f.provider.getSnapshot();
      if (state.phase === "idle" && !state.pendingChanges) { clearTimeout(timer); stop(); resolve(); }
    });
    const timer = setTimeout(() => { stop(); reject(new Error("fresh automatic capture did not finish")); }, 5000);
  });
  assert.equal(f.calls.filter((c) => c.method === "POST").length, 2, "one synthetic probe plus one current user version");
  assert.equal(f.calls.filter((c) => c.method === "PUT").length, 2, "the synthetic race runs once");
  assert.equal(f.saved.filter((patch) => patch.pending).length, 1);
  assert.equal(f.userFiles().length, 1);
  assert.equal((await f.userBackup()).layout.symbol, "GAZP");
  assert.equal(f.proofRecord().proofs.length, 1);
});

test("disabling during the same independent proof still aborts its lifecycle and prevents stale user write", { timeout: 10000 }, async (t) => {
  const f = fixture(t); f.provider.resume(); await f.provider.prepare();
  const old = f.provider.sync(); await Promise.race([f.createdProbe.promise, old.then(() => assert.fail(JSON.stringify({ status: f.provider.getSnapshot(), calls: f.calls })))]);
  await f.provider.setEnabled(false); f.releaseProbe.resolve(); await old;
  assert.equal(f.provider.getSnapshot().phase, "disabled");
  assert.equal(f.provider.getSnapshot().writeCapability, undefined);
  assert.equal(f.proofRecord().proofs.length, 0);
  assert.equal(f.proofRecord().journal.length, 1);
  assert.equal(f.userFiles().length, 0);
  assert.equal(f.saved.some((patch) => patch.pending), false);
});

test("inspection preserves a preexisting automatic job and never creates an automatic job on its own", { timeout: 10000 }, async (t) => {
  const f = fixture(t); f.provider.resume(); await f.provider.prepare();
  await f.provider.inspect();
  assert.equal(f.provider.getSnapshot().comparison.remotes.length, 0);
  assert.equal(f.proofRecord(), undefined, "inspection itself must not probe");
  await Promise.race([f.createdProbe.promise, new Promise((_, reject) => setTimeout(() => reject(new Error("inspection cancelled the earlier automatic job")), 2500))]);
  f.releaseProbe.resolve();
  await f.completeSync();
  assert.equal(f.userFiles().length, 1);
  const beforeInspection = f.calls.length;
  const destructiveBefore = f.calls.filter((call) => call.method === "PUT" || call.method === "DELETE").length;
  await f.provider.inspect();
  assert.ok(f.calls.slice(beforeInspection).every((call) => call.method === "GET"), "inspection itself is read-only");
  const requests = f.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(f.calls.length, requests, "inspection without a prior timer must not schedule sync");
  assert.equal(f.calls.filter((call) => call.method === "PUT" || call.method === "DELETE").length,
    destructiveBefore, "inspection must not cause a delayed PUT or DELETE");
});

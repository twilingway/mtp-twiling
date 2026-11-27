import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader, config, authorization, localBackend } from "./helpers/yandex-source.mjs";
import { diskFixture } from "./helpers/yandex-disk.mjs";

const load = sourceLoader(),
  { encodeBundle, decodeBundle, revisionHeads, visibleDeviceVersions } = load(
    "services/yandex/bundle.ts"
  ),
  { sha256, YANDEX_CAPABILITIES } = load("services/yandex/types.ts"),
  { YandexJournal } = load("services/yandex/journal.ts"),
  { YandexRevisions } = load("services/yandex/revisions.ts"),
  { prepareDriveBackup, restoreDriveBackup } = load("services/drive/backup.ts");
const backup = () => ({
  application: "personal-terminal",
  schemaVersion: 2,
  layout: {
    timeframe: "1h",
    engine: "tradingview",
    watchlistFlagFilter: "red",
    chartSettings: { lastPriceColor: "#123456", mtpAllHidden: true }
  },
  drawings: [],
  images: [
    {
      id: crypto.randomUUID(),
      symbol: "SBER",
      name: "note",
      type: "image/png",
      width: 100,
      point: { timestamp: 1730000000000, value: 123 },
      data: Buffer.from([0, 128, 255, 11]).toString("base64"),
      visible: true
    }
  ]
});
async function bundle(parents = [], deviceId = crypto.randomUUID(), value = backup()) {
  const prepared = await prepareDriveBackup(value);
  return encodeBundle(prepared, {
    revisionId: crypto.randomUUID(),
    deviceId,
    parents,
    createdAt: "2026-11-27T12:00:00Z",
    digest: await sha256(prepared.payload)
  });
}
test("portable schema2 payload and binary image roundtrip through real existing codec without auth/history/quotes", async () => {
  const value = backup();
  value.token = "must-never-export";
  value.history = [123];
  value.quotes = [456];
  const encoded = await bundle([], undefined, value),
    decoded = await decodeBundle(encoded.body),
    restored = await restoreDriveBackup(
      decoded.prepared.payload,
      decoded.prepared.images.map(({ body }) => body)
    );
  assert.equal(restored.schemaVersion, 2);
  assert.deepEqual(restored.images, value.images);
  assert.equal(restored.layout.chartSettings.mtpAllHidden, true);
  assert.equal(restored.layout.watchlistFlagFilter, "red");
  assert.equal((await encoded.body.text()).includes("must-never-export"), false);
  assert.equal(restored.history, undefined);
  assert.equal(restored.quotes, undefined);
});
test("changed image bytes, appended bytes and future bundle protocol fail closed", async () => {
  const encoded = await bundle(),
    bytes = new Uint8Array(await encoded.body.arrayBuffer());
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(decodeBundle(new Blob([bytes])), (error) => error.code === "remote-invalid");
  await assert.rejects(
    decodeBundle(new Blob([encoded.body, "x"])),
    (error) => error.code === "remote-invalid"
  );
  await assert.rejects(
    decodeBundle(new Blob(["FUTURE01", bytes.slice(8)])),
    (error) => error.code === "unsupported-format"
  );
  assert.equal(YANDEX_CAPABILITIES.replaceIfMatch, false);
  assert.equal(YANDEX_CAPABILITIES.automaticPhysicalCleanup, false);
});
test("logical retention selects current/previous but preserves unresolved branches and avoids date ordering", async () => {
  const device = crypto.randomUUID(),
    first = await bundle([], device),
    second = await bundle([first.revision.revisionId], device),
    third = await bundle([second.revision.revisionId], device);
  const linear = [third.revision, first.revision, second.revision];
  assert.deepEqual(revisionHeads(linear), [third.revision.revisionId]);
  assert.deepEqual(
    new Set(visibleDeviceVersions(linear, device).map(({ revisionId }) => revisionId)),
    new Set([third.revision.revisionId, second.revision.revisionId])
  );
  const fork = await bundle([first.revision.revisionId], device),
    all = [...linear, fork.revision];
  assert.equal(revisionHeads(all).length, 2);
  assert.ok(
    visibleDeviceVersions(all, device).some(
      ({ revisionId }) => revisionId === fork.revision.revisionId
    )
  );
  await assert.rejects(
    async () =>
      revisionHeads([
        { ...first.revision, parents: [second.revision.revisionId] },
        second.revision
      ]),
    (error) => error.code === "remote-invalid"
  );
});
test("pending exact bytes are durable before upload and reused on retry with same operation ID", async () => {
  const backend = await localBackend(),
    journal = new YandexJournal(async () => backend),
    f = diskFixture(),
    auth = f.auth,
    revisions = new YandexRevisions(f.transport, journal, auth, config.clientId),
    prepared = await prepareDriveBackup(backup()),
    digest = await sha256(prepared.payload);
  let pendingBeforeNetwork;
  f.hooks.before = async (url) => {
    if (url.pathname.endsWith("/upload"))
      pendingBeforeNetwork = await journal.pending(config.clientId, auth.accountId);
  };
  const first = await revisions.publish(prepared, digest, [], () => true),
    second = await revisions.publish(prepared, digest, [], () => true);
  assert.equal(first.revisionId, second.revisionId);
  assert.equal(pendingBeforeNetwork.revision.revisionId, first.revisionId);
  assert.equal(f.puts(), 1);
  assert.equal((await revisions.inspect(() => true)).heads[0], first.revisionId);
});
test("pending from account A is absent in B; changed credential cannot replay pending without explicit rebind", async () => {
  const backend = await localBackend(),
    journal = new YandexJournal(async () => backend),
    f = diskFixture(),
    prepared = await prepareDriveBackup(backup()),
    digest = await sha256(prepared.payload),
    first = new YandexRevisions(f.transport, journal, f.auth, config.clientId);
  await first.publish(prepared, digest, [], () => true);
  assert.equal(await journal.pending(config.clientId, "456"), undefined);
  const auth = authorization("123", "new-credential"),
    second = new YandexRevisions(f.transport, journal, auth, config.clientId);
  await assert.rejects(
    second.publish(prepared, digest, [], () => true),
    (error) => error.code === "indeterminate"
  );
  assert.equal(f.puts(), 1);
});
test("a changed second listing blocks inspection rather than granting cleanup or success", async () => {
  const backend = await localBackend(),
    journal = new YandexJournal(async () => backend),
    f = diskFixture(),
    prepared = await prepareDriveBackup(backup()),
    revisions = new YandexRevisions(f.transport, journal, f.auth, config.clientId);
  await revisions.publish(prepared, await sha256(prepared.payload), [], () => true);
  let lists = 0;
  const inspectionStart = f.calls.length;
  assert.ok(
    f.calls
      .filter(({ init }) => init.method === "DELETE")
      .every(({ url }) => url.searchParams.get("path").split("/").at(-1).startsWith("probe_"))
  );
  f.hooks.before = (url) => {
    if (url.searchParams.has("limit") && ++lists === 2) f.files.clear();
  };
  await assert.rejects(
    revisions.inspect(() => true),
    (error) => error.code === "conflict"
  );
  assert.equal(
    f.calls.slice(inspectionStart).some(({ init }) => init.method === "DELETE"),
    false
  );
});
test("cold inspection of three 180 MiB revisions reads only bounded headers and exposes current/previous", async () => {
  const backend = await localBackend(),
    journal = new YandexJournal(async () => backend),
    auth = authorization(),
    deviceId = crypto.randomUUID(),
    base = await bundle(),
    files = [],
    headers = new Map();
  let parent = [],
    prefixBytes = 0,
    fullReads = 0;
  for (let index = 0; index < 3; index++) {
    const revision = {
      ...base.revision,
      revisionId: crypto.randomUUID(),
      deviceId,
      parents: parent,
      summary: { instruments: 0, drawings: 0, images: 9 },
      images: Array.from({ length: 9 }, (_, i) => ({
        index: i,
        mimeType: "image/png",
        sha256: "1".repeat(64),
        size: 20 * 1024 * 1024
      }))
    };
    const header = new TextEncoder().encode(JSON.stringify(revision)),
      prefix = new Uint8Array(12);
    prefix.set(new TextEncoder().encode("MTPYDX01"));
    new DataView(prefix.buffer).setUint32(8, header.length, false);
    const body = new Blob([prefix, header]),
      name = `${deviceId}_${revision.revisionId}.mtp`;
    headers.set(name, body);
    files.push({
      name,
      path: `app:/mtp-yandex-v1/${name}`,
      size: body.size + revision.payload.size + 180 * 1024 * 1024,
      md5: "a".repeat(32),
      modified: "2026-11-27T12:00:00Z"
    });
    parent = [revision.revisionId];
  }
  const transport = {
    list: async () => files,
    readPrefix: async (file, size) => {
      const body = headers.get(file.name).slice(0, size);
      prefixBytes += body.size;
      return body;
    },
    read: async () => {
      fullReads++;
      throw new Error("Inspection must not download binary history");
    }
  };
  const revisions = new YandexRevisions(transport, journal, auth, config.clientId),
    inspected = await revisions.inspect(() => true);
  assert.equal(inspected.remotes.length, 3);
  assert.deepEqual(inspected.heads, parent);
  assert.equal(fullReads, 0);
  assert.ok(prefixBytes < 16000);
  assert.equal(
    visibleDeviceVersions(
      inspected.remotes.map(({ revision }) => revision),
      deviceId
    ).length,
    2
  );
});
test("a full supported 10000-revision linear history does not exhaust the JavaScript call stack", async () => {
  const base = await bundle(),
    values = [];
  let parents = [];
  for (let index = 0; index < 10000; index++) {
    const revision = { ...base.revision, revisionId: crypto.randomUUID(), parents };
    values.push(revision);
    parents = [revision.revisionId];
  }
  assert.deepEqual(revisionHeads(values), parents);
  assert.equal(visibleDeviceVersions(values, base.revision.deviceId).length, 2);
});

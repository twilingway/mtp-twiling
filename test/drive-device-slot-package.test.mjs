import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const backupApi = load("services/drive/backup.ts");
const {
  MAX_DEVICE_SLOT_PACKAGE_BYTES,
  prepareDeviceSlotVersion,
  encodeDeviceSlotPackage,
  decodeDeviceSlotPackage,
  restoreDeviceSlotVersion
} = load("services/drive/device-slot-package.ts");

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=";
const gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const uid = (last) => `00000000-0000-4000-8000-${String(last).padStart(12, "0")}`;
const prefixSize = 12;
const hash = async (blob) =>
  createHash("sha256")
    .update(Buffer.from(await blob.arrayBuffer()))
    .digest("hex");
const image = (id, type, data) => ({
  id,
  symbol: "SBER",
  name: `${id}.${type.split("/")[1]}`,
  point: { timestamp: 9000, value: 98.4 },
  width: 60,
  type,
  data
});
const portable = (symbol = "SBER", images = []) => ({
  application: "personal-terminal",
  schemaVersion: 2,
  exportedAt: "2026-11-26T00:00:00.000Z",
  layout: {
    symbol,
    timeframe: "1d",
    engine: "tradingview",
    chartSettings: { ohlcDisplay: "icon", ohlcOnHold: true }
  },
  watchlist: [{ symbol, uid: `${symbol}-uid`, name: "Fixture" }],
  drawings: [
    {
      symbol,
      items: [
        {
          id: "my-line",
          name: "horizontalRayLine",
          points: [{ timestamp: 1000, value: 42 }],
          settings: { color: "#123456", width: 2 }
        }
      ]
    }
  ],
  images,
  views: [
    {
      key: `${symbol}:1d:tradingview:365`,
      value: { camera: { barSpace: 8, rightOffsetBars: 6 } }
    }
  ]
});
const json = (value) => new Blob([JSON.stringify(value)], { type: "application/json" });

function manifest(version, seq, previousRevisionId = null) {
  const revision = { deviceId: uid(1), seq, revisionId: uid(seq + 20) };
  return {
    protocol: 3,
    workspaceId: uid(5),
    legacyArchive: null,
    ...revision,
    previousRevisionId,
    payload: version.reference,
    accepted: [revision]
  };
}

async function example() {
  const priorBackup = portable("SBER", [image("before", "image/png", png)]);
  const nowBackup = portable("GAZP", [image("a", "image/gif", gif), image("b", "image/png", png)]);
  const previous = await prepareDeviceSlotVersion(await backupApi.prepareDriveBackup(priorBackup));
  const current = await prepareDeviceSlotVersion(await backupApi.prepareDriveBackup(nowBackup));
  const before = manifest(previous, 1);
  const envelope = {
    protocol: 3,
    previous: before,
    current: manifest(current, 2, before.revisionId)
  };
  const body = encodeDeviceSlotPackage(envelope, current, previous);
  return { envelope, previous, current, body, priorBackup, nowBackup };
}

async function headerOffset(body) {
  const prefix = new DataView(await body.slice(0, prefixSize).arrayBuffer());
  return prefixSize + prefix.getUint32(8);
}

async function withByte(body, index, value) {
  return new Blob([body.slice(0, index), new Uint8Array([value]), body.slice(index + 1)]);
}

test("one file contains two complete backup versions and restores selected images byte-for-byte", async () => {
  const f = await example();
  assert.equal(await hash(f.current.body), f.envelope.current.payload.sha256);
  assert.equal(await hash(f.previous.body), f.envelope.previous.payload.sha256);
  const loaded = await decodeDeviceSlotPackage(f.body);
  assert.deepEqual(loaded.envelope, f.envelope);
  assert.equal(loaded.current.body.size, f.current.body.size);
  assert.equal(loaded.previous.body.size, f.previous.body.size);
  const prior = await restoreDeviceSlotVersion(loaded.previous);
  const now = await restoreDeviceSlotVersion(loaded.current);
  assert.equal(prior.layout.symbol, "SBER");
  assert.equal(now.layout.symbol, "GAZP");
  assert.deepEqual(now.layout.chartSettings, f.nowBackup.layout.chartSettings);
  assert.deepEqual(now.watchlist, f.nowBackup.watchlist);
  assert.deepEqual(now.drawings, f.nowBackup.drawings);
  assert.deepEqual(now.views, f.nowBackup.views);
  assert.deepEqual(now.images, f.nowBackup.images);
  assert.deepEqual(prior.images, f.priorBackup.images);
  for (const item of [...now.images, ...prior.images]) {
    const original = item.type === "image/png" ? png : gif;
    assert.deepEqual(Buffer.from(item.data, "base64"), Buffer.from(original, "base64"));
  }
  assert.ok(!(await f.body.text()).includes(png));
  assert.ok(!(await f.body.text()).includes(gif));
});

test("rotating a third version reuses the verified current frame and keeps only the two newest", async () => {
  const f = await example();
  const loaded = await decodeDeviceSlotPackage(f.body);
  const fresh = await prepareDeviceSlotVersion(
    await backupApi.prepareDriveBackup(portable("MOEX"))
  );
  const next = {
    protocol: 3,
    current: manifest(fresh, 3, loaded.envelope.current.revisionId),
    previous: loaded.envelope.current
  };
  const body = encodeDeviceSlotPackage(next, fresh, loaded.current);
  const verified = await decodeDeviceSlotPackage(body);
  assert.equal(body.size, (await headerOffset(body)) + fresh.body.size + loaded.current.body.size);
  assert.equal((await restoreDeviceSlotVersion(verified.current)).layout.symbol, "MOEX");
  assert.equal((await restoreDeviceSlotVersion(verified.previous)).layout.symbol, "GAZP");
  assert.deepEqual(verified.previous.reference, loaded.current.reference);
});

test("a first save contains one version and an encoded header never accepts detached or forged versions", async () => {
  const f = await example();
  const firstEnvelope = { protocol: 3, current: f.envelope.previous, previous: null };
  const first = await decodeDeviceSlotPackage(
    encodeDeviceSlotPackage(firstEnvelope, f.previous, null)
  );
  assert.equal(first.previous, null);
  assert.equal(first.envelope.current.seq, 1);
  assert.throws(() => encodeDeviceSlotPackage(f.envelope, f.current, null), {
    code: "remote-invalid"
  });
  assert.throws(() => encodeDeviceSlotPackage(firstEnvelope, f.previous, f.current), {
    code: "remote-invalid"
  });
  assert.throws(() => encodeDeviceSlotPackage(f.envelope, f.previous, f.current), {
    code: "remote-invalid"
  });
  assert.throws(() => encodeDeviceSlotPackage(f.envelope, { ...f.current }, f.previous), {
    code: "remote-invalid"
  });
  await assert.rejects(restoreDeviceSlotVersion({ ...f.current }), { code: "remote-invalid" });
});

test("tool-independent binary version digest is deterministic for reordered metadata and export dates", async () => {
  const original = portable();
  const a = await prepareDeviceSlotVersion(await backupApi.prepareDriveBackup(original));
  const b = await prepareDeviceSlotVersion({
    payload: json({
      ...Object.fromEntries(Object.entries(original).reverse()),
      exportedAt: "2026-11-27T00:00:00.000Z"
    }),
    images: []
  });
  assert.deepEqual(a.reference, b.reference);
  assert.deepEqual(
    Buffer.from(await a.body.arrayBuffer()),
    Buffer.from(await b.body.arrayBuffer())
  );
});

test("qualified public instruments preserve the portable provider requirement and exact identities", async () => {
  const source = portable("okx:spot:BTC-USDT");
  const providerRef = { provider: "okx", category: "spot", symbol: "BTC-USDT" };
  source.layout.providerRef = providerRef;
  source.layout.instrumentUid = source.layout.symbol;
  source.watchlist[0].providerRef = providerRef;
  source.watchlist[0].uid = source.layout.symbol;
  const current = await prepareDeviceSlotVersion(await backupApi.prepareDriveBackup(source));
  const envelope = { protocol: 3, current: manifest(current, 1), previous: null };
  const restored = await restoreDeviceSlotVersion(
    (await decodeDeviceSlotPackage(encodeDeviceSlotPackage(envelope, current, null))).current
  );
  assert.deepEqual(restored.requiredProviders, ["okx"]);
  assert.deepEqual(restored.layout.providerRef, providerRef);
  assert.deepEqual(restored.watchlist[0].providerRef, providerRef);
  assert.equal(restored.watchlist[0].uid, "okx:spot:BTC-USDT");
});

test("decoding rejects cut frames, extra bytes, or a different digest in either version", async () => {
  const { body, current } = await example();
  const start = await headerOffset(body);
  for (const invalid of [
    body.slice(0, 8),
    body.slice(0, start - 1),
    body.slice(0, start + current.body.size),
    body.slice(0, body.size - 1),
    new Blob([body, "x"]),
    await withByte(body, start + current.body.size - 1, 0xff),
    await withByte(body, body.size - 1, 0xff)
  ])
    await assert.rejects(decodeDeviceSlotPackage(invalid), { code: "remote-invalid" });
});

test("unknown versions, invalid frame lengths and exact size boundaries are fail closed", async () => {
  const { body } = await example();
  await assert.rejects(decodeDeviceSlotPackage(await withByte(body, 7, 2)), {
    code: "unsupported-format"
  });
  const tooLong = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
  await assert.rejects(
    decodeDeviceSlotPackage(new Blob([body.slice(0, 8), tooLong, body.slice(12)])),
    { code: "limit" }
  );
  const start = await headerOffset(body);
  await assert.rejects(
    decodeDeviceSlotPackage(new Blob([body.slice(0, start), tooLong, body.slice(start + 4)])),
    { code: "limit" }
  );

  class Oversize extends Blob {
    get size() {
      return MAX_DEVICE_SLOT_PACKAGE_BYTES + 1;
    }
    slice() {
      throw new Error("An oversize package must be refused before reads");
    }
  }
  await assert.rejects(decodeDeviceSlotPackage(new Oversize()), { code: "limit" });

  class Image extends Blob {
    get size() {
      return backupApi.MAX_IMAGE_BYTES;
    }
    arrayBuffer() {
      throw new Error("An oversize version must be refused before reads");
    }
  }
  const images = Array.from({ length: 13 }, (_, index) => ({
    index,
    body: new Image([], { type: "image/png" }),
    reference: { size: backupApi.MAX_IMAGE_BYTES, sha256: "a".repeat(64) },
    mimeType: "image/png"
  }));
  await assert.rejects(prepareDeviceSlotVersion({ payload: json(portable()), images }), {
    code: "limit"
  });
});

test("portable validator excludes quote/history credentials and fails closed on unsupported fields", async () => {
  const source = portable();
  const prepared = await backupApi.prepareDriveBackup({
    ...source,
    bankToken: "fake-secret-not-portable",
    history: [{ uid: "fixture", timeframe: "1d", day: "2026-01-01", data: "HISTORY" }],
    watchlist: [{ ...source.watchlist[0], price: 123, previousClose: 111 }]
  });
  const version = await prepareDeviceSlotVersion(prepared);
  const restored = await restoreDeviceSlotVersion(version);
  assert.equal(restored.history, undefined);
  assert.equal(restored.watchlist[0].price, undefined);
  assert.equal(restored.watchlist[0].previousClose, undefined);
  assert.ok(!(await version.body.text()).includes("fake-secret-not-portable"));
  for (const payload of [
    { ...source, bankToken: "synthetic" },
    { ...source, watchlist: [{ ...source.watchlist[0], price: 123 }] },
    { ...source, layout: { ...source.layout, futureNotInterpretedYet: 1 } }
  ])
    await assert.rejects(prepareDeviceSlotVersion({ payload: json(payload), images: [] }), {
      code: "unsupported-format"
    });
});

test("an incorrect image checksum, mismatching media type, or inline image data cannot enter a version", async () => {
  const original = portable("SBER", [image("photo", "image/png", png)]);
  const f = await backupApi.prepareDriveBackup(original);
  const [part] = f.images;
  for (const prepared of [
    { ...f, images: [{ ...part, reference: { ...part.reference, sha256: "a".repeat(64) } }] },
    { ...f, images: [{ ...part, mimeType: "image/gif" }] },
    { ...f, payload: json(original) }
  ])
    await assert.rejects(prepareDeviceSlotVersion(prepared), { code: "remote-invalid" });
});

test("aborting validation of the current bytes prevents reading the previous version", async () => {
  const { body, current } = await example();
  const abort = new AbortController();
  const seen = [];
  const { decodeDeviceSlotPackage: decode } = sourceLoader({
    "services/drive/backup.ts": {
      ...backupApi,
      verifyContent: async (blob, reference) => {
        seen.push(reference.sha256);
        await backupApi.verifyContent(blob, reference);
        abort.abort();
      }
    }
  })("services/drive/device-slot-package.ts");
  await assert.rejects(decode(body, abort.signal), { name: "AbortError" });
  assert.deepEqual(seen, [current.reference.sha256]);
});

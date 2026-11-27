import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { sourceLoader } from "../test/helpers/market-source-loader.mjs";

const api = sourceLoader()("services/drive/legacy-raw-archive-codec.ts");
const { encodeRawArchive, decodeRawArchive, computeRawInventoryDigest, verifyRawArchiveCoverage } =
  api;
const metadata = {
  operationId: "operation-1",
  workspaceId: "workspace-1",
  publicClientId: "public-client.apps.googleusercontent.com",
  createdAt: "2026-11-27T00:00:00.000Z"
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const object = (fileId, bytes, changes = {}) => ({
  file: {
    fileId,
    namespace: "mtp-drive-v2",
    kind: "snapshot",
    key: "same-logical-key",
    version: "1",
    etag: `"${fileId}-etag"`,
    size: bytes.length,
    sha256: hash(bytes),
    appProperties: { mtpKind: "snapshot", mtpKey: "same-logical-key", custom: "retained" },
    ...changes
  },
  body: new Blob([bytes])
});
const fixtures = () => [
  object("snapshot-b", Buffer.from([0, 255, 1, 128, 2])),
  object("orphan-blob", Buffer.from("not referenced by any snapshot"), {
    namespace: "mtp-drive-v1",
    kind: "blob",
    key: "orphan-key"
  }),
  object("snapshot-a", Buffer.from([0, 255, 1, 128, 2]))
];
const reference = ({ size, sha256, indexDigest }) => ({ size, sha256, indexDigest });
const rejection =
  (code = "remote-invalid") =>
  (error) =>
    error?.code === code;

// Rewrite framing with a valid index checksum, so structural failures are tested independently.
async function rewriteIndex(archive, mutate, extra = new Uint8Array()) {
  const bytes = new Uint8Array(await archive.body.arrayBuffer());
  const prefixSize = 43;
  const oldLength = new DataView(bytes.buffer).getUint32(7);
  const index = JSON.parse(
    new TextDecoder().decode(bytes.slice(prefixSize, prefixSize + oldLength))
  );
  mutate(index);
  const header = Buffer.from(JSON.stringify(index));
  const prefix = bytes.slice(0, prefixSize);
  new DataView(prefix.buffer).setUint32(7, header.length);
  prefix.set(Buffer.from(hash(header), "hex"), 11);
  return new Blob([prefix, header, bytes.slice(prefixSize + oldLength), extra]);
}

test("preserves every original byte and physical duplicate, including orphan blobs", async () => {
  const sources = fixtures();
  const encoded = await encodeRawArchive(sources, metadata);
  const decoded = await decodeRawArchive(encoded.body, reference(encoded));
  assert.equal(decoded.objects.length, 3);
  for (const source of sources) {
    const restored = decoded.objects.find(({ file }) => file.fileId === source.file.fileId);
    assert.deepEqual(restored.file, source.file);
    assert.deepEqual(
      Buffer.from(await restored.body.arrayBuffer()),
      Buffer.from(await source.body.arrayBuffer())
    );
  }
  assert.equal(
    await verifyRawArchiveCoverage(
      decoded.index,
      sources.map(({ file }) => file)
    ),
    true
  );
  assert.equal(
    decoded.inventoryDigest,
    await computeRawInventoryDigest(sources.map(({ file }) => file))
  );
  assert.equal(Object.isFrozen(decoded.index.files[0].appProperties), true);
  assert.equal(encoded.sha256, hash(Buffer.from(await encoded.body.arrayBuffer())));
  const redecode = await decodeRawArchive(decoded.body, reference(decoded));
  assert.equal(redecode.inventoryDigest, decoded.inventoryDigest);
});

test("inventory binds all metadata while order is irrelevant", async () => {
  const sources = fixtures().map(({ file }) => file);
  const encoded = await encodeRawArchive(fixtures(), metadata);
  assert.equal(
    await computeRawInventoryDigest(sources),
    await computeRawInventoryDigest([...sources].reverse())
  );
  for (const change of [
    { version: "2" },
    { etag: '"other"' },
    { key: "other-key" },
    { namespace: "mtp-drive-v1" },
    { appProperties: { custom: "changed" } }
  ]) {
    const altered = sources.map((file, index) => (index ? file : { ...file, ...change }));
    assert.equal(await verifyRawArchiveCoverage(encoded.index, altered), false);
  }
  assert.equal(await verifyRawArchiveCoverage(encoded.index, sources.slice(1)), false);
});

test("coverage snapshots both inventories before asynchronous hashing", async () => {
  const [archived, unarchived] = fixtures();
  const encoded = await encodeRawArchive([archived], metadata);
  const candidates = [archived.file, unarchived.file];
  const checking = verifyRawArchiveCoverage(encoded.index, candidates);
  candidates.pop();
  assert.equal(await checking, false);

  const mutableIndex = structuredClone(encoded.index);
  const matching = [structuredClone(archived.file)];
  const matchingCheck = verifyRawArchiveCoverage(mutableIndex, matching);
  mutableIndex.files[0].appProperties.custom = "mutated-index";
  matching[0].appProperties.custom = "mutated-candidate";
  assert.equal(await matchingCheck, true);
});

test("rejects header checksum, source body tamper, truncation, and trailing bytes", async () => {
  const encoded = await encodeRawArchive(fixtures(), metadata);
  const bytes = new Uint8Array(await encoded.body.arrayBuffer());
  const headerTamper = bytes.slice();
  headerTamper[45] ^= 1;
  await assert.rejects(decodeRawArchive(new Blob([headerTamper])), rejection());
  const bodyTamper = bytes.slice();
  bodyTamper[bodyTamper.length - 1] ^= 1;
  await assert.rejects(decodeRawArchive(new Blob([bodyTamper])), rejection());
  await assert.rejects(decodeRawArchive(encoded.body.slice(0, -1)), rejection());
  await assert.rejects(
    decodeRawArchive(new Blob([encoded.body, new Uint8Array([0])])),
    rejection()
  );
  await assert.rejects(
    encodeRawArchive([{ ...fixtures()[0], body: new Blob(["wrong"]) }], metadata),
    rejection()
  );
  const wrongHash = fixtures()[0];
  await assert.rejects(
    encodeRawArchive(
      [{ ...wrongHash, file: { ...wrongHash.file, sha256: "0".repeat(64) } }],
      metadata
    ),
    rejection()
  );
});

test("valid index digest cannot authorize overlaps, gaps, dangling ranges, or metadata loss", async () => {
  const encoded = await encodeRawArchive(fixtures(), metadata);
  for (const mutation of [
    (index) => {
      index.files[1].offset = 1;
    },
    (index) => {
      index.files[1].offset += 1;
    },
    (index) => {
      index.files[2].offset = 1000000;
    },
    (index) => {
      index.files.pop();
    },
    (index) => {
      index.files[1].fileId = index.files[0].fileId;
    },
    (index) => {
      index.files[0].secret = "excluded";
    }
  ]) {
    await assert.rejects(decodeRawArchive(await rewriteIndex(encoded, mutation)), rejection());
  }
});

test("accepts shared sections only when every physical file has the verified size and hash", async () => {
  const encoded = await encodeRawArchive(fixtures(), metadata);
  const rewritten = await rewriteIndex(encoded, (index) => {
    index.files[2].offset = index.files[1].offset;
  });
  const decoded = await decodeRawArchive(rewritten.slice(0, -5));
  assert.equal(decoded.objects.length, 3);
  assert.deepEqual(
    Buffer.from(await decoded.objects[1].body.arrayBuffer()),
    Buffer.from(await decoded.objects[2].body.arrayBuffer())
  );
  const mismatched = await rewriteIndex(encoded, (index) => {
    index.files[2].offset = index.files[1].offset;
    index.files[2].sha256 = "0".repeat(64);
  });
  await assert.rejects(decodeRawArchive(mismatched.slice(0, -5)), rejection());
});

test("rejects unknown framing/index versions and mismatched external receipts", async () => {
  const encoded = await encodeRawArchive(fixtures(), metadata);
  const bytes = new Uint8Array(await encoded.body.arrayBuffer());
  bytes[6] = 2;
  await assert.rejects(decodeRawArchive(new Blob([bytes])), rejection("unsupported-format"));
  await assert.rejects(
    decodeRawArchive(
      await rewriteIndex(encoded, (index) => {
        index.formatVersion = 2;
      })
    ),
    rejection("unsupported-format")
  );
  await assert.rejects(
    decodeRawArchive(encoded.body, { ...reference(encoded), sha256: "0".repeat(64) }),
    rejection()
  );
  await assert.rejects(
    decodeRawArchive(encoded.body, { ...reference(encoded), indexDigest: "0".repeat(64) }),
    rejection()
  );
});

test("fails closed on prototypes, accessors, duplicate IDs, weak validators and bounds", async () => {
  let accessed = false;
  const source = fixtures()[0];
  const accessor = { ...source.file };
  Object.defineProperty(accessor, "version", {
    enumerable: true,
    get() {
      accessed = true;
      return "1";
    }
  });
  await assert.rejects(
    encodeRawArchive([{ file: accessor, body: source.body }], metadata),
    rejection()
  );
  assert.equal(accessed, false);
  await assert.rejects(
    encodeRawArchive(
      [{ ...source, file: Object.assign(Object.create({ bad: true }), source.file) }],
      metadata
    ),
    rejection()
  );
  await assert.rejects(encodeRawArchive([source, source], metadata), rejection());
  await assert.rejects(
    encodeRawArchive([{ ...source, file: { ...source.file, etag: 'W/"weak"' } }], metadata),
    rejection()
  );
  for (const etag of ['"has space"', '"\u0100"']) {
    await assert.rejects(
      encodeRawArchive([{ ...source, file: { ...source.file, etag } }], metadata),
      rejection()
    );
  }
  await assert.rejects(
    encodeRawArchive(
      [{ ...source, file: { ...source.file, size: api.MAX_RAW_SOURCE_BYTES + 1 } }],
      metadata
    ),
    rejection("limit")
  );
  await assert.rejects(
    encodeRawArchive(
      Array.from({ length: 2049 }, () => source),
      metadata
    ),
    rejection("limit")
  );
});

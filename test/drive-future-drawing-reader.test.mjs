import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  root,
  sourceLoader,
  Store,
  harness,
  backup,
  hash,
  tick
} from "./drive-reader-guard-helpers.mjs";
import { authPauseFixture } from "./drive-reader-auth-pause-helpers.mjs";

const load = sourceLoader(root);
const { TOOL_NAMES } = load("model/drawing-model.ts");
const { assertReadableDrivePayload } = load("services/drive/reader-guard.ts");
const { sanitizeDriveBackup, driveBackupDigest } = load("services/drive/backup.ts");
const { DriveSync } = load("services/drive/sync.ts");
const legacy = JSON.parse(
  readFileSync(new URL("./fixtures/drive-reader-legacy.json", import.meta.url), "utf8")
);
const unsupported = (error) => error.code === "unsupported-format";
const malformed = (error) => error.code === "remote-invalid";
const drawing = (name = "segment", id = "fixture") => ({
  id,
  name,
  points: Array.from(
    {
      length: ["horizontalStraightLine", "horizontalRayLine", "verticalStraightLine"].includes(name)
        ? 1
        : name === "fibonacciExtension"
          ? 3
          : 2
    },
    (_, index) => ({ timestamp: 1700000000000 + index * 86400000, value: 10 + index })
  )
});
function future(position = 0) {
  const value = backup();
  value.drawings = [
    {
      symbol: "SBER",
      items: [
        drawing("segment", "one"),
        drawing("horizontalRayLine", "two"),
        drawing("fibonacciExtension", "three")
      ]
    },
    { symbol: "GAZP", items: [drawing("rayLine", "other")] }
  ];
  value.drawings[0].items[position].name = "future-rectangle";
  return value;
}
const writes = (f) =>
  f.events.filter((event) =>
    [
      "editingFlush",
      "bridgeImport",
      "LOCAL_WRITE",
      "CHECKPOINT",
      "saveView",
      "resetCamera"
    ].includes(event.op)
  );
const uploads = (store) => store.events.filter((event) => event.op === "UPLOAD");
let fetchCalls = 0;
const originalFetch = globalThis.fetch;
test.before(() => {
  globalThis.fetch = () => {
    fetchCalls++;
    throw new Error("No network in drawing reader tests");
  };
});
test.after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(fetchCalls, 0);
});

test("all nine drawing kinds and historical fixtures retain exact readable projection", () => {
  const value = backup();
  assert.equal(Object.keys(TOOL_NAMES).length, 9);
  value.drawings = [
    {
      symbol: "SBER",
      items: Object.keys(TOOL_NAMES).map((name, index) => drawing(name, String(index)))
    }
  ];
  for (const raw of [value, ...legacy.fixtures.map((item) => item.payload)]) {
    const before = JSON.stringify(raw);
    assert.deepEqual(assertReadableDrivePayload(raw), sanitizeDriveBackup(raw));
    assert.equal(JSON.stringify(raw), before);
  }
});
test("rectangle and ray text survive Drive validation, while a rectangle must have two anchors", () => {
  const value = backup();
  value.drawings = [
    {
      symbol: "SBER",
      items: [
        { ...drawing("rectangle", "area"), settings: { fill: true, opacity: 0.3 } },
        {
          ...drawing("horizontalRayLine", "ray"),
          settings: { textEnabled: true, text: "Вход", textAlign: "left", textVertical: "top" }
        }
      ]
    }
  ];
  assert.deepEqual(assertReadableDrivePayload(value).drawings, value.drawings);
  value.drawings[0].items[0].points.pop();
  assert.throws(() => assertReadableDrivePayload(value), malformed);
});
for (const position of [0, 1, 2])
  test(`future string kind at position ${position} retains every drawing and group`, () => {
    const value = future(position),
      before = JSON.stringify(value);
    assert.throws(() => assertReadableDrivePayload(value), unsupported);
    assert.equal(JSON.stringify(value), before);
    assert.deepEqual(
      value.drawings.map((group) => group.items.length),
      [3, 1]
    );
  });
test("future kind in another document is also unsupported without rewriting known siblings", () => {
  const value = future();
  value.drawings[0].items[0].name = "segment";
  value.drawings[1].items[0].name = "future-ellipse";
  const before = JSON.stringify(value);
  assert.throws(() => assertReadableDrivePayload(value), unsupported);
  assert.equal(JSON.stringify(value), before);
});
test("capability scan visits actual sparse indices without walking untrusted array length", () => {
  const value = backup(),
    items = [];
  items[4294967294] = drawing("future-rectangle");
  value.drawings = [{ symbol: "SBER", items }];
  const keys = Object.getOwnPropertyNames(items);
  assert.throws(() => assertReadableDrivePayload(value), unsupported);
  assert.deepEqual(Object.getOwnPropertyNames(items), keys);
  assert.equal(items.length, 4294967295);
});
for (const [label, mutate] of [
  [
    "nonstring null name",
    (item) => {
      item.name = null;
    }
  ],
  [
    "nonstring numeric name",
    (item) => {
      item.name = 3;
    }
  ],
  [
    "nonstring object name",
    (item) => {
      item.name = {};
    }
  ],
  [
    "known wrong point count",
    (item) => {
      item.points = [];
    }
  ],
  [
    "known invalid point",
    (item) => {
      item.points[0].value = "not-a-price";
    }
  ],
  [
    "known invalid settings",
    (item) => {
      item.settings = { color: "unsafe" };
    }
  ]
])
  test(`${label} remains remote-invalid`, () => {
    const value = backup();
    value.drawings = [{ symbol: "SBER", items: [drawing()] }];
    mutate(value.drawings[0].items[0]);
    const before = JSON.stringify(value);
    assert.throws(() => assertReadableDrivePayload(value), malformed);
    assert.equal(JSON.stringify(value), before);
  });
for (const path of ["drawings", "group-index", "items", "item-index", "name"])
  test(`poison accessor ${path} is rejected with zero getter calls`, () => {
    const value = backup();
    value.drawings = [{ symbol: "SBER", items: [drawing()] }];
    const group = value.drawings[0],
      items = group.items,
      item = items[0];
    const [target, key] =
      path === "drawings"
        ? [value, "drawings"]
        : path === "group-index"
          ? [value.drawings, "0"]
          : path === "items"
            ? [group, "items"]
            : path === "item-index"
              ? [items, "0"]
              : [item, "name"];
    let calls = 0;
    Object.defineProperty(target, key, {
      enumerable: true,
      configurable: true,
      get() {
        calls++;
        throw new Error("must never execute");
      }
    });
    const before = Object.getOwnPropertyDescriptor(target, key);
    assert.throws(() => assertReadableDrivePayload(value), malformed);
    assert.equal(calls, 0);
    assert.deepEqual(Object.getOwnPropertyDescriptor(target, key), before);
  });

for (const route of [
  "download",
  "same-head-clean",
  "same-head-dirty",
  "publish-parent",
  "manual-import"
])
  test(`${route}: future drawing rejects before editing flush, checkpoint, DB writes or upload`, async (t) => {
    const store = new Store(),
      value = future(1),
      input = JSON.stringify(value);
    const node = await store.snapshot(value);
    const bytes = await store.bodies.get(node.payloadFile.id).text();
    const sync = new DriveSync(store);
    if (route === "download") await assert.rejects(sync.download(node.nodeId), unsupported);
    else if (route === "publish-parent")
      await assert.rejects(
        sync.publish(backup(), { deviceId: crypto.randomUUID(), parents: [node.nodeId] }),
        unsupported
      );
    else {
      const f = await harness(root, store, {
        baseHeads: [node.nodeId],
        lastSyncedDigest:
          route === "same-head-dirty" ? "a".repeat(64) : await driveBackupDigest(backup())
      });
      t.after(() => f.stop());
      const association = structuredClone(f.record());
      f.events.length = 0;
      if (route === "manual-import") {
        await assert.rejects(
          f.transfers.import(value),
          (error) => error instanceof Error && !error.code
        );
      } else {
        await f.connect();
        const status = f.coordinator.getSnapshot();
        assert.equal(status.error, "unsupported-format");
        assert.equal(status.connected, false);
        assert.equal(status.automatic, false);
      }
      assert.deepEqual(writes(f), []);
      assert.deepEqual(f.record(), association);
    }
    assert.deepEqual(uploads(store), []);
    assert.equal(JSON.stringify(value), input);
    assert.equal(await store.bodies.get(node.payloadFile.id).text(), bytes);
  });

async function replacePayload(store, node, value) {
  const body = new Blob([JSON.stringify(value)]),
    sha = await hash(body);
  await store.seed("blob", sha, sha, body);
  const manifest = { ...node.manifest, payload: { sha256: sha, size: body.size } };
  const manifestBody = new Blob([JSON.stringify(manifest)]);
  store.files = store.files.filter((file) => file.appProperties.mtpKey !== manifest.nodeId);
  await store.seed("snapshot", manifest.nodeId, await hash(manifestBody), manifestBody);
}
test("actual AES auth: future drawing suspends handles but preserves ciphertext, credential generation and expiry", async (t) => {
  const f = await authPauseFixture({ remoteUnknown: false });
  t.after(() => f.stop());
  await replacePayload(f.store, f.node, future(1));
  const ciphertext = structuredClone([...f.records]),
    association = structuredClone([...f.associations]);
  const original = await f.loadCredential();
  await f.start();
  assert.equal(f.coordinator.getSnapshot().error, "unsupported-format");
  assert.equal(f.coordinator.getSnapshot().authorizationStored, true);
  assert.equal(f.coordinator.getSnapshot().automatic, false);
  assert.equal(f.handles[0].handle.signal.aborted, true);
  assert.deepEqual([...f.records], ciphertext);
  assert.deepEqual([...f.associations], association);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.localWrites, []);
  assert.deepEqual(f.revocations, []);
  assert.deepEqual(uploads(f.store), []);
  const reopened = f.makeAuth();
  t.after(() => reopened.suspend());
  f.advanceTo(original.issuedAt + 120000);
  const restored = await reopened.restore("owner-A");
  assert.equal(restored.getAccessToken(), original.token);
  assert.equal((await f.loadCredential()).expiresAt, original.expiresAt);
  assert.equal((await f.loadCredential()).credentialId, original.credentialId);
  await tick();
  assert.deepEqual(f.events, []);
});

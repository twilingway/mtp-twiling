import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

test("chart slots share the newest document and serialize edits before an export", async () => {
  const saved = [];
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const load = sourceLoader({
    "services/storage-v2.ts": {
      async saveAnnotationDocument(owner, symbol, drawings) {
        if (!saved.length) await gate;
        saved.push({ owner, symbol, drawings });
      },
      loadDrawings: async () => [],
      loadImages: async () => []
    }
  });
  const broker = load("screens/terminal/workspace-annotations.ts");
  const events = [];
  const stop = broker.subscribeWorkspaceAnnotations((event) => events.push(event));
  const scope = { owner: "test", symbol: "BTCUSDT", images: [] };
  const first = broker.writeWorkspaceAnnotations({
    ...scope,
    editor: {},
    drawings: [{ id: "first" }]
  });
  const second = broker.writeWorkspaceAnnotations({
    ...scope,
    editor: {},
    drawings: [{ id: "first" }, { id: "second" }]
  });
  assert.deepEqual(
    events.map(({ drawings }) => drawings.length),
    [1, 2]
  );
  assert.equal((await broker.readWorkspaceAnnotations("test", "BTCUSDT")).drawings.length, 2);
  assert.equal((await broker.readWorkspaceAnnotations("another", "BTCUSDT")).drawings.length, 0);
  assert.equal(saved.length, 0);
  release();
  await broker.flushWorkspaceAnnotations("test");
  await Promise.all([first, second]);
  assert.deepEqual(
    saved.map(({ drawings }) => drawings.length),
    [1, 2]
  );
  stop();
});

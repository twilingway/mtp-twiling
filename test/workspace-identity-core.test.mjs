import test from "node:test";
import assert from "node:assert/strict";
import { createGuestFixture } from "./helpers/guest-recovery-database.mjs";

const row = (uid) => ({ uid, symbol: uid.toUpperCase(), name: uid });
const drawing = (price) => ({
  id: "same",
  name: "horizontalStraightLine",
  points: [{ timestamp: 1, value: price }]
});
const source = (owner, layout = {}, rows = [], drawings = []) => ({
  owner,
  physical: owner,
  backup: {
    application: "personal-terminal",
    schemaVersion: 2,
    layout,
    watchlist: rows,
    drawings,
    images: []
  },
  images: [],
  cameras: [],
  history: [],
  coverage: [],
  populated: true
});

test("pure merge retains primary settings/order/selection, fills missing fields and archives conflicts", async () => {
  const f = await createGuestFixture(),
    { mergeDeviceWorkspace } = f.load("model/workspace-identity.ts");
  const first = source(
    "public",
    {
      engine: "kline",
      chartSettings: { grid: false, futureSafeField: "preserved" },
      symbol: "AAA",
      instrumentUid: "a"
    },
    [row("a")]
  );
  const second = source(
    "bank",
    {
      engine: "tradingview",
      chartSettings: { grid: true, scaleFontSize: 13 },
      symbol: "BBB",
      instrumentUid: "b"
    },
    [row("b"), row("a")]
  );
  const before = structuredClone([first, second]),
    result = mergeDeviceWorkspace([first, second]);
  const layout = result.writes.find(({ value }) => value.id === "layout:profile-v2:device").value
    .value;
  assert.deepEqual(layout, {
    engine: "kline",
    chartSettings: { grid: false, futureSafeField: "preserved", scaleFontSize: 13 },
    symbol: "AAA",
    instrumentUid: "a"
  });
  assert.deepEqual(
    result.writes
      .find(({ value }) => value.id === "watchlist:profile-v2:device")
      .value.value.map((row) => row.uid),
    ["a", "b"]
  );
  assert.ok(result.conflicts.some((entry) => entry.key === "engine"));
  assert.deepEqual([first, second], before);
});

test("drawing and image identity collisions preserve both contents with stable remaps and deduplicate equal entities", async () => {
  const f = await createGuestFixture(),
    { mergeDeviceWorkspace } = f.load("model/workspace-identity.ts");
  const a = source("public", {}, [], [{ symbol: "AAA", items: [drawing(1)] }]),
    b = source("bank", {}, [], [{ symbol: "AAA", items: [drawing(2)] }]);
  const image = (owner, content) => ({
    image: {
      id: owner,
      syncId: "same-image",
      owner,
      symbol: "AAA",
      name: "img",
      blob: new Blob([content], { type: "image/png" }),
      point: { timestamp: 1, value: 1 },
      width: 100
    },
    content
  });
  a.images = [image("public", "one")];
  b.images = [image("bank", "two"), image("duplicate", "one")];
  const result = mergeDeviceWorkspace([a, b]),
    repeat = mergeDeviceWorkspace([a, b]);
  assert.deepEqual(result.writes, repeat.writes);
  const doc = result.writes.find(({ store }) => store === "drawings").value;
  assert.equal(doc.items.length, 2);
  assert.notEqual(doc.items[0].id, doc.items[1].id);
  assert.equal(result.writes.filter(({ store }) => store === "images").length, 2);
  assert.equal(result.conflicts.filter(({ kind }) => kind === "object-remap").length, 2);
});

test("indicator collisions remap pane references and preserve independent pane sizing", async () => {
  const f = await createGuestFixture(),
    { mergeDeviceWorkspace } = f.load("model/workspace-identity.ts"),
    { createTechnicalIndicatorInstance } = f.load("model/technical-indicators/instances.ts");
  const first = createTechnicalIndicatorInstance("rsi", "same", { params: { length: 14 } });
  const second = createTechnicalIndicatorInstance("rsi", "same", { params: { length: 21 } });
  const a = source("public", {
    technicalIndicators: [first],
    technicalPaneLayout: [{ paneId: "same", heightRatio: 0.2, collapsed: false }]
  });
  const b = source("bank", {
    technicalIndicators: [second],
    technicalPaneLayout: [{ paneId: "same", heightRatio: 0.3, collapsed: true }]
  });
  const result = mergeDeviceWorkspace([a, b]),
    layout = result.writes.find(({ value }) => value.id === "layout:profile-v2:device").value.value;
  assert.equal(layout.technicalIndicators.length, 2);
  assert.notEqual(layout.technicalIndicators[0].id, layout.technicalIndicators[1].id);
  assert.notEqual(layout.technicalIndicators[0].pane.id, layout.technicalIndicators[1].pane.id);
  assert.deepEqual(
    layout.technicalPaneLayout.map((pane) => pane.heightRatio),
    [0.2, 0.3]
  );
  assert.equal(layout.technicalIndicators[1].pane.id, layout.technicalPaneLayout[1].paneId);
});

test("combined limits reject the whole plan", async () => {
  const f = await createGuestFixture(),
    { mergeDeviceWorkspace } = f.load("model/workspace-identity.ts");
  assert.throws(
    () =>
      mergeDeviceWorkspace([
        source(
          "public",
          {},
          Array.from({ length: 200 }, (_, index) => row(`a${index}`))
        ),
        source(
          "bank",
          {},
          Array.from({ length: 200 }, (_, index) => row(`b${index}`))
        )
      ]),
    RangeError
  );
});

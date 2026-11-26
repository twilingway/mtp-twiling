import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const { WorkspaceSync, DEFAULT_WORKSPACE_SYNC_FLAGS } = sourceLoader()(
  "screens/terminal/workspace-sync.ts"
);
const flags = (changes) => ({ ...DEFAULT_WORKSPACE_SYNC_FLAGS, ...changes });
const tick = () => new Promise(setImmediate);

function deferred() {
  let release;
  const promise = new Promise((resolve) => (release = resolve));
  return { promise, release };
}

function panel(initialUid, interval, view = null) {
  const calls = [];
  let instrument = initialUid;
  let timeframe = interval;
  return {
    calls,
    readInstrument: () => instrument,
    readTimeframe: () => timeframe,
    readViewport: () => view,
    setInstrument(uid, intent) {
      assert.ok(intent.isCurrent());
      instrument = uid;
      calls.push(["instrument", uid]);
    },
    setTimeframe(next, intent) {
      assert.ok(intent.isCurrent());
      timeframe = next;
      calls.push(["timeframe", next]);
    },
    setCrosshair: (timestamp) => calls.push(["crosshair", timestamp]),
    setViewport: (intent) => calls.push(["viewport", intent])
  };
}

test("independence is the default; enabling linked routes copies the active UID and interval", async () => {
  const sync = new WorkspaceSync();
  const first = panel("bybit:spot:BTCUSDT", "5m");
  const second = panel("okx:spot:BTC-USDT", "1d");
  sync.register(1, first);
  sync.register(2, second);
  sync.publishInstrument(1);
  sync.publishTimeframe(1, "1h");
  sync.publishCrosshair(1, 1720000000000);
  sync.publishViewport(1, { from: 1720000000000, to: 1720000090000 });
  await tick();
  assert.deepEqual(second.calls, []);

  sync.configure(flags({ instrument: true, timeframe: true }), 2);
  await tick();
  assert.deepEqual(first.calls, [
    ["instrument", "okx:spot:BTC-USDT"],
    ["timeframe", "1d"]
  ]);
  assert.deepEqual(second.calls, []);

  sync.configure(flags({ instrument: true, timeframe: true }), 1);
  sync.configure(flags({}), 1);
  sync.publishInstrument(2, "SBER");
  sync.publishTimeframe(2, "1h");
  await tick();
  assert.equal(first.readInstrument(), "okx:spot:BTC-USDT");
  assert.equal(first.readTimeframe(), "1d");
  assert.equal(first.calls.length, 2);
});

test("configured flags seed existing peers when the active source registers later", async () => {
  const sync = new WorkspaceSync();
  const first = panel("FIRST", "1d");
  sync.configure(flags({ instrument: true, timeframe: true }), 2);
  sync.register(1, first);
  assert.deepEqual(first.calls, []);
  sync.register(2, panel("SECOND", "2h"));
  await tick();
  assert.deepEqual(first.calls, [
    ["instrument", "SECOND"],
    ["timeframe", "2h"]
  ]);
});

test("crosshair carries only time, suppresses follow-up echoes, and clears when source leaves", () => {
  const sync = new WorkspaceSync();
  const first = panel("FIRST", "1d");
  const second = panel("SECOND", "1h");
  const original = second.setCrosshair;
  second.setCrosshair = (timestamp) => {
    original(timestamp);
    sync.publishCrosshair(2, timestamp);
  };
  const timestamp = Date.UTC(2026, 3, 6, 6);
  sync.register(1, first);
  sync.register(2, second);
  sync.configure(flags({ crosshair: true }), 1);
  sync.publishCrosshair(1, timestamp);
  sync.publishCrosshair(1, timestamp);
  assert.deepEqual(first.calls, []);
  assert.deepEqual(second.calls, [["crosshair", timestamp]]);

  sync.publishCrosshair(2, timestamp + 60_000);
  sync.publishCrosshair(1, null);
  assert.deepEqual(first.calls, [["crosshair", timestamp + 60_000]]);
  assert.deepEqual(second.calls.at(-1), ["crosshair", null]);
  sync.publishCrosshair(2, null);
  assert.deepEqual(first.calls.at(-1), ["crosshair", null]);

  sync.publishCrosshair(1, timestamp);
  sync.configure(flags({}), 1);
  assert.deepEqual(second.calls.at(-1), ["crosshair", null]);
});

test("only user viewport events propagate; date range takes priority over a right anchor", () => {
  const sync = new WorkspaceSync();
  const view = { from: Date.UTC(2026, 3, 6, 6), to: Date.UTC(2026, 3, 7, 14) };
  const first = panel("FIRST", "1d", view);
  const second = panel("SECOND", "1h");
  const receive = second.setViewport;
  second.setViewport = (intent) => {
    receive(intent);
    sync.publishViewport(2, view);
  };
  sync.register(1, first);
  sync.register(2, second);
  sync.configure(flags({ time: true }), 1);
  assert.deepEqual(second.calls, []);
  sync.publishViewport(1);
  assert.deepEqual(second.calls, [["viewport", { kind: "time", to: view.to }]]);

  sync.configure(flags({ time: true, dateRange: true }), 1);
  sync.publishViewport(1, view);
  sync.publishViewport(1, { from: view.to, to: view.from });
  sync.publishViewport(1, { from: view.from, to: NaN });
  assert.deepEqual(second.calls.at(-1), ["viewport", { kind: "dateRange", ...view }]);
  assert.equal(second.calls.length, 2);
  assert.deepEqual(first.calls, []);
});

test("the last user routes win, apply instrument first, and reach a reopened slot", async () => {
  const sync = new WorkspaceSync();
  const source = panel("FIRST", "1d");
  const target = panel("SECOND", "1h");
  const oldHidden = panel("THIRD", "1m");
  const applying = deferred();
  const release = deferred();
  const storeInstrument = target.setInstrument;
  let stale;
  target.setInstrument = async (uid, intent) => {
    if (uid === "FIRST") {
      stale = intent;
      applying.release();
      await release.promise;
    }
    if (intent.isCurrent()) storeInstrument(uid, intent);
  };
  sync.register(1, source);
  sync.register(2, target);
  const hide = sync.register(3, oldHidden);
  sync.configure(flags({ instrument: true, timeframe: true }), 1);
  await applying.promise;
  hide();

  sync.publishTimeframe(1, "5m");
  sync.publishInstrument(1, "okx:spot:BTC-USDT");
  sync.publishTimeframe(1, "1w");
  sync.publishInstrument(1, "bybit:spot:BTCUSDT");
  sync.publishTimeframe(1, "1M");
  const reopened = panel("EMPTY", "1d");
  sync.register(3, reopened);
  hide();
  assert.deepEqual([stale.signal.aborted, stale.isCurrent()], [true, false]);
  release.release();
  await tick();
  const expected = [
    ["instrument", "bybit:spot:BTCUSDT"],
    ["timeframe", "1M"]
  ];
  assert.deepEqual(target.calls, expected);
  assert.deepEqual(reopened.calls, expected);
  assert.equal(source.readInstrument(), "FIRST");
});

test("a user action on a follower cancels its incoming route and moves the other panels", async () => {
  const sync = new WorkspaceSync();
  const source = panel("FIRST", "1d");
  const target = panel("SECOND", "1h");
  const release = deferred();
  let displaced;
  const apply = target.setInstrument;
  target.setInstrument = async (uid, intent) => {
    displaced = intent;
    await release.promise;
    if (intent.isCurrent()) apply(uid, intent);
  };
  sync.register(1, source);
  sync.register(2, target);
  sync.configure(flags({ instrument: true }), 1);
  sync.publishInstrument(2, "user-exact");
  assert.equal(displaced.signal.aborted, true);
  release.release();
  await tick();
  assert.deepEqual(source.calls, [["instrument", "user-exact"]]);
  assert.deepEqual(target.calls, []);
});

test("replacing a registration or resetting the profile aborts stale intents and clears the link", async () => {
  const sync = new WorkspaceSync();
  const first = panel("FIRST", "1d");
  const old = panel("OLD", "1h");
  const replacement = panel("REPLACEMENT", "1h");
  const gate = deferred();
  let replaced;
  let reset;
  old.setInstrument = async (_uid, intent) => {
    replaced = intent;
    await gate.promise;
  };
  replacement.setInstrument = async (_uid, intent) => {
    reset = intent;
    await gate.promise;
  };
  sync.register(1, first);
  const forget = sync.register(2, old);
  sync.configure(flags({ instrument: true, crosshair: true }), 1);
  sync.publishCrosshair(1, Date.UTC(2026, 3, 6));
  sync.register(2, replacement);
  forget();
  assert.equal(replaced.isCurrent(), false);
  assert.equal(replaced.signal.aborted, true);
  assert.equal(reset.isCurrent(), true);
  assert.equal(old.calls.at(-1)[1], null);
  sync.reset();
  assert.equal(reset.isCurrent(), false);
  assert.equal(reset.signal.aborted, true);
  assert.equal(replacement.calls.at(-1)[1], null);
  sync.publishInstrument(1, "ignored-without-configure");
  gate.release();
  await tick();
  assert.equal(first.readInstrument(), "FIRST");
});

test("missing instruments or unsupported intervals never fall back or block other slots", async () => {
  const sync = new WorkspaceSync();
  const first = panel(null, "1d");
  const second = panel("SECOND", "1h");
  const third = panel("THIRD", "1h");
  const requested = [];
  second.setInstrument = async (uid) => {
    requested.push(uid);
    throw new Error("Unavailable");
  };
  second.setTimeframe = () => {
    throw new Error("Unsupported");
  };
  const follow = third.setInstrument;
  third.setInstrument = (uid, intent) => {
    follow(uid, intent);
    sync.publishInstrument(3, "unwanted-echo");
  };
  sync.register(1, first);
  sync.register(2, second);
  sync.register(3, third);
  sync.configure(flags({ instrument: true, timeframe: true }), 1);
  sync.publishInstrument(1, null);
  sync.publishInstrument(1, "okx:spot:BTC-USDT");
  sync.publishTimeframe(1, "1w");
  await tick();
  assert.deepEqual(second.calls, []);
  assert.deepEqual(requested, ["okx:spot:BTC-USDT"]);
  assert.equal(second.readInstrument(), "SECOND");
  assert.equal(second.readTimeframe(), "1h");
  assert.equal(third.readInstrument(), "okx:spot:BTC-USDT");
  assert.equal(third.readTimeframe(), "1w");
  assert.deepEqual(first.calls, []);
});

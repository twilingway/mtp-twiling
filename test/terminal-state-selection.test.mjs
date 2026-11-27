import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { selectedSnapshot, shallowEqual } = load("screens/terminal/snapshot-selector.ts");
const { shareMarketRows } = load("screens/terminal/market-state-sharing.ts");
const { equalTerminalState, selectShellState, selectToolbarState, selectControlsState, selectPanelState } = load(
  "screens/terminal/terminal-state-selection.ts"
);
const row = (uid, price = 10) => ({
  uid, symbol: uid, ticker: uid, name: uid, price, time: "2026-11-27T00:00:00Z"
});
const fixture = () => ({
  owner: "profile", ready: true, authenticated: true, status: "connected", name: "Name",
  preferences: { symbol: "A", instrumentUid: "A", timeframe: "1d", rightPanelCollapsed: false },
  rows: [row("A"), row("B")], pricesDirection: new Map(), candles: [], dialog: null
});

test("unrelated mutable provider quotes retain instrument snapshots and direction identity", () => {
  const before = fixture();
  const mutable = before.rows.map((item) => ({ ...item }));
  mutable[1].price = 12;
  const changed = shareMarketRows(before, mutable);
  assert.equal(changed.rows[0], before.rows[0]);
  assert.notEqual(changed.rows[1], before.rows[1]);
  assert.equal(before.rows[1].price, 10);
  assert.equal(before.pricesDirection.size, 0);
  assert.equal(changed.pricesDirection.get("B"), "positive");
  mutable[1].price = 13;
  const again = shareMarketRows({ ...before, ...changed }, mutable);
  assert.equal(again.pricesDirection, changed.pricesDirection);
  assert.equal(changed.rows[1].price, 12);
  const unchanged = shareMarketRows({ ...before, ...again }, mutable);
  assert.equal(unchanged.rows, again.rows);
  assert.equal(unchanged.pricesDirection, again.pricesDirection);
});

test("instrument UID separates identical symbols and metadata changes still propagate", () => {
  const before = fixture();
  before.rows = [{ ...row("one"), symbol: "SAME" }, { ...row("two"), symbol: "SAME" }];
  const next = before.rows.map((item) => ({ ...item }));
  next[1].name = "Changed metadata";
  const result = shareMarketRows(before, next);
  assert.equal(result.rows[0], before.rows[0]);
  assert.equal(result.rows[1].name, "Changed metadata");
  assert.notEqual(result.rows[1], before.rows[1]);
});

test("quote and candle replay leaves static slices unchanged while live quotes stay current", () => {
  let state = fixture();
  const get = () => state;
  const readers = [selectShellState, selectToolbarState, selectControlsState, selectPanelState]
    .map((select) => selectedSnapshot(get, select, shallowEqual));
  const initial = readers.map((read) => read());
  const full = selectedSnapshot(get, (snapshot) => snapshot);
  const livePrice = selectedSnapshot(get, (snapshot) => snapshot.rows[0].price);
  const before = full();
  assert.equal(livePrice(), 10);
  for (let tick = 1; tick <= 10; tick++) {
    const latest = state.rows.map((item) => ({ ...item }));
    latest[tick % 2].price += 1;
    state = { ...state, ...shareMarketRows(state, latest), candles: [{ close: tick }] };
    readers.forEach((read, index) => assert.equal(read(), initial[index]));
  }
  assert.equal(livePrice(), 15);
  assert.notEqual(full(), before);
});

test("active chart routing and account/profile transitions invalidate their subscribed slices", () => {
  let state = fixture();
  const toolbar = selectedSnapshot(() => state, selectToolbarState, shallowEqual);
  const shell = selectedSnapshot(() => state, selectShellState, shallowEqual);
  const initialToolbar = toolbar();
  const initialShell = shell();
  state = { ...state, preferences: { ...state.preferences, symbol: "B", instrumentUid: "B" } };
  assert.equal(toolbar().selectedTicker, "B");
  assert.notEqual(toolbar(), initialToolbar);
  assert.equal(shell(), initialShell);
  const selected = toolbar();
  state = { ...state, status: "offline" };
  assert.notEqual(toolbar(), selected);
  state = { ...state, owner: "other", profileTransition: true };
  assert.notEqual(shell(), initialShell);
  assert.equal(toolbar().profileTransition, true);
  assert.equal(shell().owner, "other");
});

test("a selector never returns a fresh object for the same snapshot", () => {
  const state = fixture();
  const read = selectedSnapshot(() => state, (snapshot) => ({ price: snapshot.rows[0].price }));
  assert.equal(read(), read());
});

test("the default terminal snapshot ignores only crosshair, including clear", () => {
  let state = { ...fixture(), crosshairBar: null };
  const read = selectedSnapshot(() => state, (snapshot) => snapshot, equalTerminalState);
  const initial = read();
  for (let timestamp = 0; timestamp < 100; timestamp++) {
    state = { ...state, crosshairBar: { timestamp } };
    assert.equal(read(), initial);
  }
  state = { ...state, crosshairBar: null };
  assert.equal(read(), initial);
  for (const [key, value] of Object.entries({
    ...fixture(), candles: [{ close: 12 }], preferences: { symbol: "B" },
    importingBackup: true, importRecoveryRequired: true, historyViewReady: false,
    historyViewFallback: true, loading: true, historyHelp: "retry", chartRevision: 2,
    selectedObject: "drawing", toast: "Saved", futureField: undefined
  })) {
    const before = read();
    state = { ...state, [key]: value !== null && typeof value === "object" ? structuredClone(value) : `${value}-changed` };
    assert.notEqual(read(), before, `${key} must invalidate`);
    assert.equal(read(), state);
  }
  const before = read();
  const { futureField: removed, ...next } = state;
  state = next;
  assert.notEqual(read(), before);
  assert.ok(removed);
});

test("explicit selectors retain Object.is semantics on crosshair-only snapshots", () => {
  let state = { ...fixture(), crosshairBar: null };
  const full = selectedSnapshot(() => state, (snapshot) => snapshot);
  const fresh = selectedSnapshot(() => state, (snapshot) => ({ rows: snapshot.rows }));
  const hover = selectedSnapshot(() => state, (snapshot) => snapshot.crosshairBar);
  const before = [full(), fresh(), hover()];
  state = { ...state, crosshairBar: { timestamp: 10 } };
  [full, fresh, hover].forEach((read, index) => assert.notEqual(read(), before[index]));
  assert.equal(hover(), state.crosshairBar);
});

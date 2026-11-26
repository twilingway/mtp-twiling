import assert from "node:assert/strict";
import test from "node:test";
import * as react from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createGuestFixture } from "./helpers/guest-recovery-database.mjs";
import { deferred, row, sourceModules } from "./helpers/watchlist-sections.mjs";

function render(patch) {
  const state = {
    owner: "guest",
    preferences: { locale: "ru" },
    pricesDirection: new Map(),
    rows: [],
    ...patch
  };
  const controller = { getSnapshot: () => state, subscribe: () => () => {} };
  const load = sourceModules({
    react,
    "react/jsx-runtime": jsx,
    "react-dom": { createPortal: (element) => element },
    "screens/terminal/context.tsx": { useTerminal: () => ({ state, controller }) }
  });
  const { WatchlistSectionsTable } = load("screens/terminal/WatchlistSectionsTable.js");
  return renderToStaticMarkup(
    jsx.jsx(WatchlistSectionsTable, {
      query: "",
      sort: null,
      direction: -1,
      onSort: () => {},
      onManualOrder: () => {}
    })
  );
}

test("initial unresolved rows show a labelled, decorative staircase", () => {
  const html = render({
    watchlistStartup: "loading",
    rows: [{ ...row("PLACEHOLDER", null), price: null, availability: "unavailable" }]
  });
  assert.match(html, /<tbody id="quotes" aria-busy="true"><\/tbody>/);
  assert.match(html, /watchlist-startup-status" role="status"/);
  assert.match(html, /watchlist-loading-chart" aria-hidden="true"/);
  assert.match(html, /Загрузка списка котировок/);
  assert.doesNotMatch(html, /PLACEHOLDER|empty-search/);
});

test("stored quote rows remain visible while startup or candle loading is in progress", () => {
  const html = render({ watchlistStartup: "loading", loading: true, rows: [row("SBER")] });
  assert.match(html, /data-symbol="SBER"/);
  assert.doesNotMatch(html, /watchlist-loading-chart|aria-busy/);
});

test("settled empty, error, and chart-only loading use their respective states", () => {
  for (const values of [{ watchlistStartup: "ready" }, { loading: true }]) {
    const empty = render(values);
    assert.match(empty, /id="empty-search"/);
    assert.doesNotMatch(empty, /watchlist-loading-chart/);
  }
  const failed = render({ watchlistStartup: "error", preferences: { locale: "en" } });
  assert.match(failed, /Could not load the watchlist/);
  assert.doesNotMatch(failed, /watchlist-loading-chart|empty-search/);
});

const rememberedToken = `t.${"a".repeat(40)}`;
const manualToken = `t.${"b".repeat(40)}`;

async function activationFixture(restoreSession, bankStart) {
  const fixture = await createGuestFixture();
  fixture.storage.restoreSession = restoreSession;
  fixture.storage.migrateLegacy = async () => {};
  fixture.storage.saveSession = async () => {};
  fixture.load("services/profile-key.ts").profileKey = async (token) =>
    token === rememberedToken ? "bank-A" : "bank-B";
  fixture.load("services/tbank-client.ts").TBankClient = class extends EventTarget {
    rows = [];
    authenticated = true;
    constructor(token) {
      super();
      this.token = token;
    }
    snapshot() {
      return { rows: this.rows, status: "connected" };
    }
    async start() {
      await bankStart(this.token);
      return this.snapshot();
    }
    async flush() {}
    async close() {}
  };
  const { defaultPreferences } = fixture.load("screens/terminal/controller-bridge.ts");
  const { TerminalSession } = fixture.load("screens/terminal/controller-session.ts");
  let state = {
    owner: "guest",
    preferences: defaultPreferences(),
    rows: [],
    candles: [],
    pricesDirection: new Map(),
    watchlistStartup: "loading"
  };
  const notes = [];
  const session = new TerminalSession({
    getState: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    resetHistory: () => {},
    notify: (message) => notes.push(message),
    loadHistory: async () => {},
    flush: async () => {},
    isClearingHistory: () => false
  });
  return { session, state: () => state, notes };
}

test("a superseded saved login leaves startup pending until the current empty watchlist arrives", async () => {
  const firstStarted = deferred();
  const firstFinished = deferred();
  const secondStarted = deferred();
  const secondFinished = deferred();
  const { session, state, notes } = await activationFixture(
    async () => ({ token: rememberedToken, name: "remembered" }),
    async (token) => {
      if (token === rememberedToken) {
        firstStarted.resolve();
        await firstFinished.promise;
      } else {
        secondStarted.resolve();
        await secondFinished.promise;
      }
    }
  );
  try {
    const startup = session.start();
    await firstStarted.promise;
    assert.equal(state().watchlistStartup, "loading");
    const manual = session.login(manualToken, "manual", false);
    await secondStarted.promise;
    firstFinished.resolve();
    await startup;
    assert.equal(state().profileTransition, true);
    assert.equal(state().watchlistStartup, "loading");
    assert.deepEqual(notes, []);
    secondFinished.resolve();
    await manual;
    assert.equal(state().owner, "bank-B");
    assert.equal(state().watchlistStartup, "ready");
    assert.deepEqual(state().rows, []);
  } finally {
    firstFinished.resolve();
    secondFinished.resolve();
    session.dispose();
  }
});

test("manual login may replace session restoration and alone settle startup", async () => {
  for (const failed of [false, true]) {
    const restoration = deferred();
    const { session, state, notes } = await activationFixture(
      () => restoration.promise,
      async () => {
        if (failed) throw new Error("Synthetic login failure");
      }
    );
    try {
      const startup = session.start();
      const manual = session.login(manualToken, "manual", false);
      restoration.resolve(undefined);
      await startup;
      if (failed) await assert.rejects(manual, /Synthetic login failure/);
      else await manual;
      assert.equal(state().watchlistStartup, failed ? "error" : "ready");
      assert.deepEqual(notes, []);
    } finally {
      restoration.resolve(undefined);
      session.dispose();
    }
  }
});

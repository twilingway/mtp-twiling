import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { deferred, sourceModules } from "./helpers/watchlist-sections.mjs";

const load = sourceModules({ react: React, "react/jsx-runtime": jsx });
const { GoogleCompactionSettings } = load("screens/terminal/GoogleCompactionSettings.tsx");
load("i18n/preferences.ts").setDisplayPreferences({ locale: "en" });

test("cloud cleanup retry preserves the confirmed sync time and existing send receipt", () => {
  const state = { ready: true, preferences: { locale: "en" } };
  const cloud = sourceModules({
    react: React,
    "react/jsx-runtime": jsx,
    "screens/terminal/context.tsx": { useTerminal: (select) => ({ state: select(state) }) }
  });
  cloud("i18n/preferences.ts").setDisplayPreferences({ locale: "en" });
  const { CloudProviderSettings } = cloud("screens/terminal/CloudProviderSettings.tsx");
  const status = {
    enabled: true,
    configured: true,
    prepared: true,
    connected: true,
    phase: "idle",
    lastSyncedAt: "2026-11-27T12:00:00.000Z",
    choiceAction: { state: "confirmed", selection: { kind: "local" } },
    retention: { phase: "pending", keptFiles: 2, error: "network" }
  };
  const provider = {
    id: "yandex-disk",
    getSnapshot: () => status,
    subscribe: () => () => {}
  };
  const html = renderToStaticMarkup(React.createElement(CloudProviderSettings, { provider }));
  assert.match(html, /Data saved\. Cleanup of old versions is waiting to be retried/);
  assert.match(html, /Files kept 2/);
  assert.match(html, /<time dateTime="2026-11-27T12:00:00.000Z">/);
  assert.match(html, /id="yandex-disk-choice-result" role="status"/);
  assert.match(html, /id="yandex-disk-sync-now" type="button"/);
  assert.doesNotMatch(html, /Files deleted|role="alert"|Sync stopped/);
});

const archive = {
  id: "exact-archive",
  createdAt: "2026-11-27T12:00:00.000Z",
  bytes: 2048,
  fileCount: 18
};

function props(status = {}, google = {}, blocked = false) {
  return {
    status: { connected: true, ...status },
    blocked,
    google: {
      compactLegacy: async () => {},
      inspectLegacyArchives: async () => {},
      downloadLegacyRawArchive: async () => undefined,
      inspectLateLegacy: async () => [],
      ...google
    }
  };
}

function render(status, blocked) {
  return renderToStaticMarkup(
    React.createElement(GoogleCompactionSettings, props(status, {}, blocked))
  );
}

test("Google cleanup displays verified counts, nonfatal pause, and preserved archive status", () => {
  assert.match(
    render({}),
    /After cleanup, older versions of the app need to be updated\. Saved archives stay in the cloud\.<\/p><button class="cloud-retention-compact"/
  );
  const details = {
    archivedFiles: 18,
    deletedFiles: 10,
    pendingFiles: 7,
    changedFiles: 1
  };
  const active = render({ compaction: { phase: "delete", ...details } });
  assert.match(active, /data-phase="delete"/);
  assert.match(active, /<progress aria-label="Removing old files from Google Drive…"><\/progress>/);
  assert.match(active, /Archived<\/dt><dd>18<\/dd>/);
  assert.match(active, /Deleted<\/dt><dd>10<\/dd>/);
  assert.match(active, /Pending deletion<\/dt><dd>7<\/dd>/);
  assert.match(active, /Changed and kept<\/dt><dd>1<\/dd>/);
  assert.match(active, /The archive was saved and verified on Google Drive/);
  assert.match(active, /cloud-retention-compact" type="button" disabled=""/);
  const paused = render({ compaction: { phase: "paused", ...details } });
  assert.match(paused, /Old file cleanup is paused/);
  assert.match(paused, /type="button">Retry cleanup<\/button>/);
  assert.doesNotMatch(paused, /<progress|Sync failed/);
  assert.match(render({ compaction: { phase: "complete", ...details } }), /cleanup is complete/);
  assert.doesNotMatch(
    render({ compaction: { phase: "paused", error: "not-ready" } }),
    /<dd>|archive was saved/
  );
});

test("Google inventory checking shows real progress without confirming an archive", () => {
  for (const checkedFiles of [0, 20, 179]) {
    const html = render({ compaction: { phase: "checking", checkedFiles, totalFiles: 179 } });
    assert.match(html, new RegExp(`<progress [^>]*max="179" value="${checkedFiles}">`));
    assert.match(html, new RegExp(`Files checked</dt><dd>${checkedFiles} of 179</dd>`));
    assert.doesNotMatch(html, /Archived<\/dt>|The archive was saved and verified/);
  }
  for (const counts of [{}, { checkedFiles: 20 }, { checkedFiles: 180, totalFiles: 179 }]) {
    const unknown = render({ compaction: { phase: "checking", ...counts } });
    assert.match(unknown, /<progress aria-label="Checking old Google Drive files…"><\/progress>/);
    assert.doesNotMatch(unknown, /Files checked/);
  }
  const paused = render({ compaction: { phase: "paused", checkedFiles: 20, totalFiles: 179 } });
  assert.match(paused, /Files checked<\/dt><dd>20 of 179<\/dd>/);
  assert.doesNotMatch(paused, /<progress|The archive was saved and verified/);
});

test("Google history is collapsed and only displays known archive metadata", () => {
  const html = render({
    legacyArchives: [archive, { ...archive, id: "unknown-date", createdAt: "", bytes: 201 }]
  });
  const unknownCount = render({
    legacyArchives: [{ id: "unknown-count", createdAt: "", bytes: 201 }]
  });
  assert.match(html, /<details class="cloud-retention-history">/);
  assert.match(html, /<time dateTime="2026-11-27T12:00:00.000Z">/);
  assert.match(html, /2,048 byte · Files in archive 18/);
  assert.match(unknownCount, /Date unknown/);
  assert.doesNotMatch(unknownCount, /Files in archive|Invalid Date|0 byte/);
  assert.doesNotMatch(render({}), /There are no saved archives yet/);
  assert.match(render({ legacyArchives: [] }), /There are no saved archives yet/);
  const disconnected = render({ connected: false, legacyArchives: [archive] });
  assert.match(disconnected, /Connect Google Drive to clean up old files and view archives/);
  assert.equal((disconnected.match(/type="button" disabled=""/g) ?? []).length, 3);
  assert.doesNotMatch(disconnected, /Download saved archive/);
  assert.match(
    render({ migrationRequired: true }),
    /cloud-retention-compact" type="button" disabled=""/
  );
  assert.match(render({}, true), /cloud-retention-compact" type="button" disabled=""/);
});

test("Google review reports actual late legacy entries independently of archive and sync results", () => {
  assert.doesNotMatch(render({}), /There are no new legacy records/);
  assert.match(render({ legacyLateChanges: [] }), /There are no new legacy records/);
  const html = render({
    legacyLateChanges: [
      { namespace: "mtp-drive-v1", snapshotIds: ["one"], headIds: ["one"] },
      { namespace: "mtp-drive-v2", snapshotIds: ["two", "three"], headIds: ["three"] }
    ]
  });
  assert.match(html, /New legacy snapshots 3\. These snapshots need review/);
  assert.doesNotMatch(html, /mtp-drive-v|Review confirmed|Sync stopped/);
});

function nullContainer() {
  class Element {}
  return {
    nodeType: 1,
    tagName: "DIV",
    nodeName: "DIV",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: {
      nodeType: 9,
      addEventListener() {},
      activeElement: null,
      defaultView: { HTMLElement: Element, HTMLIFrameElement: class extends Element {} }
    },
    addEventListener() {},
    removeEventListener() {}
  };
}

function button(tree, label) {
  for (const item of React.Children.toArray(tree)) {
    if (!React.isValidElement(item)) continue;
    if (item.type === "button" && item.props.children === label) return item;
    const found = button(
      typeof item.type === "function" ? item.type(item.props) : item.props.children,
      label
    );
    if (found) return found;
  }
}

test("Google maintenance reads and downloads exact archives only when invoked and cleans its URL", async (t) => {
  const savedWindow = globalThis.window,
    savedDocument = globalThis.document,
    originalTimeout = globalThis.setTimeout;
  globalThis.window = { event: undefined, HTMLIFrameElement: class {} };
  const root = createRoot(nullContainer());
  const calls = [];
  const wait = deferred();
  const body = new Blob(["archive"]);
  let view, revocation;
  const link = {
    click() {
      calls.push(["save", this.href, this.download]);
    },
    remove() {
      calls.push(["remove"]);
    }
  };
  const settings = props(
    { legacyArchives: [archive] },
    {
      compactLegacy: async () => calls.push(["compact"]),
      inspectLegacyArchives: async () => {
        calls.push(["inspect"]);
        await wait.promise;
      },
      downloadLegacyRawArchive: async (id) => {
        calls.push(["download", id]);
        return body;
      },
      inspectLateLegacy: async () => {
        calls.push(["late"]);
        return [];
      }
    }
  );
  function Reader() {
    view = GoogleCompactionSettings(settings);
    return null;
  }
  try {
    flushSync(() => root.render(React.createElement(Reader)));
    assert.deepEqual(calls, []);
    const inspect = button(view, "Check archives");
    flushSync(() => inspect.props.onClick());
    assert.deepEqual(calls, [["inspect"]]);
    assert.equal(button(view, "Download saved archive").props.disabled, true);
    assert.equal(button(view, "Save an archive and clean up old files").props.disabled, true);
    wait.resolve();
    await new Promise(setImmediate);
    flushSync(() => root.render(React.createElement(Reader)));
    globalThis.document = {
      createElement: (tag) => {
        assert.equal(tag, "a");
        return link;
      },
      body: { append: (node) => assert.equal(node, link) }
    };
    t.mock.method(URL, "createObjectURL", (value) => {
      assert.equal(value, body);
      return "blob:synthetic";
    });
    const revoke = t.mock.method(URL, "revokeObjectURL", () => {});
    t.mock.method(globalThis, "setTimeout", (handler, duration, ...args) => {
      if (duration === 60_000) {
        revocation = handler;
        return 0;
      }
      return originalTimeout(handler, duration, ...args);
    });
    flushSync(() => button(view, "Download saved archive").props.onClick());
    await new Promise(setImmediate);
    assert.deepEqual(calls, [
      ["inspect"],
      ["download", "exact-archive"],
      ["save", "blob:synthetic", "mtp-google-2026-11-27.mtp-raw-archive"],
      ["remove"]
    ]);
    revocation();
    assert.deepEqual(revoke.mock.calls[0].arguments, ["blob:synthetic"]);
    flushSync(() => root.render(React.createElement(Reader)));
    flushSync(() => button(view, "Check legacy records").props.onClick());
    await new Promise(setImmediate);
    assert.deepEqual(calls.at(-1), ["late"]);
    assert.equal(
      calls.some(([name]) => name === "compact"),
      false
    );
    flushSync(() => root.render(React.createElement(Reader)));
    flushSync(() => button(view, "Save an archive and clean up old files").props.onClick());
    await new Promise(setImmediate);
    assert.deepEqual(calls.at(-1), ["compact"]);
  } finally {
    flushSync(() => root.unmount());
    await new Promise(setImmediate);
    if (savedWindow === undefined) delete globalThis.window;
    else globalThis.window = savedWindow;
    if (savedDocument === undefined) delete globalThis.document;
    else globalThis.document = savedDocument;
  }
});

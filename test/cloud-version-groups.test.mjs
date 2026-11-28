import test from "node:test";
import assert from "node:assert/strict";
import * as react from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

function fixture() {
  const load = sourceModules({ react, "react/jsx-runtime": jsx });
  load("i18n/preferences.ts").setDisplayPreferences({ locale: "en" });
  const { CloudVersionComparison } = load("screens/terminal/CloudVersionComparison.tsx");
  const { CLOUD_TEST_CLIENT_ID } = load("model/cloud-client-identity.ts");
  const version = (deviceId, id, kind) => ({
    id,
    deviceId,
    date: "2026-11-28T10:00:00Z",
    instruments: 3,
    drawings: 2,
    images: 0,
    deletion: {
      kind,
      allowed: kind === "previous",
      reason: kind === "legacy" ? "legacy" : "current"
    }
  });
  const remotes = [
    version("other-browser", "other-current", "current"),
    version("own-browser", "own-current", "current"),
    version("own-browser", "own-previous", "previous"),
    version("other-browser", "other-previous", "previous"),
    version(CLOUD_TEST_CLIENT_ID, "test-current", "current"),
    version(CLOUD_TEST_CLIENT_ID, "test-previous", "previous"),
    ...Array.from({ length: 3 }, (_, index) => version("own-browser", `legacy-${index}`, "legacy"))
  ];
  const render = (patch = {}) =>
    renderToStaticMarkup(
      jsx.jsx(CloudVersionComparison, {
        id: "yandex-disk",
        comparison: {
          checkedAt: "2026-11-28T11:00:00Z",
          local: { instruments: 3, drawings: 2, images: 0 },
          remotes
        },
        busy: false,
        blocked: false,
        migration: false,
        receiveAvailable: true,
        clientId: "own-browser",
        onSend() {},
        onReceive() {},
        onDelete() {},
        ...patch
      })
    );
  return { render, remotes, CLOUD_TEST_CLIENT_ID };
}

test("unknown local identity never mislabels an own cloud copy as another browser", () => {
  const { render } = fixture();
  const html = render({ id: "google-drive", clientId: undefined });
  assert.match(html, /Browser · own-brow/);
  assert.doesNotMatch(html, /Other browser|This browser/);
});

test("all nine copies stay visible with exact client and legacy counts and own client first", () => {
  const { render } = fixture();
  const html = render();
  assert.match(html, /Total snapshots in this list: <strong>9<\/strong>/);
  assert.equal((html.match(/data-cloud-version=/g) ?? []).length, 9);
  assert.equal((html.match(/Snapshots<!-- -->: <!-- -->2|Snapshots: 2/g) ?? []).length, 3);
  assert.match(html, /Legacy format<\/h5><span>Snapshots: 3/);
  assert.ok(
    html.indexOf('data-cloud-client="own-browser"') <
      html.indexOf('data-cloud-client="other-browser"')
  );
  assert.match(html, /Other browser · other-br/);
  assert.match(html, /Testing/);
  assert.match(html, /Previous copies/);
  assert.match(html, /Legacy format save/);
  assert.equal((html.match(/Delete this copy…/g) ?? []).length, 3);
});

test("test identity is visibly active and never mislabelled as another browser", () => {
  const { render, CLOUD_TEST_CLIENT_ID } = fixture();
  const html = render({ clientId: CLOUD_TEST_CLIENT_ID });
  assert.match(html, /Testing · Active client/);
  assert.ok(
    html.indexOf(`data-cloud-client="${CLOUD_TEST_CLIENT_ID}"`) <
      html.indexOf('data-cloud-client="own-browser"')
  );
});

test("delete stays visible while pending, failure offers retry, confirmed refresh removes only actual absent copies", () => {
  const { render, remotes } = fixture();
  const pending = render({ busy: true, deleteAction: { id: "own-previous", state: "running" } });
  assert.match(pending, /data-cloud-version="own-previous" aria-busy="true"/);
  assert.match(pending, /role="status">Deleting…/);
  assert.match(pending, /once cloud deletion is confirmed/);
  assert.equal((pending.match(/data-cloud-version=/g) ?? []).length, 9);
  const failure = render({ deleteAction: { id: "own-previous", state: "unconfirmed" } });
  assert.match(failure, /Deletion is unconfirmed. The copy remains in this list. Try again/);
  assert.match(failure, /Verify and continue deleting…/);
  assert.match(failure, /data-cloud-version="own-previous"/);
  const notRefreshed = render({ deleteAction: { id: "own-previous", state: "confirmed" } });
  assert.match(notRefreshed, /data-cloud-version="own-previous"/);
  const refreshed = render({
    deleteAction: { id: "own-previous", state: "confirmed" },
    comparison: {
      local: { instruments: 3, drawings: 2, images: 0 },
      remotes: remotes.filter(({ id }) => id !== "own-previous")
    }
  });
  assert.doesNotMatch(refreshed, /data-cloud-version="own-previous"/);
  assert.match(refreshed, /data-cloud-version="other-current"/);
  assert.match(refreshed, /Total snapshots in this list: <strong>8<\/strong>/);
});

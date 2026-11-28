import assert from "node:assert/strict";
import test from "node:test";
import * as react from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

const load = sourceModules({ react, "react/jsx-runtime": jsx });
const { CLOUD_TEST_CLIENT_ID } = load("model/cloud-client-identity.ts");
const { YandexPreview } = load("services/yandex/coordinator-preview.ts");
const { CloudVersionComparison } = load("screens/terminal/CloudVersionComparison.tsx");
load("i18n/preferences.ts").setDisplayPreferences({ locale: "en" });

const summary = { instruments: 1, drawings: 0, images: 0, date: "2026-11-28T09:00:00Z" };
function render(id, comparison) {
  return renderToStaticMarkup(
    jsx.jsx(CloudVersionComparison, {
      id,
      comparison,
      busy: false,
      blocked: false,
      migration: false,
      receiveAvailable: true,
      onSend() {},
      onReceive() {}
    })
  );
}

test("Yandex preview keeps the client identity separate from each distinct save", () => {
  const first = "11111111-0000-4000-8000-000000000001";
  const second = "22222222-0000-4000-8000-000000000002";
  const devices = [first, first, second, second, CLOUD_TEST_CLIENT_ID];
  const remote = devices.map((deviceId, index) => ({
    remote: {
      file: { name: `slot-${index}.mtp` },
      revision: { deviceId, revisionId: `save-id${index}-distinct` }
    },
    summary
  }));
  const comparison = new YandexPreview().capture(
    { revision: 1, backup: { watchlist: [], drawings: [], images: [] } },
    remote,
    [],
    "2026-11-28T12:00:00Z"
  );

  assert.deepEqual(
    comparison.remotes.map(({ deviceId }) => deviceId),
    devices
  );
  const html = render("yandex-disk", comparison);
  assert.equal((html.match(/Other browser · 11111111<\/h5>/g) ?? []).length, 1);
  assert.equal((html.match(/Other browser · 22222222<\/h5>/g) ?? []).length, 1);
  assert.match(html, /Testing<\/h5><span>Snapshots: 1<\/span>/);
  assert.equal((html.match(/<span>Snapshots: 2<\/span>/g) ?? []).length, 2);
  assert.equal((html.match(/title="save-id[0-4]-distinct">Save · save-id[0-4]/g) ?? []).length, 5);
  assert.doesNotMatch(html, /This browser|Browser · 00000000/);
});

test("Google comparison still uses an explicit device label and accepts saves without a client ID", () => {
  const html = render("google-drive", {
    local: summary,
    remotes: [
      { ...summary, id: "explicit", deviceLabel: "Laptop", deviceId: CLOUD_TEST_CLIENT_ID },
      { ...summary, id: "missing-device" }
    ]
  });
  assert.match(html, /Laptop<\/p><p class="cloud-version-device" title="explicit">Save · explicit/);
  assert.match(html, /title="missing-device">Save · missing-/);
  assert.doesNotMatch(html, /Testing<\/p>|Browser ·/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cloudPublicDefines } from "../scripts/cloud-public-env.mjs";
import { devHtml } from "../scripts/dev-files.mjs";
import { flowModules } from "./helpers/workspace-identity-flow.mjs";
const clientId = "5eb8206c526a4c5593716703d091fa8d";
const redirects = [
  "http://localhost:5290/__dev/app/yandex-callback.html",
  "http://127.0.0.1:5290/__dev/app/yandex-callback.html",
  "https://mtp-test.twiling.ru/yandex-callback.html",
  "https://mtp.twiling.ru/yandex-callback.html"
];

test("only the two allowlisted public values enter browser defines", () => {
  const define = cloudPublicDefines(".", {
    loadLocal: false,
    environment: {
      MTP_PUBLIC_YANDEX_CLIENT_ID: clientId,
      MTP_PUBLIC_YANDEX_REDIRECT_URI: redirects[0],
      YANDEX_CLIENT_SECRET: "must-never-enter-browser",
      OTHER_PRIVATE: "another-private-value"
    }
  });
  assert.deepEqual(Object.keys(define).sort(), [
    "__MTP_YANDEX_CLIENT_ID__",
    "__MTP_YANDEX_REDIRECT_URI__"
  ]);
  assert.equal(JSON.parse(define.__MTP_YANDEX_CLIENT_ID__), clientId);
  assert.equal(JSON.parse(define.__MTP_YANDEX_REDIRECT_URI__), redirects[0]);
  assert.doesNotMatch(JSON.stringify(define), /must-never|another-private/);
  assert.deepEqual(
    cloudPublicDefines(".", { loadLocal: false, environment: { YANDEX_CLIENT_SECRET: "private" } }),
    {}
  );
});

test("invalid public identifiers and unregistered redirects are rejected before bundling", () => {
  for (const id of [clientId + "d", "client-secret", "UPPERCASE"])
    assert.throws(
      () =>
        cloudPublicDefines(".", {
          loadLocal: false,
          environment: { MTP_PUBLIC_YANDEX_CLIENT_ID: id }
        }),
      /32 lowercase/
    );
  assert.throws(
    () =>
      cloudPublicDefines(".", {
        loadLocal: false,
        environment: { MTP_PUBLIC_YANDEX_REDIRECT_URI: "https://other.example/callback" }
      }),
    /registered callback/
  );
});

test("default config matches each real callback, rejects stale ports and cross-origin overrides", () => {
  const previousDocument = globalThis.document,
    previousId = globalThis.__MTP_YANDEX_CLIENT_ID__,
    previousRedirect = globalThis.__MTP_YANDEX_REDIRECT_URI__;
  try {
    delete globalThis.__MTP_YANDEX_CLIENT_ID__;
    delete globalThis.__MTP_YANDEX_REDIRECT_URI__;
    for (const redirectUri of redirects) {
      globalThis.document = { baseURI: new URL("index.html", redirectUri).href };
      assert.deepEqual(flowModules()("services/cloud-public-config.ts").yandexPublicConfig(), {
        clientId,
        redirectUri
      });
    }
    globalThis.document = { baseURI: "http://localhost:5210/__dev/app/index.html" };
    assert.equal(flowModules()("services/cloud-public-config.ts").yandexPublicConfig(), undefined);
    globalThis.document = { baseURI: "http://localhost:5290/__dev/app/index.html" };
    globalThis.__MTP_YANDEX_REDIRECT_URI__ = "https://mtp.twiling.ru/yandex-callback.html";
    assert.equal(flowModules()("services/cloud-public-config.ts").yandexPublicConfig(), undefined);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousId === undefined) delete globalThis.__MTP_YANDEX_CLIENT_ID__;
    else globalThis.__MTP_YANDEX_CLIENT_ID__ = previousId;
    if (previousRedirect === undefined) delete globalThis.__MTP_YANDEX_REDIRECT_URI__;
    else globalThis.__MTP_YANDEX_REDIRECT_URI__ = previousRedirect;
  }
});

test("OAuth callback serves the ordinary client shell and transforms into the isolated DEV entry", () => {
  const callback = readFileSync(new URL("../public/yandex-callback.html", import.meta.url), "utf8");
  assert.match(callback, /id="root"/);
  assert.match(callback, /src=".\/app-entry.js"/);
  const transformed = devHtml(callback);
  assert.match(transformed, /src="\/__dev\/client.js"/);
  assert.doesNotMatch(transformed, /rel="manifest"/);
  for (const file of ["../scripts/dev.mjs", "../server.mjs", "../deploy/static/nginx.conf"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /https:\/\/oauth.yandex.ru/);
    assert.match(source, /https:\/\/cloud-api.yandex.net/);
    assert.doesNotMatch(source, /https:\/\/\*\.yandex\.(?:ru|net)(?:;| )/);
  }
});

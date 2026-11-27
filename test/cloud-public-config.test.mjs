import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
function envFixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "mtp-cloud-public-env-"));
  t.after(() => {
    for (const name of [".env", ".env.local"]) rmSync(join(root, name), { force: true });
    rmdirSync(root);
  });
  for (const [name, contents] of Object.entries(files))
    writeFileSync(join(root, name), contents, "utf8");
  return root;
}

test("a base .env alone supplies only allowlisted public values", (t) => {
  const root = envFixture(t, {
    ".env": `MTP_PUBLIC_YANDEX_CLIENT_ID="${clientId}"\nMTP_PUBLIC_YANDEX_REDIRECT_URI=${redirects[0]}\nSYNTHETIC_PRIVATE=fixture-never-export\n`
  });
  assert.deepEqual(cloudPublicDefines(root, { environment: {} }), {
    __MTP_YANDEX_CLIENT_ID__: JSON.stringify(clientId),
    __MTP_YANDEX_REDIRECT_URI__: JSON.stringify(redirects[0])
  });
  assert.deepEqual(cloudPublicDefines(root, { environment: {}, loadLocal: false }), {});
});

test("local file overrides base per key, including explicit empty values", (t) => {
  const root = envFixture(t, {
    ".env": `MTP_PUBLIC_YANDEX_CLIENT_ID=${clientId}\nMTP_PUBLIC_YANDEX_REDIRECT_URI=${redirects[0]}\n`,
    ".env.local": 'MTP_PUBLIC_YANDEX_CLIENT_ID=""\nSYNTHETIC_PRIVATE=local-fixture\n'
  });
  assert.deepEqual(cloudPublicDefines(root, { environment: {} }), {
    __MTP_YANDEX_CLIENT_ID__: '""',
    __MTP_YANDEX_REDIRECT_URI__: JSON.stringify(redirects[0])
  });
  writeFileSync(
    join(root, ".env.local"),
    `MTP_PUBLIC_YANDEX_REDIRECT_URI=${redirects[1]}\n`,
    "utf8"
  );
  assert.deepEqual(cloudPublicDefines(root, { environment: {} }), {
    __MTP_YANDEX_CLIENT_ID__: JSON.stringify(clientId),
    __MTP_YANDEX_REDIRECT_URI__: JSON.stringify(redirects[1])
  });
});

test("external process ENV wins over both files and the loader leaves ENV intact", (t) => {
  const root = envFixture(t, {
    ".env": `MTP_PUBLIC_YANDEX_CLIENT_ID=${"a".repeat(32)}\nMTP_PUBLIC_YANDEX_REDIRECT_URI=${redirects[0]}\n`,
    ".env.local": `MTP_PUBLIC_YANDEX_CLIENT_ID=${"b".repeat(32)}\nMTP_PUBLIC_YANDEX_REDIRECT_URI=${redirects[1]}\n`
  });
  const keys = ["MTP_PUBLIC_YANDEX_CLIENT_ID", "MTP_PUBLIC_YANDEX_REDIRECT_URI"];
  const saved = keys.map((key) => process.env[key]);
  try {
    process.env[keys[0]] = clientId;
    process.env[keys[1]] = redirects[3];
    assert.deepEqual(cloudPublicDefines(root), {
      __MTP_YANDEX_CLIENT_ID__: JSON.stringify(clientId),
      __MTP_YANDEX_REDIRECT_URI__: JSON.stringify(redirects[3])
    });
    process.env[keys[0]] = "";
    assert.equal(cloudPublicDefines(root).__MTP_YANDEX_CLIENT_ID__, '""');
    assert.equal(process.env[keys[0]], "");
    assert.equal(process.env[keys[1]], redirects[3]);
    delete process.env[keys[0]];
    delete process.env[keys[1]];
    cloudPublicDefines(root);
    assert.equal(process.env[keys[0]], undefined);
    assert.equal(process.env[keys[1]], undefined);
  } finally {
    keys.forEach((key, index) => {
      if (saved[index] === undefined) delete process.env[key];
      else process.env[key] = saved[index];
    });
  }
});

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

test("missing public Client ID leaves Yandex unconfigured without requiring a document", () => {
  const previousDocument = globalThis.document,
    previousId = globalThis.__MTP_YANDEX_CLIENT_ID__;
  try {
    delete globalThis.document;
    delete globalThis.__MTP_YANDEX_CLIENT_ID__;
    assert.equal(flowModules()("services/cloud-public-config.ts").yandexPublicConfig(), undefined);
    for (const id of ["", " ", "invalid", clientId + "d"]) {
      globalThis.__MTP_YANDEX_CLIENT_ID__ = id;
      assert.equal(
        flowModules()("services/cloud-public-config.ts").yandexPublicConfig(),
        undefined
      );
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousId === undefined) delete globalThis.__MTP_YANDEX_CLIENT_ID__;
    else globalThis.__MTP_YANDEX_CLIENT_ID__ = previousId;
  }
});

test("ENV config matches each real callback, rejects stale ports and cross-origin overrides", () => {
  const previousDocument = globalThis.document,
    previousId = globalThis.__MTP_YANDEX_CLIENT_ID__,
    previousRedirect = globalThis.__MTP_YANDEX_REDIRECT_URI__;
  try {
    globalThis.__MTP_YANDEX_CLIENT_ID__ = clientId;
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

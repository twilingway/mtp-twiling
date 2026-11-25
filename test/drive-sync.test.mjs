import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const modules = new Map();
function load(relative) {
  const filename = path.resolve(sourceRoot, relative).replace(/\.js$/, ".ts");
  assert.ok(filename.startsWith(sourceRoot));
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename })(
    (specifier) => load(path.relative(sourceRoot, path.resolve(path.dirname(filename), specifier))),
    module,
    module.exports
  );
  return module.exports;
}
const { DRIVE_SCOPE, DRIVE_NAMESPACE } = load("services/drive/types.ts");
const { DriveAuth: RealDriveAuth } = load("services/drive/auth.ts");
class DriveAuth extends RealDriveAuth {
  constructor(loader, now) { super(loader, now, { load: async () => undefined, save: async () => {}, remove: async () => {} }); }
}
const { sanitizeDriveBackup, sha256, prepareDriveBackup, validateManifest, driveBackupDigest } =
  load("services/drive/backup.ts");
const { DriveTransport } = load("services/drive/transport.ts");
const { DriveSync } = load("services/drive/sync.ts");
const deviceId = crypto.randomUUID();
test("default browser fetch keeps its global receiver instead of the transport instance", async (t) => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = function () {
    assert.equal(this, globalThis, "native browser fetch requires the global receiver");
    calls++;
    return Promise.resolve(new Response(JSON.stringify({ files: [] }), {
      headers: { "Content-Type": "application/json" }
    }));
  };
  t.after(() => { globalThis.fetch = original; });
  const transport = new DriveTransport(authorization());
  assert.deepEqual(await transport.list("snapshot"), []);
  assert.equal(calls, 1);
});
test("Drive preserves the combined MTP selection and shared style", async () => {
  const backup = {
    application: "personal-terminal",
    schemaVersion: 1,
    layout: {
      indicators: { mtpAll: true, mtp160: false },
      chartSettings: {
        indicatorOptions: { mtpAll: { color: "#123456", width: 3, opacity: 0.4 } }
      }
    },
    drawings: [],
    images: []
  };
  const clean = sanitizeDriveBackup(backup);
  assert.deepEqual(clean.layout, backup.layout);
  const disabled = structuredClone(backup);
  disabled.layout.indicators.mtpAll = false;
  assert.notEqual(await driveBackupDigest(clean), await driveBackupDigest(disabled));
});
const code = (expected) => (error) => error.code === expected;
const fixture = (theme = "dark") => ({
  application: "personal-terminal",
  schemaVersion: 1,
  layout: {
    symbol: "TEST",
    indicators: { ma: true, volume: true },
    chartSettings: {
      theme,
      drawingTools: { magnet: "weak", favorites: ["segment"] },
      indicatorOptions: { ma: { color: "#abcdef", width: 2 } },
      drawingTemplates: { sample: { settings: { color: "#aabbcc", width: 2 } } }
    }
  },
  watchlist: [
    {
      symbol: "TEST",
      uid: "fake-instrument",
      name: "Test fixture",
      price: 123,
      previousClose: 100,
      time: "10:00",
      closeTime: "yesterday",
      change: 23,
      changePercent: 23,
      availability: "available",
      note: "runtime note",
      ticker: "TEST",
      brand: { logoName: "test" }
    }
  ],
  drawings: [
    {
      symbol: "TEST",
      items: [
        {
          id: "drawing",
          name: "horizontalRayLine",
          points: [{ timestamp: 100, value: 99 }],
          settings: { color: "#123456", width: 2, levels: [0, 1] }
        }
      ]
    }
  ],
  images: [
    {
      id: "image",
      symbol: "TEST",
      name: "fixture.png",
      type: "image/png",
      point: { timestamp: 123, value: 99 },
      width: 100,
      data: btoa("fake-image-fixture")
    }
  ],
  views: [{ key: "TEST:1d:kline:30", value: { camera: { barSpace: 7, rightOffsetBars: 2 } } }],
  history: [
    { uid: "never-upload", timeframe: "1d", day: "2026-01-01", data: "HISTORY-MUST-STAY-LOCAL" }
  ]
});

class MemoryStore {
  files = [];
  contents = new Map();
  beforeSnapshotCreate = undefined;
  async list(kind) {
    return this.files
      .filter((file) => file.appProperties.mtpKind === kind)
      .map((file) => structuredClone(file));
  }
  async read(file, max) {
    const body = this.contents.get(file.id);
    assert.ok(body && body.size <= max);
    return body;
  }
  async create(kind, key, hash, body) {
    if (kind === "snapshot") await this.beforeSnapshotCreate?.();
    const file = {
      id: crypto.randomUUID(),
      name: kind,
      size: body.size,
      appProperties: { mtpNamespace: DRIVE_NAMESPACE, mtpKind: kind, mtpKey: key, mtpHash: hash }
    };
    this.files.push(file);
    this.contents.set(file.id, body);
    return structuredClone(file);
  }
}
function fakeOAuth() {
  const configs = [],
    prompts = [],
    revocations = [];
  const sdk = {
    initTokenClient(config) {
      configs.push(config);
      return {
        requestAccessToken(prompt) {
          prompts.push(prompt);
        }
      };
    },
    revoke(token, done) {
      revocations.push(token);
      done({ successful: true });
    }
  };
  const accept = (index = configs.length - 1, token = "fake-google-token") =>
    configs[index].callback({ access_token: token, expires_in: 3600, scope: DRIVE_SCOPE });
  return { sdk, configs, prompts, revocations, accept };
}
function authorization() {
  const controller = new AbortController();
  return {
    connectionId: crypto.randomUUID(),
    signal: controller.signal,
    getAccessToken() {
      if (controller.signal.aborted)
        throw Object.assign(new Error("expired"), { code: "auth-required" });
      return "fake-google-token";
    },
    invalidate() {
      controller.abort();
    }
  };
}
const response = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
function fileMetadata(id, kind, key, hash, size) {
  return {
    id,
    name: `mtp-v1-${kind}-${key}`,
    size: String(size),
    appProperties: { mtpNamespace: DRIVE_NAMESPACE, mtpKind: kind, mtpKey: key, mtpHash: hash }
  };
}

test("Drive export preserves settings while deeply excluding credentials, quotes and history", () => {
  const input = fixture();
  input.token = "BANK-SECRET";
  input.owner = "BANK-FINGERPRINT";
  input.layout.chartSettings.unknown = { token: "nested-secret" };
  input.layout.chartSettings.indicatorOptions.ma.owner = "nested-owner";
  input.drawings[0].items[0].points[0].token = "point-secret";
  const safe = sanitizeDriveBackup(input);
  const encoded = JSON.stringify(safe);
  for (const forbidden of [
    "BANK-SECRET",
    "BANK-FINGERPRINT",
    "nested-secret",
    "nested-owner",
    "point-secret",
    "HISTORY-MUST-STAY-LOCAL"
  ])
    assert.ok(!encoded.includes(forbidden));
  for (const key of [
    "history",
    "price",
    "previousClose",
    "time",
    "closeTime",
    "change",
    "changePercent",
    "availability",
    "note"
  ])
    assert.ok(!encoded.includes(`"${key}":`));
  assert.equal(safe.layout.chartSettings.theme, "dark");
  assert.equal(safe.layout.chartSettings.drawingTools.magnet, "weak");
  assert.equal(safe.layout.indicators.ma, true);
  assert.deepEqual(safe.views, input.views);
  assert.equal(safe.images[0].data, input.images[0].data);
  assert.equal(input.watchlist[0].price, 123);
});

test("Invalid known settings and invalid base64 fail before uploading", async () => {
  const input = fixture();
  input.layout.chartSettings.theme = "invalid";
  assert.throws(() => sanitizeDriveBackup(input), code("remote-invalid"));
  const badImage = fixture();
  badImage.images[0].data = "%%invalid";
  await assert.rejects(prepareDriveBackup(badImage), code("remote-invalid"));
});

test("GIS prepare never opens a popup; click synchronously requests only appdata", async () => {
  const oauth = fakeOAuth();
  const auth = new DriveAuth(async () => oauth.sdk);
  try {
    await assert.rejects(auth.connectFromUserGesture("fixture-owner"), code("not-ready"));
    await auth.prepare();
    assert.equal(oauth.prompts.length, 0);
    const pending = auth.connectFromUserGesture("fixture-owner");
    assert.equal(oauth.prompts.length, 1);
    assert.equal(oauth.configs[0].scope, DRIVE_SCOPE);
    assert.equal(oauth.configs[0].include_granted_scopes, false);
    assert.deepEqual(oauth.prompts[0], { prompt: "select_account" });
    await assert.rejects(auth.connectFromUserGesture("fixture-owner"), code("busy"));
    oauth.accept();
    const connected = await pending;
    assert.equal(connected.getAccessToken(), "fake-google-token");
    await auth.disconnect();
    assert.equal(connected.signal.aborted, true);
    assert.throws(() => connected.getAccessToken(), code("auth-required"));
    assert.equal(oauth.revocations.length, 0);
  } finally {
    await auth.disconnect();
  }
});

test("Expiry requires a new click; stale callback/old HTTP binding cannot switch account", async () => {
  let now = 1000;
  const oauth = fakeOAuth();
  const auth = new DriveAuth(
    async () => oauth.sdk,
    () => now
  );
  try {
    await auth.prepare();
    let pending = auth.connectFromUserGesture("fixture-owner");
    oauth.accept();
    const first = await pending;
    now += 3600000;
    assert.throws(() => first.getAccessToken(), code("auth-required"));
    assert.equal(oauth.prompts.length, 1);
    pending = auth.connectFromUserGesture("fixture-owner");
    oauth.accept(0, "old-account-token");
    oauth.accept(1, "second-account-token");
    const second = await pending;
    assert.equal(second.getAccessToken(), "second-account-token");
    first.invalidate();
    assert.equal(second.getAccessToken(), "second-account-token");
    assert.throws(() => first.getAccessToken(), code("auth-required"));
    await auth.disconnect(true);
    assert.deepEqual(oauth.revocations, ["second-account-token"]);
  } finally {
    await auth.disconnect();
  }
});

test("GIS denial, popup cancellation and disconnect reject pending requests", async () => {
  const oauth = fakeOAuth();
  const auth = new DriveAuth(async () => oauth.sdk);
  await auth.prepare();
  let pending = auth.connectFromUserGesture("fixture-owner");
  oauth.configs[0].callback({ error: "access_denied" });
  await assert.rejects(pending, code("auth-required"));
  pending = auth.connectFromUserGesture("fixture-owner");
  oauth.configs[1].error_callback({ type: "popup_closed" });
  await assert.rejects(pending, code("auth-cancelled"));
  pending = auth.connectFromUserGesture("fixture-owner");
  const rejection = assert.rejects(pending, code("auth-cancelled"));
  await auth.disconnect();
  await rejection;
});

test("Snapshot roundtrip excludes history/quotes, preserves blobs and reuses content", async () => {
  const store = new MemoryStore();
  const sync = new DriveSync(store);
  const first = await sync.publish(fixture(), { deviceId, parents: [] });
  assert.deepEqual(first.inspection.heads, [first.nodeId]);
  const restored = await sync.download(first.nodeId);
  assert.deepEqual(restored, sanitizeDriveBackup(fixture()));
  assert.equal(store.files.filter((file) => file.appProperties.mtpKind === "blob").length, 2);
  await sync.publish(fixture(), { deviceId, parents: [first.nodeId] });
  assert.equal(store.files.filter((file) => file.appProperties.mtpKind === "blob").length, 2);
  assert.equal(store.files.filter((file) => file.appProperties.mtpKind === "snapshot").length, 2);
  for (const body of store.contents.values())
    assert.ok(!(await body.text()).includes("HISTORY-MUST-STAY-LOCAL"));
});

test("Concurrent devices preserve both heads; stale publish blocks and explicit resolve joins", async () => {
  const store = new MemoryStore();
  const a = new DriveSync(store),
    b = new DriveSync(store);
  const initial = await a.publish(fixture(), { deviceId, parents: [] });
  let arrived = 0,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  store.beforeSnapshotCreate = async () => {
    if (++arrived === 2) release();
    await gate;
  };
  const branches = await Promise.all([
    a.publish(fixture("light"), { deviceId, parents: [initial.nodeId] }),
    b.publish(fixture("dark"), { deviceId: crypto.randomUUID(), parents: [initial.nodeId] })
  ]);
  store.beforeSnapshotCreate = undefined;
  const inspection = await a.inspect();
  assert.equal(inspection.conflict, true);
  assert.deepEqual(new Set(inspection.heads), new Set(branches.map((branch) => branch.nodeId)));
  await assert.rejects(
    a.publish(fixture(), { deviceId, parents: [initial.nodeId] }),
    code("conflict")
  );
  await assert.rejects(
    a.publish(fixture(), { deviceId, parents: inspection.heads }),
    code("conflict")
  );
  const resolved = await a.resolve(await a.download(branches[0].nodeId), {
    deviceId,
    parents: inspection.heads
  });
  assert.deepEqual(resolved.inspection.heads, [resolved.nodeId]);
  assert.equal((await a.download(resolved.nodeId)).layout.chartSettings.theme, "light");
  assert.equal(store.files.filter((file) => file.appProperties.mtpKind === "snapshot").length, 4);
});

test("Tampered blobs stop before import; missing parents and cycles are rejected", async () => {
  const store = new MemoryStore(),
    sync = new DriveSync(store);
  const initial = await sync.publish(fixture(), { deviceId, parents: [] });
  const blob = store.files.find((file) => file.appProperties.mtpKind === "blob");
  store.contents.set(blob.id, new Blob(["tampered"]));
  await assert.rejects(sync.download(initial.nodeId), code("remote-invalid"));
  const missing = new MemoryStore();
  const payload = { sha256: "a".repeat(64), size: 0 };
  const manifest = {
    protocol: 1,
    nodeId: crypto.randomUUID(),
    deviceId,
    parents: [crypto.randomUUID()],
    createdAt: new Date().toISOString(),
    payload,
    images: []
  };
  let body = new Blob([JSON.stringify(manifest)]);
  await missing.create("snapshot", manifest.nodeId, await sha256(body), body);
  await assert.rejects(new DriveSync(missing).inspect(), code("remote-invalid"));
  const cycle = new MemoryStore(),
    secondId = manifest.parents[0];
  body = new Blob([JSON.stringify({ ...manifest, nodeId: secondId, parents: [manifest.nodeId] })]);
  await cycle.create("snapshot", secondId, await sha256(body), body);
  body = new Blob([JSON.stringify(manifest)]);
  await cycle.create("snapshot", manifest.nodeId, await sha256(body), body);
  await assert.rejects(new DriveSync(cycle).inspect(), code("remote-invalid"));
  assert.throws(
    () => validateManifest({ ...manifest, parents: [manifest.nodeId] }),
    code("remote-invalid")
  );
});

test("Failed image upload never publishes a snapshot", async () => {
  const store = new MemoryStore(),
    original = store.create.bind(store);
  store.create = async (kind, key, hash, body) => {
    if (body.type === "image/png") throw Object.assign(new Error("offline"), { code: "network" });
    return original(kind, key, hash, body);
  };
  await assert.rejects(
    new DriveSync(store).publish(fixture(), { deviceId, parents: [] }),
    code("network")
  );
  assert.equal((await store.list("snapshot")).length, 0);
});

test("Transport scopes listing to namespace/appDataFolder, follows every page", async () => {
  const calls = [],
    auth = authorization();
  let page = 0;
  const transport = new DriveTransport(auth, {
    fetch: async (url, init) => {
      calls.push([new URL(url), init]);
      return response({
        files: [fileMetadata(`file${page}`, "snapshot", crypto.randomUUID(), "a".repeat(64), 10)],
        ...(page++ === 0 ? { nextPageToken: "page2" } : {})
      });
    }
  });
  const files = await transport.list("snapshot");
  assert.equal(files.length, 2);
  assert.equal(calls[0][0].searchParams.get("spaces"), "appDataFolder");
  assert.ok(calls[0][0].searchParams.get("q").includes(DRIVE_NAMESPACE));
  assert.equal(calls[1][0].searchParams.get("pageToken"), "page2");
  assert.equal(calls[0][1].headers.Authorization, "Bearer fake-google-token");
  assert.equal(calls[0][1].credentials, "omit");
  assert.equal(calls[0][1].redirect, "error");
});

test("Transport rejects incomplete listing, bounds downloads and invalidates 401", async () => {
  let transport = new DriveTransport(authorization(), {
    fetch: async () => response({ files: [], incompleteSearch: true })
  });
  await assert.rejects(transport.list("snapshot"), code("remote-invalid"));
  const file = { ...fileMetadata("file", "blob", "a".repeat(64), "a".repeat(64), 1), size: 1 };
  transport = new DriveTransport(authorization(), { fetch: async () => new Response("too large") });
  await assert.rejects(transport.read(file, 2), code("limit"));
  const auth = authorization();
  transport = new DriveTransport(auth, { fetch: async () => response({}, 401) });
  await assert.rejects(transport.list("snapshot"), code("auth-required"));
  assert.equal(auth.signal.aborted, true);
});

test("Rate limits retry with bounded backoff; permission denied does not retry", async () => {
  let calls = 0;
  const delays = [];
  const transport = new DriveTransport(authorization(), {
    fetch: async () =>
      ++calls <= 2 ? response({}, 429, { "Retry-After": "2" }) : response({ files: [] }),
    sleep: async (delay) => {
      delays.push(delay);
    },
    random: () => 0
  });
  assert.deepEqual(await transport.list("snapshot"), []);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [2000, 2000]);
  calls = 0;
  const denied = new DriveTransport(authorization(), {
    fetch: async () => {
      calls++;
      return response({ error: { errors: [{ reason: "insufficientPermissions" }] } }, 403);
    }
  });
  await assert.rejects(denied.list("snapshot"), code("permission"));
  assert.equal(calls, 1);
});

test("Multipart upload uses pre-generated ID and retries uncertain create without duplicates", async () => {
  const body = new Blob(["fixture"], { type: "application/json" }),
    hash = await sha256(body);
  let posts = 0,
    uploadText = "";
  const transport = new DriveTransport(authorization(), {
    sleep: async () => {},
    random: () => 0,
    fetch: async (url, init) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("generateIds")) {
        assert.equal(parsed.searchParams.get("space"), "appDataFolder");
        return response({ ids: ["generated-id"] });
      }
      if (init.method === "POST") {
        assert.equal(parsed.searchParams.get("uploadType"), "multipart");
        uploadText = await init.body.text();
        posts++;
        if (posts === 1) throw new TypeError("lost-response");
        return response({}, 409);
      }
      return response(fileMetadata("generated-id", "blob", hash, hash, body.size));
    }
  });
  const uploaded = await transport.create("blob", hash, hash, body);
  assert.equal(uploaded.id, "generated-id");
  assert.equal(posts, 2);
  assert.ok(uploadText.includes('"parents":["appDataFolder"]'));
  assert.ok(uploadText.includes('"id":"generated-id"'));
});

test("Resumable upload probes confirmed offset after dropped response", async () => {
  const body = new Blob([new Uint8Array(6 * 1024 * 1024 + 13)], { type: "image/png" }),
    hash = await sha256(body);
  let offset = 0,
    dropped = false,
    probes = 0;
  const ranges = [];
  const metadata = fileMetadata("large-id", "blob", hash, hash, body.size);
  const transport = new DriveTransport(authorization(), {
    sleep: async () => {},
    random: () => 0,
    fetch: async (url, init) => {
      if (new URL(url).pathname.endsWith("generateIds")) return response({ ids: ["large-id"] });
      if (init.method === "POST")
        return new Response(null, {
          status: 200,
          headers: { Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=fake" }
        });
      const range = init.headers["content-range"];
      ranges.push(range);
      assert.equal(init.headers["content-length"], undefined);
      if (range.startsWith("bytes */")) {
        probes++;
        return new Response(null, { status: 308, headers: { Range: `bytes=0-${offset - 1}` } });
      }
      const [, start, end] = range.match(/^bytes (\d+)-(\d+)\//);
      assert.equal(Number(start), offset);
      offset = Number(end) + 1;
      if (!dropped) {
        dropped = true;
        throw new TypeError("lost-response-after-server-accept");
      }
      return offset === body.size
        ? response(metadata)
        : new Response(null, { status: 308, headers: { Range: `bytes=0-${offset - 1}` } });
    }
  });
  assert.equal((await transport.create("blob", hash, hash, body)).id, "large-id");
  assert.equal(probes, 1);
  assert.equal(offset, body.size);
  assert.equal(ranges[2], `bytes 1048576-2097151/${body.size}`);
});

test("Untrusted resumable Location never receives authorization", async () => {
  const body = new Blob([new Uint8Array(6 * 1024 * 1024)]),
    hash = await sha256(body);
  let calls = 0;
  const transport = new DriveTransport(authorization(), {
    fetch: async (url) => {
      calls++;
      if (new URL(url).pathname.endsWith("generateIds")) return response({ ids: ["large-id"] });
      return new Response(null, {
        status: 200,
        headers: { Location: "https://evil.invalid/steal-token" }
      });
    }
  });
  await assert.rejects(transport.create("blob", hash, hash, body), code("remote-invalid"));
  assert.equal(calls, 2);
});

test("Dirty-check digest ignores backup timestamp and retains actual user edits", async () => {
  const first = fixture(),
    second = fixture();
  first.exportedAt = "2026-01-01";
  second.exportedAt = "2026-01-02";
  assert.equal(await driveBackupDigest(first), await driveBackupDigest(second));
  second.layout.chartSettings.theme = "light";
  assert.notEqual(await driveBackupDigest(first), await driveBackupDigest(second));
  assert.equal(first.exportedAt, "2026-01-01");
});

test("Insufficient scope and invalid token lifetime cannot authorize Drive", async () => {
  const oauth = fakeOAuth(),
    auth = new DriveAuth(async () => oauth.sdk);
  await auth.prepare();
  for (const token of [
    { access_token: "fake", expires_in: 3600, scope: "openid" },
    { access_token: "fake", expires_in: "NaN", scope: DRIVE_SCOPE },
    { access_token: "fake", expires_in: 2, scope: DRIVE_SCOPE }
  ]) {
    const pending = auth.connectFromUserGesture("fixture-owner");
    oauth.configs.at(-1).callback(token);
    await assert.rejects(pending, code("auth-required"));
  }
  await auth.disconnect();
});

test("An HTTP response completed after disconnect cannot be reused", async () => {
  const auth = authorization();
  let release;
  const pendingResponse = new Promise((resolve) => {
    release = resolve;
  });
  const transport = new DriveTransport(auth, { fetch: async () => pendingResponse });
  const pending = transport.list("snapshot");
  auth.invalidate();
  release(response({ files: [] }));
  await assert.rejects(pending, code("auth-required"));
});

test("Persistent quota stops at four requests and rate-limit 403 is retryable", async () => {
  let calls = 0;
  const transport = new DriveTransport(authorization(), {
    fetch: async () => {
      calls++;
      return response({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }, 403);
    },
    sleep: async () => {},
    random: () => 0
  });
  await assert.rejects(transport.list("snapshot"), code("quota"));
  assert.equal(calls, 4);
});

test("Resumable upload restarts an expired session with the same generated ID", async () => {
  const body = new Blob([new Uint8Array(6 * 1024 * 1024)]),
    hash = await sha256(body);
  let starts = 0,
    generated = 0,
    offset = 0;
  const transport = new DriveTransport(authorization(), {
    fetch: async (url, init) => {
      if (new URL(url).pathname.endsWith("generateIds")) {
        generated++;
        return response({ ids: ["stable-id"] });
      }
      if (init.method === "POST") {
        starts++;
        assert.equal(JSON.parse(init.body).id, "stable-id");
        return new Response(null, {
          status: 200,
          headers: {
            Location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=session${starts}`
          }
        });
      }
      if (starts === 1) return response({}, 404);
      const [, start, end] = init.headers["content-range"].match(/^bytes (\d+)-(\d+)\//);
      assert.equal(Number(start), offset);
      offset = Number(end) + 1;
      return offset === body.size
        ? response(fileMetadata("stable-id", "blob", hash, hash, body.size))
        : new Response(null, { status: 308, headers: { Range: `bytes=0-${offset - 1}` } });
    }
  });
  assert.equal((await transport.create("blob", hash, hash, body)).id, "stable-id");
  assert.equal(starts, 2);
  assert.equal(generated, 1);
});

test("A stalled resumable upload is bounded and never reports completion", async () => {
  const body = new Blob([new Uint8Array(6 * 1024 * 1024)]),
    hash = await sha256(body);
  let chunks = 0;
  const transport = new DriveTransport(authorization(), {
    fetch: async (url, init) => {
      if (new URL(url).pathname.endsWith("generateIds")) return response({ ids: ["stalled-id"] });
      if (init.method === "POST")
        return new Response(null, {
          status: 200,
          headers: {
            Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=stalled"
          }
        });
      chunks++;
      return new Response(null, { status: 308 });
    }
  });
  await assert.rejects(transport.create("blob", hash, hash, body), code("network"));
  assert.equal(chunks, 4);
});

test("Duplicate UUID with differing manifest bytes is never silently chosen", async () => {
  const store = new MemoryStore(),
    sync = new DriveSync(store);
  const first = await sync.publish(fixture(), { deviceId, parents: [] });
  const original = store.files.find((file) => file.appProperties.mtpKind === "snapshot");
  const manifest = JSON.parse(await store.contents.get(original.id).text());
  const body = new Blob([JSON.stringify({ ...manifest, createdAt: "2026-01-01T00:00:00Z" })]);
  await store.create("snapshot", first.nodeId, await sha256(body), body);
  await assert.rejects(sync.inspect(), code("remote-invalid"));
});

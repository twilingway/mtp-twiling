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
const { DriveError, DRIVE_NAMESPACE, DRIVE_SCOPE } = load("services/drive/types.ts");
const { DriveAuth: RealDriveAuth } = load("services/drive/auth.ts");
class DriveAuth extends RealDriveAuth {
  constructor(loader, now) {
    super(loader, now, {
      load: async () => undefined,
      save: async () => {},
      remove: async () => {}
    });
  }
}
const { DriveTransport } = load("services/drive/transport.ts");
const expectCode = (code) => (error) => {
  assert.ok(error instanceof DriveError);
  assert.equal(error.code, code);
  assert.ok(!error.message.includes("private-network-detail"));
  return true;
};
function authorization() {
  const controller = new AbortController();
  return {
    connectionId: crypto.randomUUID(),
    signal: controller.signal,
    getAccessToken() {
      if (controller.signal.aborted)
        throw Object.assign(new Error("expired"), { code: "auth-required" });
      return "fake-token";
    },
    invalidate() {
      controller.abort();
    }
  };
}
function streaming(status = 200) {
  let controller, began;
  const reading = new Promise((resolve) => {
    began = resolve;
  });
  let cancelled = false;
  const body = new ReadableStream({
    start(value) {
      controller = value;
      controller.enqueue(new TextEncoder().encode("{"));
    },
    pull() {
      began();
    },
    cancel() {
      cancelled = true;
    }
  });
  return {
    response: new Response(body, { status }),
    reading,
    controller,
    get cancelled() {
      return cancelled;
    }
  };
}
const file = {
  id: "fixture-file",
  name: "fixture",
  size: 2,
  appProperties: { mtpNamespace: DRIVE_NAMESPACE, mtpKind: "blob" }
};
const hash = "a".repeat(64);
function perform(operation, transport) {
  if (operation === "binary") return transport.read(file, 10);
  if (operation === "create-result") return transport.create("blob", hash, hash, new Blob(["{}"]));
  return transport.list("snapshot");
}

for (const operation of ["binary", "json-list", "create-result", "403-reason"]) {
  for (const failure of ["abort", "offline", "timeout"]) {
    test(`${operation} body stream ${failure} preserves typed error after HTTP headers`, async () => {
      const auth = authorization(),
        stream = streaming(operation === "403-reason" ? 403 : 200);
      let bodyRequests = 0;
      const transport = new DriveTransport(auth, {
        ...(failure === "timeout" ? { timeoutMs: 25 } : {}),
        sleep: async () => {},
        fetch: async (url) => {
          if (new URL(url).pathname.endsWith("generateIds"))
            return new Response(JSON.stringify({ ids: ["generated-id"] }));
          return ++bodyRequests === 1
            ? stream.response
            : new Response(JSON.stringify({ files: [] }));
        }
      });
      const pending = perform(operation, transport);
      const rejected = assert.rejects(
        pending,
        expectCode(failure === "abort" ? "auth-required" : "network")
      );
      await stream.reading;
      if (failure === "abort") auth.invalidate();
      if (failure === "offline") stream.controller.error(new TypeError("private-network-detail"));
      await rejected;
      if (failure !== "offline") assert.equal(stream.cancelled, true);
      if (failure === "timeout") {
        assert.equal(auth.signal.aborted, false);
        assert.equal(bodyRequests, 1);
        assert.deepEqual(await transport.list("snapshot"), []);
      }
    });
  }
}

function stall(signal) {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

test("A response header timeout aborts one fetch and allows reuse of the same authorization", async () => {
  const auth = authorization();
  let attempts = 0,
    timedOutSignal;
  const transport = new DriveTransport(auth, {
    timeoutMs: 25,
    sleep: async () => {},
    fetch: async (_url, init) => {
      if (++attempts > 1) return new Response(JSON.stringify({ files: [] }));
      timedOutSignal = init.signal;
      return stall(timedOutSignal);
    }
  });

  await assert.rejects(transport.list("snapshot"), expectCode("network"));
  assert.equal(attempts, 1);
  assert.equal(timedOutSignal.aborted, true);
  assert.equal(auth.signal.aborted, false);
  assert.deepEqual(await transport.list("snapshot"), []);
});

test("A resumable chunk header timeout stops the operation without an automatic probe", async () => {
  const auth = authorization();
  const methods = [];
  const transport = new DriveTransport(auth, {
    timeoutMs: 25,
    sleep: async () => {},
    fetch: async (url, init) => {
      methods.push(init.method ?? "GET");
      if (new URL(url).pathname.endsWith("generateIds"))
        return new Response(JSON.stringify({ ids: ["generated-id"] }));
      if (init.method === "POST")
        return new Response(null, {
          headers: { Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=test" }
        });
      return stall(init.signal);
    }
  });
  const body = new Blob([new Uint8Array(6 * 1024 * 1024)]);
  await assert.rejects(transport.create("blob", hash, hash, body), expectCode("network"));
  assert.deepEqual(methods, ["GET", "POST", "PUT"]);
  assert.equal(auth.signal.aborted, false);
});

test("Receiving bytes renews the idle timer during a longer download", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stream = streaming();
  const transport = new DriveTransport(authorization(), {
    timeoutMs: 20,
    fetch: async () => stream.response
  });
  const completion = transport.read(file, 10);
  await stream.reading;
  await new Promise(setImmediate);
  t.mock.timers.tick(19);
  stream.controller.enqueue(new TextEncoder().encode("}"));
  await new Promise(setImmediate);
  t.mock.timers.tick(19);
  stream.controller.close();
  assert.equal(await (await completion).text(), "{}");
});

test("Drive listing preserves decimal server versions and permits their absence", async () => {
  const version = "9007199254740993";
  const listed = {
    ...file,
    appProperties: { ...file.appProperties, mtpKind: "snapshot" }
  };
  const transport = new DriveTransport(authorization(), {
    fetch: async (url) => {
      assert.match(new URL(url).searchParams.get("fields"), /files\([^)]*\bversion\b/);
      return new Response(
        JSON.stringify({
          files: [
            { ...listed, version },
            { ...listed, id: "unversioned" },
            { ...listed, id: "malformed-version", version: 42 }
          ]
        })
      );
    }
  });
  const files = await transport.list("snapshot");
  assert.deepEqual(
    files.map((item) => item.version),
    [version, undefined, undefined]
  );
});

for (const operation of ["binary", "json-list"]) {
  for (const failure of ["expiry", "reconnect"]) {
    test(`${operation} body stream checks bound token ${failure} before accepting data`, async () => {
      let now = 1000;
      const configs = [];
      const sdk = {
        initTokenClient(config) {
          configs.push(config);
          return { requestAccessToken() {} };
        },
        revoke(_token, done) {
          done({ successful: true });
        }
      };
      const auth = new DriveAuth(
        async () => sdk,
        () => now
      );
      try {
        await auth.prepare();
        const first = auth.connectFromUserGesture("fixture-owner");
        configs[0].callback({ access_token: "first-fake", scope: DRIVE_SCOPE, expires_in: 3600 });
        const bound = await first;
        const stream = streaming();
        const transport = new DriveTransport(bound, { fetch: async () => stream.response });
        const pending = perform(operation, transport);
        const rejected = assert.rejects(pending, expectCode("auth-required"));
        await stream.reading;
        if (failure === "expiry") {
          now += 3600000;
          stream.controller.enqueue(new TextEncoder().encode("}"));
        } else {
          const second = auth.connectFromUserGesture("fixture-owner");
          configs[1].callback({
            access_token: "second-fake",
            scope: DRIVE_SCOPE,
            expires_in: 3600
          });
          assert.equal((await second).getAccessToken(), "second-fake");
        }
        await rejected;
        assert.equal(bound.signal.aborted, true);
        assert.equal(stream.cancelled, true);
      } finally {
        await auth.disconnect();
      }
    });
  }
}

test("Connected stream AbortError is a typed network failure rather than browser numeric code", async () => {
  const stream = streaming(),
    transport = new DriveTransport(authorization(), { fetch: async () => stream.response });
  const pending = transport.read(file, 10);
  const rejected = assert.rejects(pending, expectCode("network"));
  await stream.reading;
  stream.controller.error(new DOMException("private-network-detail", "AbortError"));
  await rejected;
});

test("Complete malformed JSON remains remote-invalid while interrupted partial JSON is network", async () => {
  const transport = new DriveTransport(authorization(), {
    fetch: async () => new Response("{invalid-json")
  });
  await assert.rejects(transport.list("snapshot"), expectCode("remote-invalid"));
});

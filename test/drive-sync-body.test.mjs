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
  constructor(loader, now) { super(loader, now, { load: async () => undefined, save: async () => {}, remove: async () => {} }); }
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
  for (const failure of ["abort", "offline"]) {
    test(`${operation} body stream ${failure} preserves typed error after HTTP headers`, async () => {
      const auth = authorization(),
        stream = streaming(operation === "403-reason" ? 403 : 200);
      const transport = new DriveTransport(auth, {
        fetch: async (url) => {
          if (new URL(url).pathname.endsWith("generateIds"))
            return new Response(JSON.stringify({ ids: ["generated-id"] }));
          return stream.response;
        }
      });
      const pending = perform(operation, transport);
      const rejected = assert.rejects(
        pending,
        expectCode(failure === "abort" ? "auth-required" : "network")
      );
      await stream.reading;
      if (failure === "abort") auth.invalidate();
      else stream.controller.error(new TypeError("private-network-detail"));
      await rejected;
      if (failure === "abort") assert.equal(stream.cancelled, true);
    });
  }
}

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

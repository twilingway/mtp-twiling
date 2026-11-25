import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
function sources(globals = {}) {
  const context = vm.createContext({
    Date,
    DOMException,
    AbortController,
    AbortSignal,
    console,
    ...globals
  });
  const modules = new Map();
  function load(relative) {
    const filename = path.resolve(sourceRoot, relative).replace(/\.js$/, ".ts");
    assert.ok(!path.relative(sourceRoot, filename).startsWith(".."));
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${code}\n})`, { filename }).runInContext(
      context
    )(
      (specifier) =>
        load(path.relative(sourceRoot, path.resolve(path.dirname(filename), specifier))),
      module,
      module.exports
    );
    return module.exports;
  }
  return { load };
}
const { ServerClock, serverTimestamp } = sources().load("services/server-clock.ts");
const serverAt = Date.parse("2026-11-25T11:37:46Z");
const iso = (value) => new Date(value).toISOString();

test("clock uses local time until a valid observation and corrects both fast and slow clocks", () => {
  const clock = new ServerClock();
  assert.equal(clock.offset, null);
  assert.equal(clock.now(serverAt), serverAt);
  assert.equal(clock.observe(iso(serverAt), serverAt + 105_000), true);
  assert.equal(clock.offset, -105_000);
  assert.equal(clock.now(serverAt + 108_000), serverAt + 3000);
  clock.reset();
  assert.equal(clock.offset, null);
  assert.equal(clock.observe(iso(serverAt), serverAt - 45_000), true);
  assert.equal(clock.offset, 45_000);
  assert.equal(clock.now(serverAt - 40_000), serverAt + 5000);
});

test("recent offsets use a median so a delayed/outlier ping cannot pull the estimate like a mean", () => {
  const clock = new ServerClock(),
    offsets = [-1000, -1005, -995, 60_000, -1002];
  for (const offset of offsets) clock.observe(iso(serverAt), serverAt - offset);
  assert.equal(clock.offset, -1000);
  assert.notEqual(clock.offset, offsets.reduce((sum, value) => sum + value, 0) / offsets.length);
  for (let i = 0; i < 9; i++) clock.observe(iso(serverAt + i * 1000), serverAt + i * 1000 + 200);
  assert.equal(clock.offset, -200);
});

test("malformed timestamp values and invalid reception times leave calibration unchanged", () => {
  const clock = new ServerClock();
  clock.observe(iso(serverAt), serverAt + 1000);
  for (const value of [
    undefined,
    null,
    [],
    {},
    "",
    "bad",
    "2026-11-25",
    "2026-11-25T10:00:00",
    "2026-02-30T10:00:00Z",
    "2026-13-01T10:00:00Z",
    "2026-11-25T25:00:00Z",
    "0000-01-01T00:00:00Z",
    "9999-12-31T23:59:59-01:00",
    serverAt,
    { seconds: "NaN" },
    { seconds: "1.5" },
    { seconds: 253402300800 },
    { seconds: 1, nanos: -1 },
    { seconds: 1, nanos: 1_000_000_000 },
    { seconds: 1, nanos: 1.5 }
  ]) {
    assert.equal(clock.observe(value, serverAt), false);
    assert.equal(clock.offset, -1000);
  }
  assert.equal(clock.observe(iso(serverAt), NaN), false);
  assert.equal(clock.observe(iso(serverAt), Infinity), false);
});

test("protobuf timestamp strings and seconds/nanos objects retain UTC and subsecond precision", () => {
  assert.equal(serverTimestamp("2026-11-25T14:37:46.123456789+03:00"), serverAt + 123);
  assert.equal(
    serverTimestamp({ seconds: String(serverAt / 1000), nanos: 123_000_000 }),
    serverAt + 123
  );
  assert.equal(serverTimestamp({ seconds: serverAt / 1000 }), serverAt);
  assert.equal(serverTimestamp({ seconds: "0", nanos: 500_000 }), 0.5);
});

test("corrected UTC date follows the observed server across local midnight", () => {
  const { utcDate } = sources().load("model/candle-clock.ts"),
    clock = new ServerClock();
  const actual = Date.parse("2026-11-25T23:59:50Z"),
    local = actual + 30_000;
  clock.observe(iso(actual), local);
  assert.equal(utcDate(local), Date.parse("2026-11-26T00:00:00Z"));
  assert.equal(utcDate(clock.now(local)), Date.parse("2026-11-25T00:00:00Z"));
  assert.equal(utcDate(clock.now(local + 20_000)), Date.parse("2026-11-26T00:00:00Z"));
});

test("WebSocket ping calibrates before callbacks; candle timestamps and HTTP metadata do not calibrate", () => {
  let local = serverAt + 105_000,
    requests = 0;
  const sockets = [],
    observed = [];
  class TestDate extends Date {
    static now() {
      return local;
    }
  }
  class TestWebSocket {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    constructor() {
      sockets.push(this);
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
    }
  }
  const { load } = sources({
    Date: TestDate,
    WebSocket: TestWebSocket,
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    fetch: () => {
      requests++;
      throw new Error("No network expected");
    }
  });
  const { BankTransport } = load("services/tbank-transport.ts");
  const transport = new BankTransport("fixture-only", {
    connecting() {},
    open() {},
    error() {},
    data: () => observed.push(transport.serverNow())
  });
  transport.connect();
  assert.equal(transport.clockOffset, null);
  assert.equal(transport.serverNow(), local);
  const first = sockets[0];
  assert.equal(first.sent.length, 0);
  first.onopen();
  first.onopen();
  assert.deepEqual(first.sent, [{ ping: { time: iso(local) } }]);
  first.onmessage({
    data: JSON.stringify({
      candle: { time: iso(serverAt) },
      date: iso(serverAt),
      serverTime: iso(serverAt)
    })
  });
  assert.equal(transport.clockOffset, null);
  first.onmessage({
    data: JSON.stringify({ ping: { time: iso(serverAt), streamId: "public-fixture" } })
  });
  assert.equal(transport.clockOffset, -105_000);
  assert.equal(observed.at(-1), serverAt);
  local += 3000;
  assert.equal(transport.serverNow(), serverAt + 3000);
  first.onmessage({ data: JSON.stringify({ ping: { time: "invalid" } }) });
  assert.equal(transport.clockOffset, -105_000);
  const staleHandler = first.onmessage;
  const staleOpen = first.onopen;
  transport.connect();
  assert.equal(transport.clockOffset, null);
  staleOpen();
  assert.equal(sockets[1].sent.length, 0);
  sockets[1].onopen();
  sockets[1].onopen();
  assert.deepEqual(sockets[1].sent, [{ ping: { time: iso(local) } }]);
  staleHandler({ data: JSON.stringify({ ping: { time: "2026-11-26T00:00:00Z" } }) });
  assert.equal(transport.clockOffset, null);
  sockets[1].onmessage({
    data: JSON.stringify({
      ping: { time: { seconds: String((serverAt + 3000) / 1000), nanos: 0 } }
    })
  });
  assert.equal(transport.serverNow(), serverAt + 3000);
  const closedHandler = sockets[1].onmessage;
  transport.close();
  closedHandler({ data: JSON.stringify({ ping: { time: iso(serverAt) } }) });
  assert.equal(transport.clockOffset, null);
  assert.equal(transport.serverNow(), local);
  assert.equal(requests, 0);
});

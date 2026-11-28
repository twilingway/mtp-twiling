import assert from "node:assert/strict";
import test from "node:test";
import { loadBybit } from "./helpers/bybit-loader.mjs";

const { BybitStream, BybitError } = loadBybit();
const { BybitProtocol, subscriptionTopics } = loadBybit("ws-protocol.ts");
const ticker = (type = "snapshot", data = {}, ts = 1000) =>
  JSON.stringify({
    topic: "tickers.BTCUSDT",
    type,
    ts,
    data: { symbol: "BTCUSDT", ...data }
  });
const allowed = new Set(["tickers.BTCUSDT", "kline.1.BTCUSDT"]);
class Clock {
  time = 0;
  now = () => this.time;
  serial = 0;
  timers = new Map();
  setTimeout = (callback, delay) => {
    const key = ++this.serial;
    this.timers.set(key, { callback, at: this.time + delay });
    return key;
  };
  clearTimeout = (key) => this.timers.delete(key);
  tick(ms) {
    const target = this.time + ms;
    for (let count = 0; count < 200; count++) {
      const first = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!first || first[1].at > target) {
        this.time = target;
        return;
      }
      this.time = first[1].at;
      this.timers.delete(first[0]);
      first[1].callback();
    }
    assert.fail("Unbounded timer loop");
  }
}
class Socket {
  readyState = 0;
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  sent = [];
  closed = 0;
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(data) {
    this.onmessage?.({ data });
  }
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
    this.closed++;
  }
  drop(event) {
    this.readyState = 3;
    this.onclose?.(event);
  }
}
function scenario(category = "linear", extra = {}) {
  const clock = new Clock(),
    sockets = [],
    urls = [],
    events = [],
    states = [],
    errors = [];
  const stream = new BybitStream(category, {
    clock,
    socketFactory: (url) => {
      const socket = new Socket();
      urls.push(url);
      sockets.push(socket);
      return socket;
    },
    connectTimeoutMs: 5,
    heartbeatMs: 10,
    pongTimeoutMs: 3,
    reconnectDelayMs: 2,
    maxReconnectAttempts: 2,
    onEvent: (event) => events.push(event),
    onState: (state) => states.push(state),
    onError: (error) => errors.push(error),
    ...extra
  });
  stream.setSubscriptions({ tickers: ["BTCUSDT"], candles: [] });
  return { clock, sockets, urls, events, states, errors, stream };
}

test("derivative deltas preserve missing fields, reject stale time and require a fresh snapshot", () => {
  const protocol = new BybitProtocol("linear");
  assert.equal(protocol.consume(ticker("delta", { lastPrice: "99" }), allowed), null);
  const first = protocol.consume(
    ticker("snapshot", {
      lastPrice: "100",
      markPrice: "99",
      prevPrice24h: "90",
      price24hPcnt: "0.1"
    }),
    allowed
  );
  assert.equal(first.quote.comparisonBasis, "rolling-24h");
  const second = protocol.consume(ticker("delta", { lastPrice: "101" }, 1001), allowed);
  assert.equal(second.quote.lastPrice, 101);
  assert.equal(second.quote.markPrice, 99);
  assert.equal(second.quote.previousPrice24h, 90);
  assert.equal(second.quote.changePercent24h, 10);
  const withoutSymbol = JSON.parse(ticker("delta", { markPrice: "98" }, 1001));
  delete withoutSymbol.data.symbol;
  assert.equal(protocol.consume(JSON.stringify(withoutSymbol), allowed).quote.markPrice, 98);
  assert.equal(protocol.consume(ticker("delta", { lastPrice: "1" }, 999), allowed), null);
  assert.equal(
    protocol.consume(ticker("delta", { lastPrice: "" }, 1002), allowed).quote.lastPrice,
    null
  );
  protocol.forget("tickers.BTCUSDT");
  assert.equal(protocol.consume(ticker("delta", { lastPrice: "2" }, 1003), allowed), null);
  assert.equal(
    protocol.consume(ticker("snapshot", { lastPrice: "7" }, 1004), allowed).quote.markPrice,
    null
  );
  protocol.reset();
  assert.equal(protocol.consume(ticker("delta", { lastPrice: "8" }, 1005), allowed), null);
});

class Recovery {
  connected = true;
  listeners = new Set();
  online = () => this.connected;
  listen = (wake) => {
    this.listeners.add(wake);
    return () => this.listeners.delete(wake);
  };
  wake(reason = "online") {
    for (const listener of this.listeners) listener(reason);
  }
}

test("offline start waits for online without polling and dispose removes recovery listeners", () => {
  const recovery = new Recovery();
  recovery.connected = false;
  const s = scenario("linear", { recovery });
  assert.equal(recovery.listeners.size, 0);
  s.stream.start();
  assert.equal(s.states.at(-1), "offline");
  assert.equal(s.sockets.length, 0);
  assert.equal(s.clock.timers.size, 0);
  recovery.connected = true;
  recovery.wake();
  assert.equal(s.sockets.length, 1);
  s.sockets[0].open();
  assert.equal(s.sockets[0].sent[0].op, "subscribe");
  s.stream.dispose();
  assert.equal(recovery.listeners.size, 0);
  recovery.wake();
  assert.equal(s.sockets.length, 1);
  assert.equal(s.clock.timers.size, 0);
  assert.deepEqual(s.stream.getDiagnostics(), []);
});

test("exhausted stream recovers on online but repeated browser signals cannot bypass its budget", () => {
  const recovery = new Recovery(),
    s = scenario("linear", { recovery });
  s.stream.start();
  s.clock.tick(100);
  assert.equal(s.states.at(-1), "exhausted");
  assert.equal(s.sockets.length, 3);
  s.stream.setSubscriptions({ tickers: ["BTCUSDT"], candles: [] });
  s.stream.start();
  assert.equal(s.sockets.length, 3);
  recovery.wake();
  recovery.wake("visible");
  assert.equal(s.sockets.length, 4);
  s.clock.tick(100);
  assert.equal(s.states.at(-1), "exhausted");
  recovery.wake();
  assert.equal(s.sockets.length, 6);
  assert.equal(s.clock.timers.size, 1);
  s.clock.tick(29_900);
  assert.equal(s.sockets.length, 7);
  s.sockets[6].open();
  s.sockets[6].message(ticker("snapshot", { lastPrice: "105" }));
  recovery.wake();
  assert.equal(s.sockets.length, 7);
  s.stream.dispose();
});

test("brief repeated offline periods resume without being lost to the exhausted cooldown", () => {
  const recovery = new Recovery(),
    s = scenario("linear", { recovery });
  recovery.connected = false;
  s.stream.start();
  for (let i = 0; i < 3; i++) {
    recovery.connected = true;
    recovery.wake();
    const socket = s.sockets.at(-1);
    socket.open();
    socket.message(ticker("snapshot", { lastPrice: "100" }, 1000 + i));
    recovery.connected = false;
    socket.drop();
    s.clock.tick(2);
    assert.equal(s.states.at(-1), "offline");
    assert.equal(s.clock.timers.size, 0);
  }
  assert.equal(s.sockets.length, 3);
  s.stream.dispose();
});

test("returning to a stale tab reconnects once while fresh data and pending backoff avoid churn", () => {
  const recovery = new Recovery(),
    s = scenario("linear", { recovery });
  s.stream.start();
  const old = s.sockets[0];
  old.open();
  old.message(ticker("snapshot", { lastPrice: "105" }));
  recovery.wake("visible");
  assert.equal(s.sockets.length, 1);
  // Simulate suspended browser timers while wall time advances.
  s.clock.time += 30_000;
  recovery.wake("visible");
  assert.equal(old.closed, 1);
  assert.equal(s.sockets.length, 2);
  s.sockets[1].open();
  s.sockets[1].drop();
  recovery.wake();
  assert.equal(s.sockets.length, 2);
  s.clock.tick(2);
  assert.equal(s.sockets.length, 3);
  s.stream.dispose();
});

test("successful payloads replenish consecutive retry budget over many real disconnects", () => {
  const s = scenario();
  s.stream.start();
  for (let i = 0; i < 8; i++) {
    const socket = s.sockets.at(-1);
    socket.open();
    socket.message(ticker("snapshot", { lastPrice: "100" }, 1000 + i));
    socket.drop();
    s.clock.tick(2);
  }
  assert.equal(s.sockets.length, 9);
  assert.equal(s.states.includes("exhausted"), false);
  s.stream.dispose();
});

test("native close metadata survives error-before-close without preserving raw reason or frames", () => {
  const original = globalThis.WebSocket;
  const native = new Socket();
  globalThis.WebSocket = class {
    constructor() {
      return native;
    }
  };
  const s = scenario("linear", {
    socketFactory: undefined,
    heartbeatMs: 60_000,
    connectTimeoutMs: 1000
  });
  try {
    s.stream.start();
    native.open();
    native.onerror();
    s.clock.tick(249);
    assert.equal(native.closed, 0);
    native.drop({ code: 1006, wasClean: false, reason: "secret-sentinel" });
    const diagnostics = s.stream.getDiagnostics();
    assert.deepEqual(diagnostics.at(-1), {
      category: "linear",
      reason: "socket-close",
      timestamp: 249,
      retry: 0,
      closeCode: 1006,
      wasClean: false
    });
    assert.doesNotMatch(JSON.stringify(diagnostics), /secret-sentinel/);
    diagnostics[0].reason = "mutated";
    assert.equal(s.stream.getDiagnostics()[0].reason, "socket-close");
    assert.equal(s.clock.timers.size, 1);
  } finally {
    s.stream.dispose();
    globalThis.WebSocket = original;
  }
});

test("error without close has a bounded fallback and diagnostics distinguish timeout and protocol", () => {
  const s = scenario("linear", { heartbeatMs: 60_000, connectTimeoutMs: 1000 });
  s.stream.start();
  s.sockets[0].open();
  s.sockets[0].onerror();
  s.clock.tick(250);
  assert.equal(s.stream.getDiagnostics().at(-1).reason, "socket-error");
  s.clock.tick(2);
  s.sockets[1].open();
  s.sockets[1].message("secret-sentinel");
  assert.equal(s.stream.getDiagnostics().at(-1).reason, "protocol");
  s.clock.tick(1004);
  assert.equal(s.stream.getDiagnostics().at(-1).reason, "connect-timeout");
  assert.doesNotMatch(JSON.stringify(s.stream.getDiagnostics()), /secret-sentinel/);
  s.stream.dispose();
});

test("diagnostic history is bounded for long sessions and cleared on dispose", () => {
  const s = scenario();
  s.stream.start();
  for (let i = 0; i < 75; i++) {
    const socket = s.sockets.at(-1);
    socket.open();
    socket.message(ticker("snapshot", { lastPrice: "100" }, 1000 + i));
    socket.drop({ code: 1001, wasClean: true });
    s.clock.tick(2);
  }
  assert.equal(s.stream.getDiagnostics().length, 64);
  assert.equal(s.stream.getDiagnostics()[0].timestamp, 22);
  assert.ok(
    s.stream
      .getDiagnostics()
      .every(
        (entry, index, entries) => index === 0 || entry.timestamp >= entries[index - 1].timestamp
      )
  );
  s.stream.dispose();
  assert.deepEqual(s.stream.getDiagnostics(), []);
});

test("diagnostics use epoch milliseconds when an injected clock has no now function", () => {
  const clock = new Clock();
  const s = scenario("linear", {
    clock: {
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout
    }
  });
  try {
    const before = Date.now();
    s.stream.start();
    s.sockets[0].drop({ code: 1006, wasClean: false });
    const timestamp = s.stream.getDiagnostics()[0].timestamp;
    assert.ok(timestamp >= before && timestamp <= Date.now());
    assert.ok(timestamp > 1_000_000_000_000);
  } finally {
    s.stream.dispose();
  }
});

test("invalid subscription/timer budgets and pre-aborted stream never create a socket", () => {
  const s = scenario(),
    abort = new AbortController();
  abort.abort();
  assert.throws(() => s.stream.start(abort.signal), { name: "AbortError" });
  assert.equal(s.sockets.length, 0);
  assert.throws(
    () =>
      subscriptionTopics("spot", {
        tickers: Array.from({ length: 1001 }, (_, i) => `COIN${i}USDT`),
        candles: []
      }),
    /1000/
  );
  assert.throws(() => new BybitStream("spot", { maxReconnectAttempts: 11 }), /budget/);
  assert.throws(() => new BybitStream("spot", { heartbeatMs: 60001 }), /timer/);
  s.stream.dispose();
});

test("default browser recovery observes visible/online/pageshow and unregisters all listeners", () => {
  const originals = new Map(
    ["window", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  );
  class Target extends EventTarget {
    listeners = new Set();
    addEventListener(type, listener) {
      this.listeners.add(listener);
      super.addEventListener(type, listener);
    }
    removeEventListener(type, listener) {
      this.listeners.delete(listener);
      super.removeEventListener(type, listener);
    }
  }
  const win = new Target(),
    doc = new Target();
  doc.visibilityState = "hidden";
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  const s = scenario();
  try {
    s.stream.start();
    s.clock.tick(100);
    assert.equal(s.states.at(-1), "exhausted");
    doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(s.sockets.length, 3);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("online"));
    win.dispatchEvent(new Event("pageshow"));
    assert.equal(s.sockets.length, 4);
    assert.equal(win.listeners.size, 2);
    assert.equal(doc.listeners.size, 1);
    s.stream.dispose();
    assert.equal(win.listeners.size, 0);
    assert.equal(doc.listeners.size, 0);
    win.dispatchEvent(new Event("online"));
    assert.equal(s.sockets.length, 4);
  } finally {
    s.stream.dispose();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("spot protocol is snapshot-only; malformed/unrelated messages never modify active quotes", () => {
  const protocol = new BybitProtocol("spot");
  assert.equal(
    protocol.consume(ticker("snapshot", { lastPrice: "100" }), allowed).quote.seriesId,
    "bybit:spot:BTCUSDT"
  );
  assert.throws(() => protocol.consume(ticker("delta", { lastPrice: "101" }), allowed), /snapshot/);
  assert.equal(protocol.consume(JSON.stringify({ topic: "tickers.ETHUSDT" }), allowed), null);
  for (const value of [
    "not-json",
    "[]",
    "null",
    new Uint8Array([1]),
    JSON.stringify({ success: false, op: "subscribe" })
  ])
    assert.throws(
      () => protocol.consume(value, allowed),
      (error) => error instanceof BybitError && error.kind === "protocol"
    );
  assert.throws(
    () => protocol.consume(ticker("snapshot", { symbol: "ETHUSDT" }), allowed),
    /symbol/
  );
  assert.equal(
    protocol.consume(JSON.stringify({ op: "ping", ret_msg: "pong", success: true }), allowed).kind,
    "pong"
  );
});

test("WS candle confirm survives normalization and unsupported intervals cannot subscribe", () => {
  const protocol = new BybitProtocol("linear");
  const frame = (confirmed) =>
    JSON.stringify({
      topic: "kline.1.BTCUSDT",
      type: "snapshot",
      ts: 2000 + Number(confirmed),
      data: [
        {
          start: 1000,
          interval: "1",
          open: "10",
          high: "12",
          low: "9",
          close: "11",
          volume: "2",
          turnover: "22",
          confirm: confirmed
        }
      ]
    });
  const first = protocol.consume(frame(false), allowed);
  assert.equal(first.interval, "1m");
  assert.equal(first.candles[0].timestamp, 1000);
  assert.equal(first.candles[0].confirmed, false);
  assert.equal(protocol.consume(frame(true), allowed).candles[0].confirmed, true);
  assert.equal(protocol.consume(frame(false), allowed), null);
  for (const interval of ["2m", "10m"])
    assert.throws(
      () => subscriptionTopics("spot", { tickers: [], candles: [{ symbol: "BTCUSDT", interval }] }),
      /Unsupported/
    );
});

test("public category sockets are inert until started and subscriptions batch/dedupe/update", () => {
  const s = scenario("spot");
  const symbols = Array.from({ length: 23 }, (_, i) => `COIN${i}USDT`);
  s.stream.setSubscriptions({ tickers: [...symbols, symbols[0]], candles: [] });
  assert.equal(s.sockets.length, 0);
  s.stream.start();
  assert.deepEqual(s.urls, ["wss://stream.bybit.com/v5/public/spot"]);
  const socket = s.sockets[0];
  socket.open();
  assert.deepEqual(
    socket.sent.map((i) => i.args.length),
    [10, 10, 3]
  );
  s.stream.setSubscriptions({
    tickers: [symbols[0]],
    candles: [{ symbol: "BTCUSDT", interval: "1m" }]
  });
  const updates = socket.sent.slice(3);
  assert.deepEqual(
    updates.map((i) => i.op),
    ["unsubscribe", "unsubscribe", "unsubscribe", "subscribe"]
  );
  assert.equal(updates.at(-1).args[0], "kline.1.BTCUSDT");
  s.stream.dispose();
  assert.equal(socket.closed, 1);
  assert.equal(s.clock.timers.size, 0);
});

test("reconnect resubscribes, rejects old callbacks and resets delta state", () => {
  const s = scenario();
  s.stream.start();
  const first = s.sockets[0];
  first.open();
  first.message(ticker("snapshot", { lastPrice: "100" }));
  const staleMessage = first.onmessage,
    staleClose = first.onclose;
  first.drop();
  assert.equal(s.states.at(-1), "reconnecting");
  s.clock.tick(2);
  assert.equal(s.sockets.length, 2);
  const second = s.sockets[1];
  second.open();
  const count = s.events.length;
  staleMessage({ data: ticker("snapshot", { lastPrice: "1" }, 2000) });
  staleClose();
  assert.equal(s.events.length, count);
  second.message(ticker("delta", { lastPrice: "2" }, 2000));
  assert.equal(s.events.length, count);
  second.message(ticker("snapshot", { lastPrice: "105" }, 2001));
  assert.equal(s.events.at(-1).quote.lastPrice, 105);
  assert.equal(second.sent[0].op, "subscribe");
  assert.equal(s.urls[1], "wss://stream.bybit.com/v5/public/linear");
  s.stream.dispose();
  assert.equal(s.clock.timers.size, 0);
});

test("heartbeat requires pong and bounded reconnect stops after consecutive failed connections", () => {
  const s = scenario();
  s.stream.start();
  const socket = s.sockets[0];
  socket.open();
  s.clock.tick(10);
  assert.equal(socket.sent.at(-1).op, "ping");
  socket.message(JSON.stringify({ op: "ping", ret_msg: "pong", success: true }));
  s.clock.tick(3);
  assert.equal(socket.closed, 0);
  s.clock.tick(10);
  assert.equal(socket.closed, 1);
  assert.equal(s.errors.at(-1).kind, "timeout");
  s.clock.tick(100);
  assert.equal(s.states.at(-1), "exhausted");
  assert.equal(s.sockets.length, 3);
  assert.equal(s.clock.timers.size, 0);
  s.stream.dispose();
});

test("abort/dispose cancels pending reconnect and empty subscriptions release only this stream", () => {
  const s = scenario(),
    other = scenario("spot"),
    controller = new AbortController();
  s.stream.start(controller.signal);
  other.stream.start();
  other.sockets[0].open();
  const old = s.sockets[0];
  old.open();
  const stale = old.onmessage;
  old.drop();
  controller.abort();
  s.clock.tick(1000);
  stale({ data: ticker("snapshot", { lastPrice: "1" }) });
  assert.equal(s.sockets.length, 1);
  assert.equal(s.events.length, 0);
  assert.equal(s.clock.timers.size, 0);
  assert.equal(other.sockets[0].closed, 0);
  other.stream.setSubscriptions({ tickers: [], candles: [] });
  assert.equal(other.sockets[0].closed, 1);
  assert.equal(other.clock.timers.size, 0);
  other.stream.setSubscriptions({ tickers: ["ETHUSDT"], candles: [] });
  assert.equal(other.sockets.length, 2);
  other.stream.dispose();
  s.stream.dispose();
  assert.throws(() => s.stream.start(), /disposed/);
});

test("connection factory/send/protocol failures retry within budget and owner callback can dispose", () => {
  const s = scenario();
  s.stream.start();
  s.sockets[0].open();
  s.sockets[0].message(JSON.stringify({ success: false, op: "subscribe" }));
  assert.equal(s.errors[0].kind, "protocol");
  assert.equal(s.clock.timers.size, 1);
  s.clock.tick(2);
  s.sockets[1].send = () => {
    throw new Error("send failed");
  };
  s.sockets[1].open();
  assert.equal(s.errors.at(-1).kind, "network");
  s.clock.tick(4);
  assert.equal(s.sockets.length, 3);
  s.stream.dispose();
  assert.equal(s.clock.timers.size, 0);
  const failed = scenario("spot", {
    socketFactory: () => {
      throw new Error("factory failed");
    }
  });
  failed.stream.start();
  failed.clock.tick(100);
  assert.equal(failed.states.at(-1), "exhausted");
  failed.stream.dispose();
  let reentrant;
  reentrant = scenario("spot", {
    onState: (state) => {
      if (state === "connecting") reentrant.stream.dispose();
    }
  });
  reentrant.stream.start();
  assert.equal(reentrant.sockets.length, 0);
  assert.equal(reentrant.clock.timers.size, 0);
});

for (const phase of ["error", "reconnecting"]) {
  test(`reentrant ${phase} subscription sync reserves one replacement and cleans every socket/timer`, () => {
    let s;
    const sync = () => s.stream.setSubscriptions({ tickers: ["BTCUSDT"], candles: [] });
    s = scenario("linear", {
      onError: () => {
        if (phase === "error") sync();
      },
      onState: (state) => {
        if (phase === "reconnecting" && state === "reconnecting") sync();
      }
    });
    s.stream.start();
    s.sockets[0].open();
    s.sockets[0].drop();
    assert.equal(s.sockets.length, 1, "reentrant sync must keep the reserved backoff");
    assert.equal(s.clock.timers.size, 1);
    s.clock.tick(2);
    assert.equal(s.sockets.length, 2);
    s.sockets[1].open();
    assert.deepEqual(s.sockets[1].sent[0].args, ["tickers.BTCUSDT"]);
    s.stream.dispose();
    assert.ok(s.sockets.every((socket) => socket.closed === 1));
    assert.equal(s.clock.timers.size, 0);
  });

  test(`reentrant ${phase} clear/resubscribe invalidates the old retry continuation`, () => {
    let s,
      changed = false;
    const replace = () => {
      if (changed) return;
      changed = true;
      s.stream.setSubscriptions({ tickers: [], candles: [] });
      s.stream.setSubscriptions({ tickers: ["ETHUSDT"], candles: [] });
    };
    s = scenario("linear", {
      onError: () => {
        if (phase === "error") replace();
      },
      onState: (state) => {
        if (phase === "reconnecting" && state === "reconnecting") replace();
      }
    });
    s.stream.start();
    s.sockets[0].open();
    s.sockets[0].drop();
    assert.equal(s.sockets.length, 2);
    s.sockets[1].open();
    assert.deepEqual(s.sockets[1].sent[0].args, ["tickers.ETHUSDT"]);
    s.clock.tick(2);
    assert.equal(s.sockets.length, 2, "old retry must not replace the reentrant connection");
    s.stream.dispose();
    assert.ok(s.sockets.every((socket) => socket.closed === 1));
    assert.equal(s.clock.timers.size, 0);
  });

  test(`reentrant ${phase} disposal cancels reserved work and all recovery listeners`, () => {
    const recovery = new Recovery();
    let s;
    s = scenario("linear", {
      recovery,
      onError: () => {
        if (phase === "error") s.stream.dispose();
      },
      onState: (state) => {
        if (phase === "reconnecting" && state === "reconnecting") s.stream.dispose();
      }
    });
    s.stream.start();
    s.sockets[0].open();
    s.sockets[0].drop();
    s.clock.tick(100);
    assert.equal(s.sockets.length, 1);
    assert.equal(s.clock.timers.size, 0);
    assert.equal(recovery.listeners.size, 0);
  });
}

test("connecting callback can sync subscriptions without recursive factories", () => {
  let s;
  s = scenario("linear", {
    onState: (state) => {
      if (state === "connecting") s.stream.setSubscriptions({ tickers: ["BTCUSDT"], candles: [] });
    }
  });
  s.stream.start();
  assert.equal(s.sockets.length, 1);
  s.stream.dispose();
  assert.equal(s.clock.timers.size, 0);
});

test("connecting clear/resubscribe replaces the connection intent before creating a socket", () => {
  let s,
    changed = false;
  s = scenario("linear", {
    onState: (state) => {
      if (state !== "connecting" || changed) return;
      changed = true;
      s.stream.setSubscriptions({ tickers: [], candles: [] });
      s.stream.setSubscriptions({ tickers: ["ETHUSDT"], candles: [] });
    }
  });
  s.stream.start();
  assert.equal(s.sockets.length, 1);
  s.sockets[0].open();
  assert.deepEqual(s.sockets[0].sent[0].args, ["tickers.ETHUSDT"]);
  s.stream.dispose();
  assert.equal(s.clock.timers.size, 0);
});

for (const action of ["dispose", "replace"]) {
  test(`factory ${action} reentry closes its stale returned socket without orphaning timers`, () => {
    let s,
      changed = false;
    const created = [];
    s = scenario("linear", {
      socketFactory: () => {
        const socket = new Socket();
        created.push(socket);
        if (!changed) {
          changed = true;
          if (action === "dispose") s.stream.dispose();
          else {
            s.stream.setSubscriptions({ tickers: [], candles: [] });
            s.stream.setSubscriptions({ tickers: ["ETHUSDT"], candles: [] });
          }
        }
        return socket;
      }
    });
    s.stream.start();
    assert.equal(created[0].closed, 1, "factory return lost its lease and must be closed");
    if (action === "replace") {
      assert.equal(created.length, 2);
      created[1].open();
      assert.deepEqual(created[1].sent[0].args, ["tickers.ETHUSDT"]);
    }
    s.stream.dispose();
    assert.ok(created.every((socket) => socket.closed === 1));
    assert.equal(s.clock.timers.size, 0);
  });
}

test("synchronous recovery registration cannot orphan a connection or cleanup on nested abort", () => {
  for (const abortDuringListen of [false, true]) {
    const abort = new AbortController();
    let removed = 0;
    const recovery = {
      online: () => true,
      listen(wake) {
        wake("online");
        if (abortDuringListen) abort.abort();
        return () => removed++;
      }
    };
    const s = scenario("linear", { recovery });
    s.stream.start(abort.signal);
    assert.equal(s.sockets.length, 1);
    if (abortDuringListen) assert.equal(s.sockets[0].closed, 1);
    s.stream.dispose();
    assert.equal(removed, 1);
    assert.equal(s.sockets[0].closed, 1);
    assert.equal(s.clock.timers.size, 0);
  }
});

test("a reentrant close implementation cannot let an old retry commandeer its replacement", () => {
  const s = scenario();
  s.stream.start();
  const old = s.sockets[0];
  old.open();
  old.close = () => {
    old.closed++;
    old.readyState = 3;
    s.stream.setSubscriptions({ tickers: ["ETHUSDT"], candles: [] });
  };
  old.drop();
  assert.equal(s.sockets.length, 2);
  s.sockets[1].open();
  assert.deepEqual(s.sockets[1].sent[0].args, ["tickers.ETHUSDT"]);
  assert.equal(s.clock.timers.size, 1, "only the replacement heartbeat remains");
  s.stream.dispose();
  assert.equal(s.clock.timers.size, 0);
  assert.ok(s.sockets.every((socket) => socket.closed === 1));
});

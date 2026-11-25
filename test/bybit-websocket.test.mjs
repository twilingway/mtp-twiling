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
  drop() {
    this.readyState = 3;
    this.onclose?.();
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

import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const { OkxStream } = sourceLoader()("services/providers/okx/stream.ts");
const spot = { provider: "okx", category: "spot", symbol: "BTC-USDT" };
const swap = { provider: "okx", category: "linear", symbol: "BTC-USDT-SWAP" };
const start = 1_790_000_000_000;

class Clock {
  now = 0;
  sequence = 0;
  timers = new Map();
  setTimeout = (callback, delay) => {
    const id = ++this.sequence;
    this.timers.set(id, { callback, at: this.now + delay });
    return id;
  };
  clearTimeout = (id) => this.timers.delete(id);
  tick(delay) {
    const until = this.now + delay;
    for (let count = 0; count < 100; count++) {
      const next = [...this.timers.entries()].sort((left, right) => left[1].at - right[1].at)[0];
      if (!next || next[1].at > until) {
        this.now = until;
        return;
      }
      const [id, { callback, at }] = next;
      this.now = at;
      this.timers.delete(id);
      callback();
    }
    assert.fail("OKX timer loop did not settle");
  }
}

class Socket {
  readyState = 0;
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  sent = [];
  constructor(url) {
    this.url = url;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(value) {
    this.onmessage?.({ data: typeof value === "string" ? value : JSON.stringify(value) });
  }
  send(value) {
    this.sent.push(value === "ping" ? value : JSON.parse(value));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  ack(command, arg = command.args[0], id = command.id) {
    this.message({ event: command.op, id, arg, connId: "abcd1234" });
  }
}

function fixture() {
  const sockets = [],
    quotes = [],
    candles = [],
    errors = [];
  const clock = new Clock();
  let reconnects = 0;
  const stream = new OkxStream({
    socket: (url) => {
      const socket = new Socket(url);
      sockets.push(socket);
      return socket;
    },
    clock,
    onQuote: (quote) => quotes.push(quote),
    onCandles: (ref, timeframe, bars) => candles.push({ ref, timeframe, bars }),
    onReconnect: () => reconnects++,
    onError: (error) => errors.push(error)
  });
  return { stream, clock, sockets, quotes, candles, errors, reconnects: () => reconnects };
}

function ticker(ref, ts = start, fields = {}) {
  return {
    arg: { channel: "tickers", instId: ref.symbol },
    data: [
      {
        instId: ref.symbol,
        instType: ref.category === "spot" ? "SPOT" : "SWAP",
        ts: String(ts),
        last: "110",
        open24h: "100",
        ...fields
      }
    ]
  };
}

function candle(ref, channel, timestamp, confirm = "0", close = "110") {
  return {
    arg: { channel, instId: ref.symbol },
    data: [[String(timestamp), "100", "120", "90", close, "12", "2.5", "250", confirm]]
  };
}

test("OKX starts lazily, batches unique ticker IDs, and uses a business candle channel", () => {
  const f = fixture();
  f.stream.start();
  assert.equal(f.sockets.length, 0);
  f.stream.setSubscriptions({
    tickers: [spot, swap, spot],
    candle: { ref: swap, timeframe: "1d" }
  });
  const [publicSocket, business] = f.sockets;
  assert.equal(publicSocket.url, "wss://ws.okx.com/ws/v5/public");
  assert.equal(business.url, "wss://ws.okx.com/ws/v5/business");
  publicSocket.open();
  business.open();
  assert.deepEqual(publicSocket.sent[0].args, [
    { channel: "tickers", instId: spot.symbol },
    { channel: "tickers", instId: swap.symbol }
  ]);
  assert.deepEqual(business.sent[0].args, [{ channel: "candle1Dutc", instId: swap.symbol }]);
  assert.ok([publicSocket, business].every((socket) => socket.sent[0].op === "subscribe"));
  f.stream.dispose();
  assert.ok(f.sockets.every((socket) => socket.readyState === 3));
  assert.equal(f.clock.timers.size, 0);
});

test("OKX accepts ticker updates only after matching ACK and rejects stale or duplicate updates", () => {
  const f = fixture();
  f.stream.setSubscriptions({ tickers: [spot, swap], candle: null });
  f.stream.start();
  const socket = f.sockets[0];
  socket.open();
  const command = socket.sent[0];
  socket.message(ticker(spot));
  socket.ack(command, command.args[0], "wrong-request");
  socket.message(ticker(spot));
  socket.ack(command, { channel: "tickers", instId: "ETH-USDT" });
  socket.message(ticker(spot));
  assert.equal(f.quotes.length, 0);
  socket.ack(command);
  socket.message(ticker(spot));
  socket.message(ticker(spot));
  socket.message(ticker(spot, start - 1, { last: "109" }));
  socket.message(ticker(spot, start, { last: "111" }));
  socket.message(ticker(swap));
  socket.ack(command, command.args[1]);
  socket.message(ticker(swap));
  assert.deepEqual(
    f.quotes.map((quote) => [quote.seriesId, quote.lastPrice]),
    [
      ["okx:spot:BTC-USDT", 110],
      ["okx:spot:BTC-USDT", 111],
      ["okx:linear:BTC-USDT-SWAP", 110]
    ]
  );
  socket.message(ticker(swap, start + 1, { instType: "SPOT" }));
  assert.equal(f.quotes.length, 3);
  assert.equal(f.errors.length, 1);
  f.stream.dispose();
});

test("OKX candle changes wait for ACKs and allow late closes without regressing confirmed bars", () => {
  const f = fixture();
  f.stream.setSubscriptions({ tickers: [], candle: { ref: swap, timeframe: "4h" } });
  f.stream.start();
  const socket = f.sockets[0];
  socket.open();
  const initial = socket.sent[0];
  assert.equal(initial.args[0].channel, "candle4H");
  socket.message(candle(swap, "candle4H", start));
  socket.ack(initial);
  socket.message(candle(swap, "candle4H", start));
  socket.message(candle(swap, "candle4H", start));
  socket.message(candle(swap, "candle4H", start + 4 * 3_600_000));
  socket.message(candle(swap, "candle4H", start, "1", "111"));
  socket.message(candle(swap, "candle4H", start, "0", "112"));
  assert.deepEqual(
    f.candles.map((event) => [
      event.timeframe,
      event.bars[0].confirmed,
      event.bars[0].close,
      event.bars[0].baseVolume
    ]),
    [
      ["4h", false, 110, 2.5],
      ["4h", false, 110, 2.5],
      ["4h", true, 111, 2.5]
    ]
  );
  f.stream.setSubscriptions({ tickers: [], candle: { ref: spot, timeframe: "1d" } });
  f.stream.setSubscriptions({ tickers: [], candle: { ref: spot, timeframe: "1w" } });
  assert.equal(socket.sent.length, 2);
  assert.equal(socket.sent[1].op, "unsubscribe");
  socket.message(candle(swap, "candle4H", start, "1", "113"));
  socket.ack(socket.sent[1]);
  assert.deepEqual(socket.sent[2].args, [{ channel: "candle1Wutc", instId: spot.symbol }]);
  socket.ack(socket.sent[2]);
  socket.message(candle(spot, "candle1Wutc", start));
  assert.equal(f.candles.length, 4);
  assert.equal(f.candles[3].timeframe, "1w");
  assert.equal(f.candles[3].bars[0].baseVolume, 12);
  f.stream.dispose();
});

test("OKX heartbeat is driven by silence and an acknowledged business reconnect refreshes history", () => {
  const f = fixture();
  f.stream.setSubscriptions({ tickers: [], candle: { ref: spot, timeframe: "1m" } });
  f.stream.start();
  const first = f.sockets[0];
  first.open();
  first.ack(first.sent[0]);
  f.clock.tick(19_000);
  first.message(candle(spot, "candle1m", start));
  f.clock.tick(19_999);
  assert.equal(first.sent.length, 1);
  f.clock.tick(1);
  assert.equal(first.sent.at(-1), "ping");
  f.clock.tick(8_000);
  assert.equal(first.readyState, 3);
  assert.match(f.errors[0].message, /heartbeat/);
  f.clock.tick(999);
  assert.equal(f.sockets.length, 1);
  f.clock.tick(1);
  const second = f.sockets[1];
  second.open();
  assert.equal(f.reconnects(), 0);
  second.ack(second.sent[0]);
  assert.equal(f.reconnects(), 1);
  f.clock.tick(20_000);
  assert.equal(second.sent.at(-1), "ping");
  second.message("pong");
  f.clock.tick(8_000);
  assert.equal(f.errors.length, 1);
  f.stream.dispose();
});

test("OKX bounds failed subscription retries and cancels all callbacks on abort", () => {
  const f = fixture();
  const abort = new AbortController();
  f.stream.setSubscriptions({ tickers: [spot], candle: null });
  f.stream.start(abort.signal);
  const first = f.sockets[0];
  first.open();
  f.clock.tick(10_000);
  assert.match(f.errors[0].message, /acknowledgement/);
  f.clock.tick(200_000);
  assert.equal(f.sockets.length, 6);
  assert.ok(f.sockets.every((socket) => socket.readyState === 3));
  assert.equal(f.clock.timers.size, 0);
  f.stream.setSubscriptions({ tickers: [spot], candle: null });
  assert.equal(f.sockets.length, 6);
  f.stream.setSubscriptions({ tickers: [swap], candle: { ref: swap, timeframe: "1m" } });
  assert.equal(f.sockets.length, 8);
  abort.abort();
  assert.ok(f.sockets.every((socket) => socket.readyState === 3 && socket.onmessage === null));
  assert.equal(f.clock.timers.size, 0);
});

test("OKX ticker reconnect does not refresh charts or reopen a removed candle socket", () => {
  const f = fixture();
  f.stream.setSubscriptions({ tickers: [spot], candle: { ref: swap, timeframe: "1d" } });
  f.stream.start();
  const [publicSocket, business] = f.sockets;
  publicSocket.open();
  business.open();
  publicSocket.ack(publicSocket.sent[0]);
  business.ack(business.sent[0]);
  f.stream.setSubscriptions({ tickers: [spot], candle: null });
  assert.equal(business.readyState, 3);
  assert.equal(publicSocket.readyState, 1);
  publicSocket.close();
  f.clock.tick(1_000);
  assert.equal(f.sockets.length, 3);
  const retry = f.sockets[2];
  assert.equal(retry.url, publicSocket.url);
  retry.open();
  retry.ack(retry.sent[0]);
  assert.equal(f.reconnects(), 0);
  f.stream.dispose();
});

test("OKX partial ACKs and their data do not restart the retry budget", () => {
  const f = fixture();
  f.stream.setSubscriptions({ tickers: [spot, swap], candle: null });
  f.stream.start();
  for (let attempt = 0; attempt <= 5; attempt++) {
    const socket = f.sockets[attempt];
    socket.open();
    socket.ack(socket.sent[0]);
    socket.message(ticker(spot, start + attempt));
    f.clock.tick(10_000);
    if (attempt < 5) f.clock.tick(1_000 * 2 ** attempt);
  }
  f.clock.tick(60_000);
  assert.equal(f.quotes.length, 6);
  assert.equal(f.sockets.length, 6);
  assert.equal(f.clock.timers.size, 0);
  f.stream.dispose();
});

test("Browser online revives exhausted OKX subscriptions and disposal removes its listener", (t) => {
  const network = new EventTarget();
  const oldWindow = globalThis.window;
  globalThis.window = network;
  const f = fixture();
  t.after(() => {
    f.stream.dispose();
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
  });
  const sameTopics = { tickers: [spot], candle: { ref: spot, timeframe: "1d" } };
  f.stream.setSubscriptions(sameTopics);
  f.stream.start();
  const [publicSocket, business] = f.sockets;
  for (const socket of [publicSocket, business]) {
    socket.open();
    socket.ack(socket.sent[0]);
    socket.close();
  }
  f.clock.tick(200_000);
  assert.equal(f.sockets.length, 12);
  assert.equal(f.clock.timers.size, 0);
  f.stream.setSubscriptions(sameTopics);
  f.stream.start();
  assert.equal(f.sockets.length, 12);
  assert.equal(getEventListeners(network, "online").length, 1);

  network.dispatchEvent(new Event("online"));
  network.dispatchEvent(new Event("online"));
  assert.equal(f.sockets.length, 14);
  const publicRetry = f.sockets[12],
    businessRetry = f.sockets[13];
  publicRetry.open();
  businessRetry.open();
  publicRetry.message(ticker(spot));
  businessRetry.message(candle(spot, "candle1Dutc", start));
  assert.equal(f.quotes.length + f.candles.length, 0);
  publicRetry.ack(publicRetry.sent[0]);
  businessRetry.ack(businessRetry.sent[0]);
  publicRetry.message(ticker(spot));
  businessRetry.message(candle(spot, "candle1Dutc", start));
  assert.equal(f.quotes[0].seriesId, "okx:spot:BTC-USDT");
  assert.equal(f.candles[0].timeframe, "1d");
  assert.equal(f.reconnects(), 1);

  f.stream.dispose();
  assert.equal(getEventListeners(network, "online").length, 0);
  assert.equal(f.clock.timers.size, 0);
  network.dispatchEvent(new Event("online"));
  assert.equal(f.sockets.length, 14);
});

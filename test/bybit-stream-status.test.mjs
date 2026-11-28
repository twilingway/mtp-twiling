import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { PublicMarket } = load("services/market-public.ts");
const row = {
  uid: "bybit:linear:BTCUSDT",
  providerRef: { provider: "bybit", category: "linear", symbol: "BTCUSDT" }
};
function fixture() {
  const notices = [],
    reconnects = [],
    quotes = [],
    streams = [];
  const market = new PublicMarket(
    () => "public",
    {},
    {
      quote: (quote) => quotes.push(quote),
      candle() {},
      notice: (message) => notices.push(message),
      reconnect: (source) => reconnects.push(source)
    },
    {
      stream: (category, options) => {
        const stream = { category, options, setSubscriptions() {}, start() {}, dispose() {} };
        streams.push(stream);
        return stream;
      }
    }
  );
  market.sync([row]);
  return { market, notices, reconnects, quotes, streams, options: streams[0].options };
}

test("Bybit notices distinguish retry/exhausted/offline and actual recovery while keeping source", async () => {
  const f = fixture();
  try {
    f.options.onState("open");
    assert.deepEqual(f.reconnects, []);
    f.options.onState("reconnecting");
    f.options.onState("reconnecting");
    assert.equal(f.notices.length, 1);
    assert.match(f.notices.at(-1), /переподключаемся/);
    f.options.onState("exhausted");
    assert.match(f.notices.at(-1), /Обновления Bybit \(контракты\) остановлены/);
    f.options.onState("offline");
    assert.match(f.notices.at(-1), /Нет сети/);
    f.options.onState("open");
    assert.deepEqual(f.reconnects, [{ provider: "bybit", category: "linear" }]);
    assert.doesNotMatch(f.notices.at(-1), /восстановлен/);
    f.options.onEvent({ kind: "pong" });
    f.options.onEvent({ kind: "ack" });
    f.options.onEvent({ kind: "quote", quote: { lastPrice: null } });
    f.options.onEvent({ kind: "candles", ref: row.providerRef, interval: "1m", candles: [] });
    assert.doesNotMatch(f.notices.at(-1), /восстановлен/);
    const quote = { ref: row.providerRef, seriesId: row.uid, lastPrice: 100 };
    f.options.onEvent({ kind: "quote", quote });
    assert.match(f.notices.at(-1), /восстановлен/);
    assert.deepEqual(f.quotes, [{ lastPrice: null }, quote]);
    assert.equal(f.streams.length, 1);
  } finally {
    await f.market.close();
  }
});

test("closed market ignores stale Bybit recovery/error state and payload callbacks", async () => {
  const f = fixture();
  await f.market.close();
  for (const state of ["open", "reconnecting", "exhausted", "offline"]) f.options.onState(state);
  f.options.onEvent({ kind: "quote", quote: { lastPrice: 1 } });
  assert.deepEqual(f.notices, []);
  assert.deepEqual(f.reconnects, []);
  assert.deepEqual(f.quotes, []);
});

test("all eight Bybit state/category notices translate completely through systemText", () => {
  const { bybitStreamNotices } = load("services/providers/bybit/stream-status.ts");
  const { systemText, t } = load("i18n/messages.ts");
  const messages = [];
  for (const category of ["spot", "linear"]) {
    const notices = bybitStreamNotices(category, (message) => messages.push(message));
    for (const state of ["reconnecting", "exhausted", "offline"]) notices.state(state);
    notices.event({ kind: "quote", quote: { lastPrice: 100 } });
  }
  assert.equal(new Set(messages).size, 8);
  for (const message of messages) {
    const translated = systemText(message, "en");
    assert.equal(translated, t(message, "en"));
    assert.notEqual(translated, message);
    assert.doesNotMatch(translated, /\p{Script=Cyrillic}/u);
    assert.match(translated, /Bybit \((?:spot|linear contracts)\)/);
    assert.equal(systemText(message, "ru"), message);
  }
});

test("PublicMarket notice reentry preserves one retry, resubscription and one catch-up notification", async () => {
  const { BybitStream } = load("services/providers/bybit/websocket.ts");
  const timers = new Map(),
    sockets = [],
    reconnects = [];
  let serial = 0,
    time = 0,
    market;
  const clock = {
    now: () => time,
    setTimeout(callback, delay) {
      const id = ++serial;
      timers.set(id, { callback, at: time + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id)
  };
  const runNext = () => {
    const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
    time = timer.at;
    timers.delete(id);
    timer.callback();
  };
  market = new PublicMarket(
    () => "public",
    {},
    {
      quote() {},
      candle() {},
      notice: () => market.sync([row]),
      reconnect(source) {
        reconnects.push(source);
        market.select(row, "1m");
      }
    },
    {
      stream: (category, options) =>
        new BybitStream(category, {
          ...options,
          clock,
          reconnectDelayMs: 2,
          socketFactory: () => {
            const socket = {
              readyState: 0,
              closed: 0,
              sent: [],
              onopen: null,
              onmessage: null,
              onclose: null,
              onerror: null,
              send(text) {
                this.sent.push(JSON.parse(text));
              },
              close() {
                this.readyState = 3;
                this.closed++;
              },
              open() {
                this.readyState = 1;
                this.onopen?.();
              }
            };
            sockets.push(socket);
            return socket;
          }
        })
    }
  );
  try {
    market.sync([row]);
    sockets[0].open();
    sockets[0].readyState = 3;
    sockets[0].onclose({ code: 1006, wasClean: false });
    assert.equal(sockets.length, 1);
    assert.equal(timers.size, 1);
    runNext();
    assert.equal(sockets.length, 2);
    sockets[1].open();
    assert.deepEqual(reconnects, [{ provider: "bybit", category: "linear" }]);
    assert.deepEqual(
      sockets[1].sent.map((message) => message.args),
      [["tickers.BTCUSDT"], ["kline.1.BTCUSDT"]]
    );
    assert.equal(sockets.length, 2);
  } finally {
    await market.close();
  }
  assert.ok(sockets.every((socket) => socket.closed === 1));
  assert.equal(timers.size, 0);
});

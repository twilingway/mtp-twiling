import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
function sources(overrides = {}) {
  const context = vm.createContext({
    Date,
    DOMException,
    AbortController,
    AbortSignal,
    console,
    EventTarget,
    Event,
    structuredClone,
    crypto,
    Blob,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout
  });
  const modules = new Map();
  function load(relative) {
    const filename = path.resolve(sourceRoot, relative).replace(/\.js$/, ".ts");
    const key = path.relative(sourceRoot, filename).replaceAll(path.sep, "/");
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (key === "services/storage-db.ts")
      return new Proxy({}, { get: () => () => assert.fail("unexpected direct IndexedDB access") });
    assert.ok(!key.startsWith("../"));
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
const ms = (text) => Date.parse(text);
const at = (date, time) => ms(`${date}T${time}:00Z`);
const model = sources().load("model/candle-clock.ts");
function day(
  date,
  periods = [
    ["09:00", "12:00"],
    ["12:30", "18:00"]
  ]
) {
  const intervals = periods.map(([start, end]) => ({ start: at(date, start), end: at(date, end) }));
  return {
    date: at(date, "00:00"),
    isTradingDay: intervals.length > 0,
    start: intervals[0]?.start ?? null,
    end: intervals.at(-1)?.end ?? null,
    intervals
  };
}
function response(exchange = "MOEX_TEST", rawDays) {
  return {
    exchanges: [
      {
        exchange,
        days: rawDays ?? [
          {
            date: "2026-11-25T00:00:00Z",
            isTradingDay: true,
            startTime: "2026-11-25T09:00:00Z",
            endTime: "2026-11-25T18:00:00Z",
            intervals: [
              {
                type: "regular_trading_session",
                interval: { startTs: "2026-11-25T09:00:00Z", endTs: "2026-11-25T18:00:00Z" }
              }
            ]
          }
        ]
      }
    ]
  };
}
function mockClient(schedule = () => response()) {
  const calls = [];
  const client = {
    request: async (service, method, body, signal) => {
      calls.push({ service, method, body, signal });
      if (method === "GetInstrumentBy")
        return { instrument: { uid: body.id, exchange: "moex_test" } };
      return schedule(body, signal);
    }
  };
  return { client, calls };
}
const loadArgs = ["uid", at("2026-11-25", "10:00"), "1m", at("2026-11-25", "10:00")];

test("intraday countdown closes the candle interval, caps sessions and rejects stale/future bars", () => {
  const days = [day("2026-11-25")],
    now = at("2026-11-25", "10:11");
  for (const [tf, start, end] of [
    ["1m", "10:11", "10:12"],
    ["5m", "10:10", "10:15"],
    ["15m", "10:00", "10:15"],
    ["30m", "10:00", "10:30"],
    ["1h", "10:00", "11:00"]
  ]) {
    assert.equal(
      model.candleCloseAt(at("2026-11-25", start), tf, now, days),
      at("2026-11-25", end)
    );
  }
  const shortSession = [day("2026-11-25", [["09:00", "10:35"]])];
  assert.equal(
    model.candleCloseAt(at("2026-11-25", "10:00"), "1h", now, shortSession),
    at("2026-11-25", "10:35")
  );
  assert.equal(model.candleCloseAt(at("2026-11-25", "09:00"), "1h", now, days), null);
  assert.equal(model.candleCloseAt(at("2026-11-25", "11:00"), "1h", now, days), null);
  assert.equal(model.candleCloseAt(at("2026-11-25", "10:00"), "1h", now, []), null);
});

test("clearing, weekends and closed session hide the countdown while overnight intervals remain valid", () => {
  const days = [day("2026-11-25"), day("2026-11-28", [])];
  const insideHour = [
    day("2026-11-25", [
      ["09:00", "11:30"],
      ["11:35", "18:00"]
    ])
  ];
  assert.equal(
    model.candleCloseAt(at("2026-11-25", "11:00"), "1h", at("2026-11-25", "11:20"), insideHour),
    at("2026-11-25", "12:00")
  );
  assert.equal(
    model.candleCloseAt(at("2026-11-25", "11:00"), "1h", at("2026-11-25", "11:32"), insideHour),
    null
  );
  assert.equal(
    model.candleCloseAt(at("2026-11-25", "11:00"), "1h", at("2026-11-25", "11:40"), insideHour),
    at("2026-11-25", "12:00")
  );
  assert.equal(
    model.candleCloseAt(at("2026-11-25", "12:00"), "1h", at("2026-11-25", "12:15"), days),
    null
  );
  assert.equal(
    model.candleCloseAt(at("2026-11-25", "17:00"), "1h", at("2026-11-25", "18:00"), days),
    null
  );
  assert.equal(
    model.candleCloseAt(at("2026-11-28", "10:00"), "1h", at("2026-11-28", "10:15"), days),
    null
  );
  const overnight = {
    date: at("2026-11-25", "00:00"),
    isTradingDay: true,
    start: at("2026-11-25", "20:00"),
    end: at("2026-11-26", "02:00"),
    intervals: [{ start: at("2026-11-25", "20:00"), end: at("2026-11-26", "02:00") }]
  };
  const bar = at("2026-11-25", "23:45"),
    now = at("2026-11-26", "00:05");
  assert.equal(model.candleCloseAt(bar, "30m", now, [overnight]), at("2026-11-26", "00:15"));
  assert.equal(model.candleCloseAt(overnight.date, "1d", now, [overnight]), overnight.end);
});

test("daily and weekly candles require authoritative current/future days, not elapsed week days", () => {
  const days = Array.from({ length: 7 }, (_, i) =>
    day(`2026-11-${23 + i}`, i >= 4 ? [] : undefined)
  );
  const now = at("2026-11-25", "10:00"),
    daily = at("2026-11-25", "00:00"),
    weekly = at("2026-11-23", "00:00");
  assert.equal(model.candleCloseAt(daily, "1d", now, days), at("2026-11-25", "18:00"));
  assert.equal(model.candleCloseAt(weekly, "1w", now, days), at("2026-11-26", "18:00"));
  assert.equal(model.candleCloseAt(weekly, "1w", now, days.slice(2)), at("2026-11-26", "18:00"));
  assert.equal(model.candleCloseAt(weekly, "1w", now, days.slice(0, 6)), null);
  assert.equal(model.candleCloseAt(at("2026-11-24", "00:00"), "1d", now, days), null);
  assert.equal(model.candleCloseAt(daily, "1d", at("2026-11-25", "12:15"), days), null);
});

test("calendar periods cross years and formatting preserves seconds/hours/days without negative output", () => {
  const period = model.candleCalendarPeriod(at("2026-12-31", "10:00"), "1w");
  assert.equal(period.start, at("2026-12-28", "00:00"));
  assert.equal(period.end, at("2027-01-04", "00:00"));
  assert.equal(model.formatCountdown(61_000), "01:01");
  assert.equal(model.formatCountdown(1001), "00:02");
  assert.equal(model.formatCountdown(3_661_000), "01:01:01");
  assert.equal(model.formatCountdown(90_061_000), "1д 01:01:01");
  assert.equal(model.formatCountdown(-10), "00:00");
});

test("calendar parser filters exchange case-insensitively, merges duplicates and subtracts clearing/auctions", () => {
  const service = sources().load("services/tbank-calendar.ts"),
    raw = response();
  raw.exchanges.push({
    exchange: "OTHER",
    days: [{ date: "2026-11-25T00:00:00Z", isTradingDay: false }]
  });
  raw.exchanges[0].days[0].intervals.push(
    {
      type: "regular_trading_session_morning",
      interval: { startTs: "2026-11-25T09:00:00Z", endTs: "2026-11-25T12:00:00Z" }
    },
    {
      type: "clearing",
      interval: { startTs: "2026-11-25T12:00:00Z", endTs: "2026-11-25T12:30:00Z" }
    },
    {
      type: "closing_auction_main",
      interval: { startTs: "2026-11-25T17:55:00Z", endTs: "2026-11-25T18:00:00Z" }
    }
  );
  const parsed = service.parseTradingCalendar(raw, "moex_test");
  assert.equal(parsed.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed[0].intervals)), [
    { start: at("2026-11-25", "09:00"), end: at("2026-11-25", "12:00") },
    { start: at("2026-11-25", "12:30"), end: at("2026-11-25", "17:55") }
  ]);
  assert.equal(service.parseTradingCalendar(raw, "WRONG").length, 0);
});

test("legacy calendar fields include evening/overnight trading and keep clearing hidden", () => {
  const service = sources().load("services/tbank-calendar.ts");
  const parsed = service.parseTradingCalendar(
    response("MOEX_TEST", [
      {
        date: "2026-11-25T00:00:00Z",
        isTradingDay: true,
        startTime: "2026-11-25T09:00:00Z",
        endTime: "2026-11-25T18:00:00Z",
        clearingStartTime: "2026-11-25T12:00:00Z",
        clearingEndTime: "2026-11-25T12:30:00Z",
        eveningStartTime: "2026-11-25T19:00:00Z",
        eveningEndTime: "2026-11-26T02:00:00Z"
      }
    ]),
    "moex_test"
  );
  assert.equal(parsed[0].end, at("2026-11-26", "02:00"));
  assert.equal(parsed[0].intervals.length, 3);
  assert.equal(
    model.candleCloseAt(at("2026-11-25", "12:00"), "1h", at("2026-11-25", "12:15"), parsed),
    null
  );
});

test("metadata and date-range cache are reused by new bars, shared exchanges, and isolated clients", async () => {
  const service = sources().load("services/tbank-calendar.ts"),
    mock = mockClient();
  for (let i = 0; i < 3; i++)
    await service.loadCandleCalendar(
      mock.client,
      "uid",
      loadArgs[1] + i * 60_000,
      "1m",
      loadArgs[3] + i * 60_000,
      new AbortController().signal
    );
  assert.equal(mock.calls.length, 2);
  await service.loadCandleCalendar(
    mock.client,
    "second-uid",
    loadArgs[1],
    "1m",
    loadArgs[3],
    new AbortController().signal
  );
  assert.equal(mock.calls.length, 3);
  const other = mockClient();
  await service.loadCandleCalendar(other.client, ...loadArgs, new AbortController().signal);
  assert.equal(other.calls.length, 2);
  await service.loadCandleCalendar(
    mock.client,
    "uid",
    loadArgs[1] + 5 * 60_000,
    "1m",
    loadArgs[3] + 5 * 60_000,
    new AbortController().signal
  );
  assert.equal(mock.calls.length, 4);
  await service.loadCandleCalendar(
    mock.client,
    "uid",
    at("2026-11-26", "00:00"),
    "1m",
    at("2026-11-26", "00:00"),
    new AbortController().signal
  );
  assert.equal(mock.calls.length, 5);
});

test("aborting one calendar consumer preserves the other and abort-all permits immediate retry", async () => {
  let release, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let scheduleSignal;
  const mock = mockClient(async (_body, signal) => {
    scheduleSignal = signal;
    started();
    return gate;
  });
  const service = sources().load("services/tbank-calendar.ts"),
    first = new AbortController(),
    second = new AbortController();
  const p1 = service.loadCandleCalendar(mock.client, ...loadArgs, first.signal);
  const p2 = service.loadCandleCalendar(mock.client, ...loadArgs, second.signal);
  await ready;
  first.abort();
  await assert.rejects(p1, { name: "AbortError" });
  assert.equal(scheduleSignal.aborted, false);
  second.abort();
  await assert.rejects(p2, { name: "AbortError" });
  assert.equal(scheduleSignal.aborted, true);
  release(response());
  const retried = await service.loadCandleCalendar(
    mock.client,
    ...loadArgs,
    new AbortController().signal
  );
  assert.equal(retried.length, 1);
  assert.equal(mock.calls.filter((call) => call.method === "GetInstrumentBy").length, 1);
  assert.equal(mock.calls.filter((call) => call.method === "TradingSchedules").length, 2);
});

test("wrong-exchange responses and failed metadata are retryable without poisoning caches", async () => {
  const service = sources().load("services/tbank-calendar.ts");
  let wrong = true;
  const mock = mockClient(() => {
    const value = response(wrong ? "OTHER" : "MOEX_TEST");
    wrong = false;
    return value;
  });
  await assert.rejects(
    service.loadCandleCalendar(
      mock.client,
      "uid",
      loadArgs[1],
      "1m",
      loadArgs[3] + 59_000,
      new AbortController().signal
    )
  );
  await assert.rejects(
    service.loadCandleCalendar(
      mock.client,
      "uid",
      loadArgs[1] + 60_000,
      "1m",
      loadArgs[3] + 61_000,
      new AbortController().signal
    )
  );
  assert.equal(mock.calls.filter((call) => call.method === "TradingSchedules").length, 1);
  const value = await service.loadCandleCalendar(
    mock.client,
    "uid",
    loadArgs[1] + 120_000,
    "1m",
    loadArgs[3] + 120_000,
    new AbortController().signal
  );
  assert.equal(value.length, 1);
  assert.equal(mock.calls.filter((call) => call.method === "GetInstrumentBy").length, 1);
  let attempt = 0;
  const failing = {
    request: async (_service, method) => {
      if (method === "GetInstrumentBy" && attempt++ === 0) throw new Error("offline");
      return method === "GetInstrumentBy" ? { instrument: { exchange: "moex_test" } } : response();
    }
  };
  await assert.rejects(
    service.loadCandleCalendar(
      failing,
      "uid",
      loadArgs[1],
      "1m",
      loadArgs[3] + 59_000,
      new AbortController().signal
    )
  );
  await assert.rejects(
    service.loadCandleCalendar(
      failing,
      "uid",
      loadArgs[1] + 60_000,
      "1m",
      loadArgs[3] + 61_000,
      new AbortController().signal
    )
  );
  assert.equal(attempt, 1);
  assert.equal(
    (
      await service.loadCandleCalendar(
        failing,
        "uid",
        loadArgs[1] + 120_000,
        "1m",
        loadArgs[3] + 120_000,
        new AbortController().signal
      )
    ).length,
    1
  );
});

test("controller discards stale owner/client/aborted results and optional errors stay silent", async () => {
  let resolve, reject;
  const calendar = {
    loadCandleCalendar: () =>
      new Promise((done, fail) => {
        resolve = done;
        reject = fail;
      })
  };
  const { load } = sources({ "services/storage.ts": {}, "services/tbank-calendar.ts": calendar });
  const { TerminalController } = load("screens/terminal/controller.ts");
  const controller = new TerminalController(),
    first = {},
    second = {};
  controller.session.client = first;
  controller.update({ owner: "alice" });
  const valid = controller.loadCandleCalendar(...loadArgs, new AbortController().signal);
  resolve([day("2026-11-25")]);
  assert.equal((await valid).length, 1);
  const staleOwner = controller.loadCandleCalendar(...loadArgs, new AbortController().signal);
  controller.update({ owner: "bob" });
  resolve([day("2026-11-25")]);
  assert.equal((await staleOwner).length, 0);
  const staleClient = controller.loadCandleCalendar(...loadArgs, new AbortController().signal);
  controller.session.client = second;
  resolve([day("2026-11-25")]);
  assert.equal((await staleClient).length, 0);
  const abort = new AbortController(),
    canceled = controller.loadCandleCalendar(...loadArgs, abort.signal);
  abort.abort();
  resolve([day("2026-11-25")]);
  assert.equal((await canceled).length, 0);
  const failure = controller.loadCandleCalendar(...loadArgs, new AbortController().signal);
  reject(new Error("optional network failure"));
  assert.equal((await failure).length, 0);
  assert.equal(controller.getSnapshot().toast, "");
});

test("calendar API receives only today/future ranges and weekly close ignores inaccessible past dates", async () => {
  const service = sources().load("services/tbank-calendar.ts"),
    now = at("2026-11-25", "10:00"),
    today = at("2026-11-25", "00:00");
  const mock = mockClient((body) => {
    if (ms(body.from) < today) throw new Error("400: from cannot be less than current date");
    const rawDays = [];
    for (let date = ms(body.from); date <= ms(body.to); date = model.shiftUtcDate(date, 1)) {
      const weekday = new Date(date).getUTCDay(),
        trading = weekday >= 1 && weekday <= 4;
      const start = date + 9 * 3600_000,
        end = date + 18 * 3600_000;
      rawDays.push({
        date: new Date(date).toISOString(),
        isTradingDay: trading,
        ...(trading
          ? {
              startTime: new Date(start).toISOString(),
              endTime: new Date(end).toISOString(),
              intervals: [
                {
                  type: "regular_trading_session",
                  interval: {
                    startTs: new Date(start).toISOString(),
                    endTs: new Date(end).toISOString()
                  }
                }
              ]
            }
          : {})
      });
    }
    return response("MOEX_TEST", rawDays);
  });
  const weekBar = at("2026-11-23", "00:00");
  const weekly = await service.loadCandleCalendar(
    mock.client,
    "uid",
    weekBar,
    "1w",
    now,
    new AbortController().signal
  );
  assert.equal(
    mock.calls.find((call) => call.method === "TradingSchedules").body.from,
    new Date(today).toISOString()
  );
  assert.equal(
    weekly.some((item) => item.date < today),
    false
  );
  assert.equal(model.candleCloseAt(weekBar, "1w", now, weekly), at("2026-11-26", "18:00"));
  const before = mock.calls.length;
  assert.equal(
    (
      await service.loadCandleCalendar(
        mock.client,
        "uid",
        at("2026-11-24", "00:00"),
        "1d",
        now,
        new AbortController().signal
      )
    ).length,
    0
  );
  assert.equal(
    (
      await service.loadCandleCalendar(
        mock.client,
        "uid",
        at("2026-11-16", "00:00"),
        "1w",
        now,
        new AbortController().signal
      )
    ).length,
    0
  );
  assert.equal(
    (
      await service.loadCandleCalendar(
        mock.client,
        "uid",
        now - 60_000,
        "1m",
        now,
        new AbortController().signal
      )
    ).length,
    0
  );
  assert.equal(mock.calls.length, before);
  const overnightNow = at("2026-11-26", "00:05"),
    overnightBar = at("2026-11-25", "23:45");
  const overnight = await service.loadCandleCalendar(
    mock.client,
    "uid",
    overnightBar,
    "30m",
    overnightNow,
    new AbortController().signal
  );
  assert.equal(model.candleCloseAt(overnightBar, "30m", overnightNow, overnight), null);
  assert.equal(
    mock.calls
      .filter((call) => call.method === "TradingSchedules")
      .every((call) => ms(call.body.from) >= today),
    true
  );
});

test("confirmed overnight days survive UTC midnight only for the proved client/UID exchange", async () => {
  const service = sources().load("services/tbank-calendar.ts");
  let serverToday = at("2026-11-25", "00:00");
  const overnightRaw = {
    date: "2026-11-25T00:00:00Z",
    isTradingDay: true,
    startTime: "2026-11-25T20:00:00Z",
    endTime: "2026-11-26T02:00:00Z",
    intervals: [
      {
        type: "regular_trading_session_evening",
        interval: { startTs: "2026-11-25T20:00:00Z", endTs: "2026-11-26T02:00:00Z" }
      }
    ]
  };
  const schedule = (body) => {
    if (ms(body.from) < serverToday) throw new Error("400: historical calendar forbidden");
    return response(
      "MOEX_TEST",
      serverToday === at("2026-11-25", "00:00")
        ? [overnightRaw, { date: "2026-11-26T00:00:00Z", isTradingDay: false }]
        : [{ date: "2026-11-26T00:00:00Z", isTradingDay: false }]
    );
  };
  const mock = mockClient(schedule),
    dailyBar = at("2026-11-25", "00:00");
  const before = await service.loadCandleCalendar(
    mock.client,
    "uid",
    dailyBar,
    "1d",
    at("2026-11-25", "23:40"),
    new AbortController().signal
  );
  assert.equal(
    model.candleCloseAt(dailyBar, "1d", at("2026-11-25", "23:40"), before),
    at("2026-11-26", "02:00")
  );
  serverToday = at("2026-11-26", "00:00");
  const now = at("2026-11-26", "00:05"),
    callCount = mock.calls.length;
  const daily = await service.loadCandleCalendar(
    mock.client,
    "uid",
    dailyBar,
    "1d",
    now,
    new AbortController().signal
  );
  assert.equal(model.candleCloseAt(dailyBar, "1d", now, daily), at("2026-11-26", "02:00"));
  const intradayBar = at("2026-11-25", "23:30");
  const hourly = await service.loadCandleCalendar(
    mock.client,
    "uid",
    intradayBar,
    "1h",
    now,
    new AbortController().signal
  );
  assert.equal(model.candleCloseAt(intradayBar, "1h", now, hourly), at("2026-11-26", "00:30"));
  assert.equal(mock.calls.length, callCount);
  assert.equal(
    (
      await service.loadCandleCalendar(
        mock.client,
        "unknown-uid",
        dailyBar,
        "1d",
        now,
        new AbortController().signal
      )
    ).length,
    0
  );
  assert.equal(mock.calls.length, callCount);
  const cold = mockClient(schedule);
  assert.equal(
    (
      await service.loadCandleCalendar(
        cold.client,
        "uid",
        dailyBar,
        "1d",
        now,
        new AbortController().signal
      )
    ).length,
    0
  );
  assert.equal(
    (
      await service.loadCandleCalendar(
        cold.client,
        "uid",
        intradayBar,
        "1h",
        now,
        new AbortController().signal
      )
    ).length,
    0
  );
  assert.equal(cold.calls.length, 0);
  assert.equal(
    (
      await service.loadCandleCalendar(
        mock.client,
        "uid",
        dailyBar,
        "1d",
        at("2026-11-26", "02:00"),
        new AbortController().signal
      )
    ).length,
    0
  );
  const after = await service.loadCandleCalendar(
    mock.client,
    "uid",
    at("2026-11-26", "10:00"),
    "1h",
    at("2026-11-26", "10:05"),
    new AbortController().signal
  );
  assert.equal(
    after.some((item) => item.date < serverToday),
    false
  );
});

test("weekly future-only refresh merges a still-active proved overnight day", async () => {
  const service = sources().load("services/tbank-calendar.ts");
  let today = at("2026-11-25", "00:00");
  const mock = mockClient((body) => {
    if (ms(body.from) < today) throw new Error("past dates forbidden");
    const days = [];
    for (let date = ms(body.from); date <= ms(body.to); date = model.shiftUtcDate(date, 1)) {
      if (date === at("2026-11-25", "00:00"))
        days.push({
          date: new Date(date).toISOString(),
          isTradingDay: true,
          startTime: "2026-11-25T20:00:00Z",
          endTime: "2026-11-26T02:00:00Z"
        });
      else if (date === at("2026-11-27", "00:00"))
        days.push({
          date: new Date(date).toISOString(),
          isTradingDay: true,
          startTime: "2026-11-27T09:00:00Z",
          endTime: "2026-11-27T18:00:00Z"
        });
      else days.push({ date: new Date(date).toISOString(), isTradingDay: false });
    }
    return response("MOEX_TEST", days);
  });
  await service.loadCandleCalendar(
    mock.client,
    "uid",
    today,
    "1d",
    at("2026-11-25", "23:40"),
    new AbortController().signal
  );
  today = at("2026-11-26", "00:00");
  const now = at("2026-11-26", "00:05"),
    bar = at("2026-11-23", "00:00");
  const days = await service.loadCandleCalendar(
    mock.client,
    "uid",
    bar,
    "1w",
    now,
    new AbortController().signal
  );
  assert.equal(model.candleCloseAt(bar, "1w", now, days), at("2026-11-27", "18:00"));
  const requests = mock.calls.filter((call) => call.method === "TradingSchedules");
  assert.equal(requests.length, 2);
  assert.equal(ms(requests[1].body.from), today);
});

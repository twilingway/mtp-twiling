import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const context = vm.createContext({ Date, Intl });
const modules = new Map();
function load(relative) {
  const file = path.resolve(root, relative).replace(/\.js$/, ".ts");
  assert.ok(file.startsWith(root));
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
  }).outputText;
  new vm.Script(`(function(require,module,exports){${code}\n})`, { filename: file }).runInContext(
    context
  )(
    (specifier) => load(path.relative(root, path.resolve(path.dirname(file), specifier))),
    module,
    module.exports
  );
  return module.exports;
}
const { calendarAxisDisplay } = load("i18n/calendar-axis.ts");
const { calendarAxisTicks } = load("model/intervals/axis-ticks.ts");
const { paintCalendarGrid, paintCalendarAxis } = load("charts/lightweight-calendar-grid.ts");
const bars = (start, count, step) =>
  Array.from({ length: count }, (_, i) => ({ timestamp: Date.parse(start) + i * step }));
const ticks = (data, timeframe, zone) =>
  calendarAxisTicks(data, timeframe, {
    from: 0,
    to: data.length - 1,
    width: 1000,
    coordinate: (i) => 40 + i * 7,
    display: calendarAxisDisplay(timeframe, { timeZone: zone, locale: "en" })
  });

test("hourly grid uses selected local midnight while UTC timestamps stay unchanged", () => {
  const data = bars("2026-03-03T00:00:00Z", 72, 3600000);
  const original = JSON.stringify(data);
  const moscow = Array.from(ticks(data, "1h", "Europe/Moscow"), (tick) => tick.value);
  const utc = Array.from(ticks(data, "1h", "UTC"), (tick) => tick.value);
  assert.ok(moscow.includes(Date.parse("2026-03-03T21:00:00Z")));
  assert.ok(!utc.includes(Date.parse("2026-03-03T21:00:00Z")));
  assert.ok(utc.includes(Date.parse("2026-03-04T00:00:00Z")));
  assert.equal(JSON.stringify(data), original);
});

test("DST changes day widths by real bar counts; daily trading dates ignore display zone", () => {
  const hourly = bars("2026-03-07T05:00:00Z", 96, 3600000);
  const starts = Array.from(ticks(hourly, "1h", "America/New_York"), (tick) => tick.value);
  const march8 = Date.parse("2026-03-08T05:00:00Z");
  const march9 = Date.parse("2026-03-09T04:00:00Z");
  assert.ok(starts.includes(march8));
  assert.ok(starts.includes(march9));
  assert.equal((march9 - march8) / 3600000, 23);
  const daily = bars("2026-01-01T00:00:00Z", 100, 86400000);
  const ny = Array.from(ticks(daily, "1d", "America/New_York"), (tick) => ({ ...tick }));
  const utc = Array.from(ticks(daily, "1d", "UTC"), (tick) => ({ ...tick }));
  assert.deepEqual(ny, utc);
});

test("calendar grid and painted axis labels use identical local boundary positions", () => {
  const data = bars("2026-03-03T00:00:00Z", 72, 3600000);
  const grid = [],
    labels = [];
  const ctx = {
    save() {},
    restore() {},
    setLineDash() {},
    beginPath() {},
    stroke() {},
    lineTo() {},
    moveTo(x) {
      grid.push(x);
    },
    measureText(text) {
      return { width: text.length * 6 };
    },
    fillText(text, x) {
      labels.push({ text, x });
    }
  };
  const options = {
    from: 0,
    to: data.length - 1,
    width: 1000,
    height: 26,
    coordinate: (i) => 40 + i * 7,
    color: "#999999",
    fontSize: 11,
    fontFamily: "Arial",
    display: calendarAxisDisplay("1h", { timeZone: "Europe/Moscow", locale: "en" })
  };
  paintCalendarGrid(ctx, data, "1h", options);
  paintCalendarAxis(ctx, data, "1h", options);
  assert.equal(grid.length, labels.length);
  assert.deepEqual(
    grid.map((x) => x - 0.5),
    labels.map((label) => label.x)
  );
  assert.ok(labels.some((label) => label.text.includes("Mar")));
});

test("minute intervals place the date at local midnight and choose local clock grid marks", () => {
  const data = bars("2026-03-03T00:00:00Z", 2880, 60000);
  const display = calendarAxisDisplay("1m", { timeZone: "Europe/Moscow", locale: "en" });
  const selected = calendarAxisTicks(data, "1m", {
    from: 0,
    to: data.length - 1,
    width: 1300,
    coordinate: (i) => 40 + i * 0.4,
    display
  });
  const times = Array.from(selected, (tick) => tick.value);
  assert.ok(times.includes(Date.parse("2026-03-03T21:00:00Z")));
  assert.ok(!times.includes(Date.parse("2026-03-04T00:00:00Z")));
  assert.ok(selected.some((tick) => tick.text === "08:00"));
  const nepal = calendarAxisDisplay("1m", { timeZone: "Asia/Kathmandu", locale: "en" });
  const fractional = calendarAxisTicks(data, "1m", {
    from: 500,
    to: 800,
    width: 1300,
    coordinate: (i) => (i - 500) * 4,
    display: nepal
  });
  assert.ok(
    fractional.some((tick) => {
      const utc = new Date(tick.value);
      return utc.getUTCMinutes() === 15 && tick.text.endsWith(":00");
    })
  );
});

test("calendar rendering avoids repeated Intl parts conversion and uses a UTC fast path", () => {
  const original = Intl.DateTimeFormat.prototype.formatToParts;
  let calls = 0;
  Intl.DateTimeFormat.prototype.formatToParts = function (...args) {
    calls++;
    return original.apply(this, args);
  };
  try {
    const data = bars("2025-01-01T00:00:00Z", 6200, 3600000);
    const display = calendarAxisDisplay("1h", { timeZone: "Europe/Moscow", locale: "ru" });
    const options = { from: 0, to: 6199, width: 1300, coordinate: (i) => i * 0.2, display };
    calendarAxisTicks(data, "1h", options);
    assert.ok(calls <= 6200, `one conversion per new timestamp, got ${calls}`);
    const beforeAxis = calls;
    calendarAxisTicks(data, "1h", options);
    assert.equal(calls, beforeAxis, "axis reuses parts already calculated for grid");
    const daily = calendarAxisDisplay("1d", { timeZone: "America/New_York", locale: "en" });
    calendarAxisTicks(data, "1d", { ...options, display: daily });
    assert.equal(calls, beforeAxis, "DWM trading dates use UTC getters");
  } finally {
    Intl.DateTimeFormat.prototype.formatToParts = original;
  }
});

test("2m, 10m and 30m non-aligned candles keep clock ticks in fractional-offset zones", () => {
  for (const [timeframe, duration] of [
    ["2m", 2],
    ["10m", 10],
    ["30m", 30]
  ]) {
    const data = bars("2026-03-03T00:00:00Z", 200, duration * 60000);
    const selected = calendarAxisTicks(data, timeframe, {
      from: 80,
      to: 180,
      width: 1000,
      coordinate: (index) => (index - 80) * 10,
      display: calendarAxisDisplay(timeframe, { timeZone: "Asia/Kathmandu", locale: "en" })
    });
    assert.ok(selected.length >= 3, `${timeframe} must keep a visible time axis`);
    assert.ok(
      selected.some((tick) => tick.text.includes(":")),
      `${timeframe} must show clock ticks`
    );
    for (const tick of selected) assert.ok(data.some((bar) => bar.timestamp === tick.value));
  }
});

test("Fit beyond the old parts limit reuses all loaded parts across grid, axis and camera changes", () => {
  const original = Intl.DateTimeFormat.prototype.formatToParts;
  let calls = 0;
  Intl.DateTimeFormat.prototype.formatToParts = function (...args) {
    calls++;
    return original.apply(this, args);
  };
  try {
    const data = bars("2025-01-01T00:00:00Z", 15077, 1800000);
    const display = calendarAxisDisplay("30m", { timeZone: "Europe/Moscow", locale: "ru" });
    const options = {
      from: 0,
      to: data.length - 1,
      width: 324,
      coordinate: (index) => (index * 324) / data.length,
      display
    };
    const grid = calendarAxisTicks(data, "30m", options);
    assert.equal(calls, data.length);
    const axis = calendarAxisTicks(data, "30m", options);
    assert.deepEqual(axis, grid);
    assert.equal(calls, data.length, "a full scan must not evict its own timestamp slots");
    const moved = {
      ...options,
      from: 1000,
      to: 12000,
      coordinate: (index) => ((index - 1000) * 324) / 11000
    };
    calendarAxisTicks(data, "30m", moved);
    assert.equal(calls, data.length, "pan and zoom reuse exact parts without reusing coordinates");
    const nativeDisplay = { ...display, partsForData: undefined };
    const expected = calendarAxisTicks(data, "30m", { ...moved, display: nativeDisplay });
    assert.deepEqual(
      calendarAxisTicks(data, "30m", moved),
      expected,
      "legacy display callbacks and positional cache choose identical ticks"
    );
  } finally {
    Intl.DateTimeFormat.prototype.formatToParts = original;
  }
});

test("loaded parts have no fixed-size scan ceiling and validate changed timestamps and data size", () => {
  const original = Intl.DateTimeFormat.prototype.formatToParts;
  let calls = 0;
  Intl.DateTimeFormat.prototype.formatToParts = function (...args) {
    calls++;
    return original.apply(this, args);
  };
  try {
    const data = bars("2022-01-01T00:00:00Z", 70001, 1800000);
    const display = calendarAxisDisplay("30m", { timeZone: "America/New_York", locale: "en" });
    let parts = display.partsForData(data);
    for (let index = 0; index < data.length; index++) parts(data[index].timestamp, index);
    assert.equal(calls, data.length);
    const replaced = data.map((bar) => ({ ...bar }));
    parts = display.partsForData(replaced);
    for (let index = 0; index < replaced.length; index++) parts(replaced[index].timestamp, index);
    assert.equal(calls, data.length, "replacement arrays retain timestamp-valid positional slots");
    replaced[35000].timestamp += 60000;
    parts(replaced[35000].timestamp, 35000);
    assert.equal(calls, data.length + 1, "same-length timestamp mutation must refresh its slot");
    const fresh = calendarAxisDisplay("30m", { timeZone: "America/New_York", locale: "en" });
    assert.deepEqual(
      parts(replaced[35000].timestamp, 35000),
      fresh.parts(replaced[35000].timestamp)
    );
    display.partsForData(data.slice(0, 10));
    const beforeExpand = calls;
    parts = display.partsForData(data);
    for (let index = 0; index < data.length; index++) parts(data[index].timestamp, index);
    assert.ok(
      calls - beforeExpand >= data.length - 10 - 8192,
      "shrinking the loaded dataset releases trailing positional slots"
    );
  } finally {
    Intl.DateTimeFormat.prototype.formatToParts = original;
  }
});

test("shared calendar text matches Intl exactly through DST, fractional offsets, dates and locales", () => {
  const instants = [
    "2026-03-08T06:59:00Z",
    "2026-03-08T07:00:00Z",
    "2026-11-01T05:30:00Z",
    "2026-11-01T06:30:00Z",
    "2026-04-04T14:59:00Z",
    "2026-04-04T15:00:00Z",
    "2024-02-29T23:45:00Z",
    "2025-02-28T23:45:00Z",
    "2026-12-31T23:59:00Z"
  ].map(Date.parse);
  for (const zone of ["America/New_York", "Australia/Lord_Howe", "Asia/Kathmandu", "Europe/Moscow"])
    for (const locale of ["ru", "en"]) {
      const display = calendarAxisDisplay("30m", { timeZone: zone, locale });
      const formats = {
        year: { year: "numeric" },
        month: { month: "short" },
        day: { day: "numeric", month: "short" },
        clock: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
      };
      const numeric = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      });
      const data = instants.map((timestamp) => ({ timestamp }));
      const parts = display.partsForData(data);
      for (let pass = 0; pass < 2; pass++)
        for (let index = 0; index < data.length; index++) {
          const timestamp = data[index].timestamp;
          const expectedParts = Object.fromEntries(
            numeric
              .formatToParts(timestamp)
              .filter((part) => ["year", "month", "day", "hour", "minute"].includes(part.type))
              .map((part) => [part.type, Number(part.value)])
          );
          assert.deepEqual({ ...parts(timestamp, index) }, expectedParts);
          for (const [name, options] of Object.entries(formats)) {
            const expected = new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
              timeZone: zone,
              ...options
            }).format(timestamp);
            assert.equal(
              display[name](timestamp),
              expected,
              `${zone}/${locale}/${name}/${timestamp}`
            );
          }
        }
    }
});

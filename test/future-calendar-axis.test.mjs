import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const at = Date.parse;
const DAY = 86_400_000;
function sources(externals = {}) {
  const modules = new Map();
  const context = vm.createContext({ Date, Intl });
  function load(relative) {
    const filename = path.resolve(root, relative).replace(/\.js$/, ".ts");
    assert.ok(filename.startsWith(root));
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${code}\n})`, { filename }).runInContext(
      context
    )(
      (specifier) =>
        Object.hasOwn(externals, specifier)
          ? externals[specifier]
          : load(path.relative(root, path.resolve(path.dirname(filename), specifier))),
      module,
      module.exports
    );
    return module.exports;
  }
  return load;
}
const load = sources();
const { logicalForTime, timeForLogical, projectedCalendarDomain } = load(
  "model/intervals/projected-time.ts"
);
const { calendarAxisTicks } = load("model/intervals/axis-ticks.ts");
const { calendarAxisDisplay } = load("i18n/calendar-axis.ts");
const { paintCalendarGrid, paintCalendarAxis } = load("charts/lightweight-calendar-grid.ts");
const bar = (timestamp) =>
  Object.freeze({ timestamp, open: 10, high: 12, low: 8, close: 11, volume: 5 });
const snapshot = (data) => JSON.stringify(data);
const values = (ticks) => Array.from(ticks, (tick) => tick.value);
const display = (timeframe, timeZone = "UTC", locale = "en") =>
  calendarAxisDisplay(timeframe, { timeZone, locale });

test("shared timestamp projection preserves real gaps, future drawing coordinates and calendar months", () => {
  const adapter = load("charts/adapter.ts");
  assert.equal(adapter.logicalForTime, logicalForTime);
  assert.equal(adapter.timeForLogical, timeForLogical);
  const data = Object.freeze([bar(at("2024-02-01T00:00:00Z")), bar(at("2024-02-05T00:00:00Z"))]);
  assert.equal(logicalForTime(data, at("2024-02-03T00:00:00Z"), DAY), 0.5);
  assert.equal(logicalForTime(data, at("2024-02-07T00:00:00Z"), DAY), 3);
  assert.equal(timeForLogical(data, 3, DAY), at("2024-02-07T00:00:00Z"));
  assert.equal(timeForLogical(data, -1, DAY), at("2024-01-31T00:00:00Z"));
  const monthly = Object.freeze([bar(at("2023-12-01T00:00:00Z")), bar(at("2024-01-01T00:00:00Z"))]);
  assert.equal(timeForLogical(monthly, 2, null), at("2024-02-01T00:00:00Z"));
  assert.equal(logicalForTime(monthly, at("2024-02-15T12:00:00Z"), null), 2.5);
});

test("nine calendar months clamp month ends and leap years without a synthetic candle array", () => {
  for (const [last, end] of [
    ["2023-05-31T12:34:00Z", "2024-02-29T12:34:00Z"],
    ["2024-05-31T12:34:00Z", "2025-02-28T12:34:00Z"]
  ]) {
    const data = Object.freeze([bar(at(last))]),
      before = snapshot(data);
    const domain = projectedCalendarDomain(data, DAY);
    assert.equal(domain.end, at(end));
    assert.equal(domain.timestamp(1), at(last) + DAY);
    assert.equal(domain.timestamp(domain.lastIndex + 1), null);
    assert.equal(snapshot(data), before);
    assert.equal(data.length, 1);
  }
  assert.equal(projectedCalendarDomain([], DAY), null);
});

test("daily future months and years stop at the inclusive calendar horizon", () => {
  const data = Object.freeze([bar(at("2023-10-31T00:00:00Z"))]);
  const ticks = calendarAxisTicks(data, "1d", {
    from: 1,
    to: 1000,
    width: 1200,
    coordinate: (index) => index * 4,
    display: display("1d")
  });
  const times = values(ticks);
  for (const month of [
    "2023-11-01",
    "2023-12-01",
    "2024-01-01",
    "2024-02-01",
    "2024-03-01",
    "2024-04-01",
    "2024-05-01",
    "2024-06-01",
    "2024-07-01"
  ])
    assert.ok(times.includes(at(month)), month);
  assert.ok(!times.includes(at("2024-08-01")));
  assert.ok(times.every((time) => time <= at("2024-07-31")));
  assert.ok(ticks.some((tick) => tick.value === at("2024-01-01") && tick.text === "2024"));
  for (const tick of ticks) assert.equal(tick.coord, logicalForTime(data, tick.value, DAY) * 4);
});

test("monthly projection keeps all nine visible future months and localized year/month labels", () => {
  const data = Object.freeze([bar(at("2023-10-01")), bar(at("2023-11-01"))]);
  const options = { from: 0, to: 100, width: 1200, coordinate: (index) => index * 90 };
  const english = calendarAxisTicks(data, "1M", {
    ...options,
    display: display("1M", "America/New_York", "en")
  });
  const russian = calendarAxisTicks(data, "1M", {
    ...options,
    display: display("1M", "Asia/Kathmandu", "ru")
  });
  assert.equal(values(english).filter((time) => time > data.at(-1).timestamp).length, 9);
  assert.equal(values(english).at(-1), at("2024-08-01"));
  assert.deepEqual(values(english), values(russian));
  assert.ok(english.some((tick) => tick.text === "Jan" || tick.text === "Feb"));
  assert.ok(russian.some((tick) => /фев/.test(tick.text)));
});

test("future intraday day boundaries follow display timezone through DST", () => {
  const data = Object.freeze([bar(at("2026-03-07T05:00:00Z"))]);
  const ticks = calendarAxisTicks(data, "1h", {
    from: 1,
    to: 72,
    width: 1000,
    coordinate: (index) => index * 12,
    display: display("1h", "America/New_York")
  });
  const times = values(ticks);
  assert.ok(times.includes(at("2026-03-08T05:00:00Z")));
  assert.ok(times.includes(at("2026-03-09T04:00:00Z")));
  for (const tick of ticks)
    assert.equal(tick.coord, logicalForTime(data, tick.value, 3_600_000) * 12);
});

test("future fractional-zone minute ticks use the same timestamps as drawing projections", () => {
  for (const [timeframe, duration] of [
    ["2m", 2],
    ["10m", 10],
    ["30m", 30]
  ]) {
    const data = Object.freeze([bar(at("2026-03-03T00:00:00Z"))]);
    const ticks = calendarAxisTicks(data, timeframe, {
      from: 80,
      to: 180,
      width: 1000,
      coordinate: (index) => (index - 80) * 10,
      display: display(timeframe, "Asia/Kathmandu")
    });
    assert.ok(ticks.length >= 3, timeframe);
    assert.ok(
      ticks.some((tick) => tick.text.includes(":")),
      timeframe
    );
    for (const tick of ticks) {
      assert.equal(tick.coord, (logicalForTime(data, tick.value, duration * 60_000) - 80) * 10);
      assert.equal((tick.value - data[0].timestamp) % (duration * 60_000), 0);
    }
  }
});

test("a nine-month 1m horizon evaluates bounded visible candidates instead of every minute", (t) => {
  const data = Object.freeze([bar(at("2026-01-01"))]),
    before = snapshot(data);
  const domain = projectedCalendarDomain(data, 60_000);
  assert.ok(domain.lastIndex > 390_000);
  const baseDisplay = display("1m", "America/New_York");
  let partCalls = 0,
    coordinateCalls = 0;
  const ticks = calendarAxisTicks(data, "1m", {
    from: 1,
    to: domain.lastIndex + 500_000,
    width: 1200,
    coordinate: (index) => {
      coordinateCalls++;
      return (index * 1200) / domain.lastIndex;
    },
    display: {
      ...baseDisplay,
      parts: (time) => {
        partCalls++;
        return baseDisplay.parts(time);
      }
    }
  });
  assert.ok(ticks.length >= 8);
  assert.ok(partCalls < 4000, `calendar parts calls: ${partCalls}`);
  assert.ok(coordinateCalls < 300, `coordinate calls: ${coordinateCalls}`);
  assert.ok(values(ticks).every((time) => time <= domain.end));
  assert.equal(snapshot(data), before);
  t.diagnostic(
    `${domain.lastIndex} projected minutes: ${partCalls} parts calls, ${coordinateCalls} coordinate calls, ${ticks.length} ticks`
  );
});

test("an oversized declared range does not evaluate offscreen projected months", () => {
  const data = Object.freeze([bar(at("2026-01-01"))]);
  const baseDisplay = display("1m", "Asia/Kathmandu");
  let partCalls = 0;
  const ticks = calendarAxisTicks(data, "1m", {
    from: 1,
    to: 1_000_000,
    width: 1200,
    coordinate: (index) => index * 0.5,
    display: {
      ...baseDisplay,
      parts: (time) => {
        partCalls++;
        return baseDisplay.parts(time);
      }
    }
  });
  assert.ok(ticks.length >= 5);
  assert.ok(partCalls < 2000, `visible-only parts calls: ${partCalls}`);
  assert.ok(values(ticks).every((time) => time <= data[0].timestamp + 2400 * 60_000));
});

test("LW future grid and axis consume exactly the same tick positions", () => {
  const data = Object.freeze([bar(at("2026-01-31"))]);
  const grid = [],
    labels = [];
  const ctx = {
    save() {},
    restore() {},
    setLineDash() {},
    beginPath() {},
    stroke() {},
    lineTo() {},
    moveTo: (x) => grid.push(x),
    measureText: (text) => ({ width: text.length * 6 }),
    fillText: (text, x) => labels.push({ text, x })
  };
  const options = {
    from: 1,
    to: 200,
    width: 1200,
    height: 26,
    coordinate: (index) => 40 + index * 6,
    color: "#999",
    fontSize: 11,
    fontFamily: "Arial",
    display: display("1d")
  };
  paintCalendarGrid(ctx, data, "1d", options);
  paintCalendarAxis(ctx, data, "1d", options);
  assert.ok(labels.some((label) => label.text === "Feb"));
  assert.deepEqual(
    grid.map((x) => x - 0.5),
    labels.map((label) => label.x)
  );
});

test("KLine uses unclipped native visible indices and never moves the camera or writes candle data", () => {
  let template, installed;
  const isolated = sources({
    klinecharts: {
      registerXAxis: (value) => {
        template = value;
      }
    }
  });
  const data = Object.freeze([bar(at("2026-01-31"))]);
  const chart = {
    setPaneOptions: (options) => {
      installed = options;
    },
    getVisibleRange: () => ({ from: 0, to: 1, realFrom: 1, realTo: 200 }),
    convertToPixel: ({ dataIndex }) => ({ x: 40 + dataIndex * 6 })
  };
  const dispose = isolated("charts/kline-calendar-axis.ts").attachCalendarXAxis(
    chart,
    () => data,
    "1d",
    display("1d")
  );
  assert.equal(installed.id, "x_axis_pane");
  const result = template.createTicks({
    range: { from: 0, to: 0 },
    bounding: { width: 1200 },
    defaultTicks: []
  });
  assert.ok(result.some((tick) => tick.value === at("2026-02-01")));
  assert.ok(result.some((tick) => tick.value === at("2026-07-01")));
  assert.deepEqual(
    values(result),
    values(
      calendarAxisTicks(data, "1d", {
        from: 1,
        to: 200,
        width: 1200,
        coordinate: (index) => 40 + index * 6,
        display: display("1d")
      })
    )
  );
  dispose();
  assert.equal(template.createTicks({ bounding: { width: 1200 }, defaultTicks: [] }).length, 0);
});

test("empty, out-of-horizon and invalid visible ranges produce no future work", () => {
  const data = Object.freeze([bar(at("2026-01-01"))]);
  for (const [from, to] of [
    [1_000_000, 1_000_100],
    [Infinity, Infinity],
    [NaN, 1],
    [100, 1]
  ]) {
    let projections = 0;
    const ticks = calendarAxisTicks(data, "1m", {
      from,
      to,
      width: 1200,
      coordinate: () => {
        projections++;
        return 1;
      }
    });
    assert.equal(ticks.length, 0);
    assert.equal(projections, 0);
  }
  assert.equal(
    calendarAxisTicks([], "1d", { from: 0, to: 100, width: 1200, coordinate: () => 1 }).length,
    0
  );
});

test("future axis does not extend actual MTP, SMA or EMA data or their draw bounds", () => {
  const { MtpModel, activeMtpPeriods } = load("model/mtp.ts");
  const { movingAverage } = load("charts/adapter.ts");
  const data = Object.freeze(
    Array.from({ length: 700 }, (_, index) =>
      Object.freeze({
        timestamp: at("2024-01-01") + index * DAY,
        open: 100 + index,
        high: 103 + index,
        low: 98 + index,
        close: 102 + index,
        volume: index
      })
    )
  );
  const model = new MtpModel();
  model.reset(data, activeMtpPeriods({ mtpAll: true }));
  const before = snapshot(data),
    bounds = JSON.stringify(model.bounds);
  calendarAxisTicks(data, "1d", {
    from: 690,
    to: 1000,
    width: 1200,
    coordinate: (index) => (index - 690) * 4
  });
  assert.equal(snapshot(data), before);
  assert.equal(JSON.stringify(model.bounds), bounds);
  assert.equal(model.length, data.length);
  assert.equal(model.sma(data.length, 20), null);
  assert.equal(model.extrema(data.length, 1000), null);
  const drawn = [];
  model.draw(
    {
      save() {},
      restore() {},
      setLineDash() {},
      beginPath() {},
      stroke() {},
      moveTo() {},
      lineTo() {}
    },
    690,
    1000,
    (index) => {
      drawn.push(index);
      return index;
    },
    (value) => value
  );
  assert.ok(drawn.length > 0);
  assert.ok(drawn.every((index) => index < data.length));
  for (const exponential of [false, true]) {
    const average = movingAverage(data, 20, exponential);
    assert.equal(average.at(-1).time, data.at(-1).timestamp / 1000);
    assert.equal(average.length, data.length - 19);
  }
});

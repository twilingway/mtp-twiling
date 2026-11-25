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
    (specifier) => {
      assert.ok(specifier.startsWith("."));
      return load(path.relative(sourceRoot, path.resolve(path.dirname(filename), specifier)));
    },
    module,
    module.exports
  );
  return module.exports;
}
const { displayPreferences, isTimeZone, setDisplayPreferences } = load("i18n/preferences.ts");
const { resolveTimeZone, supportedTimeZones, timeZoneOffset, timeZoneLabel, searchTimeZones } =
  load("i18n/timezones.ts");
const { formatNumber, formatClock, formatChartDate } = load("i18n/format.ts");
const { lightweightDateFormatters, klineDateFormatter } = load("i18n/chart-formatters.ts");
const { dateTimeInput, parseDateTimeInput } = load("i18n/datetime-input.ts");
const { validateBackup } = load("model/backup-format.ts");
const { defaultPreferences, viewKey } = load("screens/terminal/controller-bridge.ts");
const { formatCountdown } = load("model/candle-clock.ts");
const { english, russian, message, t, systemText } = load("i18n/messages.ts");
const { formatOhlcValue } = load("model/ohlc-legend.ts");
const { calendarAxisDisplay } = load("i18n/calendar-axis.ts");
const winter = Date.parse("2026-01-15T12:00:00Z"),
  summer = Date.parse("2026-07-15T12:00:00Z");

test("IANA offsets use the given instant including DST and fractional hours", () => {
  assert.equal(timeZoneOffset("Europe/Moscow", winter), "UTC+03:00");
  assert.equal(timeZoneOffset("Europe/Moscow", summer), "UTC+03:00");
  assert.equal(timeZoneOffset("America/New_York", winter), "UTC-05:00");
  assert.equal(timeZoneOffset("America/New_York", summer), "UTC-04:00");
  assert.equal(timeZoneOffset("Asia/Kolkata", winter), "UTC+05:30");
  assert.equal(timeZoneOffset("Asia/Kathmandu", winter), "UTC+05:45");
  assert.equal(timeZoneOffset("America/St_Johns", winter), "UTC-03:30");
  assert.equal(timeZoneOffset("Pacific/Chatham", winter), "UTC+13:45");
  assert.equal(timeZoneOffset("UTC", winter), "UTC");
});
test("New York switches exactly at the DST boundary", () => {
  assert.equal(
    formatClock(Date.parse("2026-03-08T06:59:00Z"), { locale: "en", timeZone: "America/New_York" }),
    "01:59:00"
  );
  assert.equal(
    formatClock(Date.parse("2026-03-08T07:00:00Z"), { locale: "en", timeZone: "America/New_York" }),
    "03:00:00"
  );
});
test("device and exchange choices resolve safely, invalid preferences fall back", () => {
  assert.equal(resolveTimeZone("local"), Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(resolveTimeZone("exchange"), "Europe/Moscow");
  assert.equal(resolveTimeZone("not-a-zone"), "Europe/Moscow");
  assert.equal(isTimeZone("not-a-zone"), false);
  assert.deepEqual(displayPreferences({ locale: "xx", timeZone: "invalid" }), {
    locale: "ru",
    timeZone: "Europe/Moscow"
  });
  assert.equal(formatClock(winter, { locale: "en", timeZone: "UTC" }), "12:00:00");
  assert.equal(formatClock(winter, { locale: "ru", timeZone: "Europe/Moscow" }), "15:00:00");
});
test("the chooser includes the complete Intl IANA list and searchable honest city names", () => {
  const zones = supportedTimeZones();
  assert.deepEqual(zones.slice(0, 4), ["Europe/Moscow", "UTC", "local", "exchange"]);
  assert.ok(zones.length > 300);
  assert.equal(zones.length, new Set(zones).size);
  assert.ok(Intl.supportedValuesOf("timeZone").every((zone) => zones.includes(zone)));
  assert.ok(searchTimeZones("москва", "ru").includes("Europe/Moscow"));
  assert.ok(searchTimeZones("New_York", "ru").includes("America/New_York"));
  assert.equal(timeZoneLabel("Africa/Abidjan", "ru"), "Abidjan");
});
test("RU and EN format numbers and dates, with stable missing values", () => {
  assert.equal(formatNumber(1234.5, 2, false, { locale: "en" }), "1,234.50");
  assert.equal(formatNumber(1234.5, 2, false, { locale: "ru" }).replace(/\s/g, " "), "1 234,50");
  assert.equal(formatNumber(NaN), "—");
  assert.match(formatChartDate(winter, "1d", { locale: "ru", timeZone: "UTC" }), /янв/);
  assert.match(formatChartDate(winter, "1d", { locale: "en", timeZone: "UTC" }), /Jan/);
  setDisplayPreferences({ locale: "en", timeZone: "UTC" });
  assert.equal(formatOhlcValue(1234.5, 2), "1,234.50");
  setDisplayPreferences({ locale: "ru" });
});
test("both native adapters preserve DWM trading dates and convert intraday display only", () => {
  const candle = Object.freeze({ timestamp: Date.parse("2026-03-05T00:00:00Z"), close: 100 });
  const options = { locale: "en", timeZone: "America/New_York" };
  for (const timeframe of ["1d", "1w", "1M"]) {
    const lw = lightweightDateFormatters(timeframe, options);
    const kl = klineDateFormatter(timeframe, options);
    assert.match(lw.timeFormatter(candle.timestamp / 1000), /Mar 05/);
    assert.match(kl(new Intl.DateTimeFormat(), candle.timestamp, "YYYY-MM-DD", 1), /Mar 05/);
    assert.equal(lw.tickMarkFormatter(candle.timestamp / 1000, 2), "05");
  }
  const intraday = lightweightDateFormatters("5m", options);
  assert.match(intraday.timeFormatter(candle.timestamp / 1000), /Mar 04.*19:00/);
  assert.equal(intraday.tickMarkFormatter(candle.timestamp / 1000, 3), "19:00");
  assert.match(
    klineDateFormatter("5m", options)(new Intl.DateTimeFormat(), candle.timestamp, "HH:mm", 1),
    /19:00/
  );
  assert.equal(candle.timestamp, Date.parse("2026-03-05T00:00:00Z"));
});
test("zoned coordinate editing roundtrips UTC, rejects DST gaps and preserves fold occurrence", () => {
  const instant = Date.parse("2026-07-15T12:00:00Z");
  assert.equal(dateTimeInput(instant, "Asia/Kathmandu"), "2026-07-15T17:45");
  assert.equal(parseDateTimeInput("2026-07-15T17:45", "Asia/Kathmandu"), instant);
  assert.ok(Number.isNaN(parseDateTimeInput("2026-03-08T02:30", "America/New_York")));
  const fold = Date.parse("2026-11-01T06:30:00Z");
  assert.equal(parseDateTimeInput("2026-11-01T01:30", "America/New_York", fold), fold);
  assert.equal(
    parseDateTimeInput("2026-11-01T01:30", "America/New_York"),
    Date.parse("2026-11-01T05:30:00Z")
  );
});
test("profile backup roundtrip retains language and timezone without changing view identity or UTC points", () => {
  const before = defaultPreferences(),
    after = { ...before, locale: "en", timeZone: "Pacific/Chatham" };
  assert.equal(viewKey(before), viewKey(after));
  const backup = {
    application: "personal-terminal",
    schemaVersion: 1,
    layout: after,
    images: [],
    drawings: [
      {
        symbol: "GAZP",
        items: [{ name: "horizontalStraightLine", points: [{ timestamp: winter, value: 100 }] }]
      }
    ]
  };
  const restored = validateBackup(JSON.parse(JSON.stringify(backup)));
  assert.deepEqual(restored, backup);
  assert.equal(restored.drawings[0].items[0].points[0].timestamp, winter);
  assert.throws(() => validateBackup({ ...backup, layout: { locale: "de" } }));
  assert.throws(() => validateBackup({ ...backup, layout: { timeZone: "bad-zone" } }));
  assert.equal(validateBackup({ ...backup, layout: {} }).layout.locale, undefined);
});
test("dictionaries have matching coverage and translate system messages while keeping user text", () => {
  assert.ok(Object.keys(english).length > 500);
  assert.deepEqual(Object.keys(english), Object.keys(russian));
  assert.equal(message("Настройки графика", "en"), "Chart settings");
  assert.equal(t("  Удалить ", "en"), "  Delete ");
  assert.equal(t("Мой личный рисунок", "en"), "Мой личный рисунок");
  assert.equal(t("Газпром", "en"), "Газпром");
  assert.equal(
    systemText("Импортировано: 5 рисунков, 2 изображений.", "en"),
    "Imported: 5 drawings, 2 images."
  );
  assert.equal(
    systemText("Неизвестный пользовательский ответ", "en"),
    "Неизвестный пользовательский ответ"
  );
});
test("timezone selection does not alter an absolute countdown duration", () => {
  const duration = 3 * 3600000 + 62000;
  const before = formatCountdown(duration);
  setDisplayPreferences({ locale: "en", timeZone: "America/New_York" });
  assert.equal(formatCountdown(duration), before);
  setDisplayPreferences({ locale: "ru", timeZone: "Europe/Moscow" });
});
test("calendar integration callbacks compare local intraday boundaries and UTC trading dates", () => {
  const timestamp = Date.parse("2026-03-04T22:00:00Z");
  const intraday = calendarAxisDisplay("1h", { locale: "ru", timeZone: "Europe/Moscow" });
  assert.equal(intraday.parts(timestamp).day, 5);
  assert.equal(intraday.clock(timestamp), "01:00");
  const daily = calendarAxisDisplay("1d", { locale: "en", timeZone: "America/New_York" });
  assert.equal(daily.parts(timestamp).day, 4);
  assert.equal(daily.day(timestamp), "Mar 4");
  const ny = calendarAxisDisplay("1h", { locale: "en", timeZone: "America/New_York" });
  assert.equal(ny.parts(Date.parse("2026-03-08T06:59:00Z")).hour, 1);
  assert.equal(ny.parts(Date.parse("2026-03-08T07:00:00Z")).hour, 3);
});

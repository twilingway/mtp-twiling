import test from "node:test";
import assert from "node:assert/strict";
import { sourceModules } from "./helpers/watchlist-sections.mjs";
import { backup, root, sourceLoader } from "./drive-reader-guard-helpers.mjs";
import { nativeFixture } from "./native-technical-fixture.mjs";

const load = sourceModules();
const { barColors, updateBarColor, DEFAULT_BAR_COLORS } = load("model/bar-palette.ts");
const { chartBackground, chartContrast, withTheme } = load("model/theme.ts");
const { chartRenderConfigKey, chartRenderConfigFromKey } = load("charts/render-config.ts");
const palettes = {
  light: { upColor: "#123456", downColor: "#654321" },
  dark: { upColor: "#abcdef", downColor: "#fedcba" }
};

test("OHLC bars ignore candle colors and use contrasting defaults on either theme and custom backgrounds", () => {
  for (const theme of ["dark", "light"]) {
    assert.deepEqual(
      barColors({ theme, upColor: "#ffffff", downColor: "#ffffff" }),
      DEFAULT_BAR_COLORS[theme]
    );
    for (const background of [
      "#000000",
      "#ffffff",
      "#808080",
      "#999999",
      "#345678",
      "#eb4d5c",
      "#00875a"
    ]) {
      const settings = { theme, background, bodyVisible: false, upColor: "#ffffff" };
      const colors = barColors(settings);
      assert.notEqual(colors.upColor, colors.downColor);
      for (const color of Object.values(colors)) {
        assert.ok(
          chartContrast(color, chartBackground(settings)) >= 3,
          `${color} on ${background}`
        );
      }
    }
  }
});

test("each direction and theme keeps literal custom colors and independent Auto reset", () => {
  const settings = Object.freeze({ theme: "light", upColor: "#ffffff", barColors: palettes });
  assert.deepEqual(barColors(settings), palettes.light);
  assert.deepEqual(barColors(withTheme(settings, "dark")), palettes.dark);
  const edited = updateBarColor(settings, "dark", "upColor", "#111111");
  assert.deepEqual(edited.barColors.light, palettes.light);
  assert.equal(edited.barColors.dark.downColor, palettes.dark.downColor);
  assert.equal(settings.barColors.dark.upColor, "#abcdef");
  const reset = updateBarColor(edited, "dark", "upColor", undefined);
  assert.deepEqual(reset.barColors.dark, { downColor: "#fedcba" });
  const empty = updateBarColor(
    { barColors: { dark: { upColor: "#123456" } } },
    "dark",
    "upColor",
    undefined
  );
  assert.equal(Object.hasOwn(empty, "barColors"), false);
  assert.deepEqual(barColors({ theme: "light", barColors: { light: { upColor: "#ffffff" } } }), {
    upColor: "#ffffff",
    downColor: DEFAULT_BAR_COLORS.light.downColor
  });
});

test("adapter render config retains effective active bar colors and ignores inactive and candle-only palettes", () => {
  const flags = {
    ma: false,
    ema: false,
    volume: false,
    mtp160: false,
    mtp440: false,
    mtp640: false
  };
  const settings = { chartType: "bars", theme: "light", upColor: "#ffffff", barColors: palettes };
  const key = chartRenderConfigKey(settings, flags);
  assert.deepEqual(barColors(chartRenderConfigFromKey(key).settings), palettes.light);
  assert.notEqual(
    key,
    chartRenderConfigKey(updateBarColor(settings, "light", "upColor", "#111111"), flags)
  );
  assert.equal(
    key,
    chartRenderConfigKey(updateBarColor(settings, "dark", "upColor", "#111111"), flags)
  );
  const candles = { chartType: "candles", theme: "light" };
  assert.equal(
    chartRenderConfigKey(candles, flags),
    chartRenderConfigKey({ ...candles, barColors: palettes }, flags)
  );
});

for (const engine of ["lightweight", "kline"]) {
  test(`${engine} native bars use the active independent palette despite hidden white candle bodies`, () => {
    for (const theme of ["light", "dark"]) {
      const settings = {
        chartType: "bars",
        theme,
        upColor: "#ffffff",
        downColor: "#ffffff",
        bodyVisible: false,
        barColors: palettes
      };
      const fixture = nativeFixture(engine, [], { settings });
      const actual =
        engine === "lightweight"
          ? fixture.activeSeries()[0].options()
          : fixture.native.initialStyles.candle.bar;
      assert.equal(actual.upColor, palettes[theme].upColor);
      assert.equal(actual.downColor, palettes[theme].downColor);
      if (engine === "kline") assert.equal(actual.noChangeColor, palettes[theme].upColor);
      fixture.adapter.destroy();
    }
  });
  test(`${engine} native candles retain their saved palette when separate bar colors exist`, () => {
    const settings = {
      chartType: "candles",
      theme: "light",
      upColor: "#ffffff",
      downColor: "#333333",
      barColors: palettes
    };
    const fixture = nativeFixture(engine, [], { settings });
    const actual =
      engine === "lightweight"
        ? fixture.activeSeries()[0].options()
        : fixture.native.initialStyles.candle.bar;
    assert.equal(actual.upColor, settings.upColor);
    assert.equal(actual.downColor, settings.downColor);
    fixture.adapter.destroy();
  });
}

test("bar colors round-trip JSON and Drive and older projections refuse to discard them", async () => {
  const source = sourceLoader(root);
  const { validateBackup } = source("model/backup-format.ts");
  const { sanitizeDriveBackup, prepareDriveBackup, restoreDriveBackup } = source(
    "services/drive/backup.ts"
  );
  const { assertReadableDrivePayload } = source("services/drive/reader-guard.ts");
  const input = backup();
  input.layout.chartSettings.barColors = palettes;
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(input))), input);
  assert.deepEqual(assertReadableDrivePayload(input), input);
  const { payload } = await prepareDriveBackup(input);
  assert.deepEqual(await restoreDriveBackup(payload, []), input);
  const older = sourceLoader(root, {
    "services/drive/backup.ts": {
      sanitizeDriveBackup(value) {
        const copy = sanitizeDriveBackup(value);
        delete copy.layout.chartSettings.barColors;
        return copy;
      }
    }
  });
  assert.throws(
    () => older("services/drive/reader-guard.ts").assertReadableDrivePayload(input),
    (error) => error.code === "unsupported-format"
  );
  assert.deepEqual(input.layout.chartSettings.barColors, palettes);
});

test("invalid nested palette fields and executable accessors fail before Drive projection", () => {
  const source = sourceLoader(root);
  const { validateBackup } = source("model/backup-format.ts");
  const { sanitizeDriveBackup } = source("services/drive/backup.ts");
  const input = backup();
  for (const value of [
    [],
    null,
    { blue: {} },
    { dark: { upColor: "white" } },
    { light: { opacity: 1 } },
    { dark: { upColor: null } },
    { light: { downColor: "#fff" } }
  ]) {
    input.layout.chartSettings.barColors = value;
    assert.throws(() => validateBackup(input));
    assert.throws(
      () => sanitizeDriveBackup(input),
      (error) => error.code === "remote-invalid"
    );
  }
  let reads = 0;
  const colors = {};
  Object.defineProperty(colors, "upColor", {
    get() {
      reads++;
      return "#123456";
    }
  });
  input.layout.chartSettings.barColors = { dark: colors };
  assert.throws(() => validateBackup(input));
  assert.throws(
    () => sanitizeDriveBackup(input),
    (error) => error.code === "remote-invalid"
  );
  const settings = { ...input.layout.chartSettings };
  Object.defineProperty(settings, "barColors", {
    get() {
      reads++;
      return palettes;
    }
  });
  input.layout.chartSettings = settings;
  assert.throws(
    () => sanitizeDriveBackup(input),
    (error) => error.code === "remote-invalid"
  );
  assert.equal(reads, 0);
});

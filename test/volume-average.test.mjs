import assert from "node:assert/strict";
import test from "node:test";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const load = createSourceLoader({
  "lightweight-charts": { HistogramSeries: "histogram", LineSeries: "line" },
  klinecharts: { LineType: { Solid: "solid" } }
});
const { volumeSma, volumeAverageSettings, volumeAverageWarmup } = load("model/volume-average.js");
const { lightweightLegacy } = load("charts/lightweight-legacy.js");
const { initializeKlineIndicators } = load("charts/kline-indicators.js");
const bars = (values) =>
  values.map((volume, index) => ({
    volume,
    timestamp: (index + 1) * 60_000,
    open: 11,
    close: 11
  }));
const chartSettings = { volumeAverage: { enabled: true, period: 3 } };
const visible = { indicators: { volume: true }, settings: chartSettings };

test("volume SMA uses current candle, actual zeros and only complete contiguous windows", () => {
  const volumes = Array.from({ length: 21 }, (_, index) => index + 1);
  assert.deepEqual(volumeSma(bars(volumes), 20), [...Array(19).fill(null), 10.5, 11.5]);
  assert.deepEqual(volumeSma(bars([3, 0, 3, undefined, 6, 9, 12, -1]), 3), [
    null,
    null,
    2,
    null,
    null,
    null,
    9,
    null
  ]);
  assert.deepEqual(volumeSma(bars([0, 2]), 1), [0, 2]);
  assert.deepEqual(volumeAverageSettings({}), { enabled: false, period: 20 });
  assert.equal(volumeAverageWarmup(chartSettings, true), 3);
  assert.equal(volumeAverageWarmup(chartSettings, false), 0);
});

test("Lightweight overlays one volume line and updates a correction and the current candle", () => {
  const written = [];
  const chart = {
    addSeries(type, options) {
      const track = { type, options };
      written.push(track);
      return {
        priceScale: () => ({ applyOptions() {} }),
        setData: (value) => (track.data = value),
        update: (value) => (track.last = value)
      };
    }
  };
  const adapter = lightweightLegacy(chart, visible);
  const [histogram, line] = written;
  assert.equal(histogram.options.priceScaleId, line.options.priceScaleId);
  assert.equal(line.type, "line");
  adapter.setData(bars([0, 3, 9]));
  assert.deepEqual(line.data, [{ time: 60 }, { time: 120 }, { time: 180, value: 4 }]);
  const current = bars([0, 3, 15]);
  adapter.update(current, current.at(-1), false);
  assert.deepEqual(line.last, { time: 180, value: 6 });
  const corrected = bars([6, 3, 15]);
  adapter.update(corrected, corrected[0], true);
  assert.deepEqual(line.data.at(-1), { time: 180, value: 8 });
});

test("KLine draws the same average in its native VOL pane, with no default MA trio", () => {
  const created = [];
  const chart = {
    createIndicator: (indicator, stack, pane) => created.push({ indicator, stack, pane })
  };
  initializeKlineIndicators(chart, visible, 95);
  const [{ indicator, pane }] = created;
  assert.equal(indicator.name, "VOL");
  assert.equal(pane.id, "volume_pane");
  assert.deepEqual(indicator.calcParams, [3]);
  assert.deepEqual(indicator.calc(bars([3, 0, 6, 12])), [
    { volume: 3, ma1: undefined },
    { volume: 0, ma1: undefined },
    { volume: 6, ma1: 3 },
    { volume: 12, ma1: 6 }
  ]);
  created.length = 0;
  initializeKlineIndicators(chart, { ...visible, settings: {} }, 95);
  assert.deepEqual(created[0].indicator.calcParams, []);
});

test("JSON and Google Drive retain a valid volume period and reject malformed options", async () => {
  const { isChartSettings, validateBackup } = load("model/backup-format.js");
  const { prepareDriveBackup, restoreDriveBackup } = load("services/drive/backup.js");
  const backup = {
    application: "personal-terminal",
    schemaVersion: 1,
    layout: { chartSettings },
    drawings: [],
    images: []
  };
  assert.deepEqual(validateBackup(backup).layout.chartSettings, chartSettings);
  const prepared = await prepareDriveBackup(backup);
  const restored = await restoreDriveBackup(prepared.payload, []);
  assert.deepEqual(restored.layout.chartSettings, chartSettings);
  for (const period of [0, 3.5, 10001, "20", NaN]) {
    assert.equal(isChartSettings({ volumeAverage: { enabled: true, period } }), false);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { nativeFixture } from "./native-technical-fixture.mjs";

for (const engine of ["lightweight", "kline"]) {
  test(`${engine}: 100 separate hidden panes remain addressable and saved overrides retain all changed panes`, () => {
    const f = nativeFixture(engine);
    const { createTechnicalIndicatorInstance: create } = f.load(
      "model/technical-indicators/instances.ts"
    );
    const { technicalMinimumCanvasHeight, capturedTechnicalLayout } = f.load(
      "charts/technical-pane-geometry.ts"
    );
    f.container.clientHeight = technicalMinimumCanvasHeight(100);
    f.resize();
    const instances = Array.from({ length: 100 }, (_, i) =>
      create("rsi", `pane-${i}`, { order: i, visible: false })
    );
    f.adapter.updateTechnicalIndicators(instances, []);
    f.ready();
    const metrics = f.adapter.technicalPaneMetrics();
    assert.equal(metrics.length, 101);
    assert.ok(metrics[0].height >= 159.999);
    assert.ok(metrics.slice(1).every((item) => item.height >= 29.999));
    assert.equal(f.adapter.timeAxisTop(), f.container.clientHeight - 28);
    const old = metrics.map((item) => ({ ...item, height: item.height + 2 }));
    assert.equal(capturedTechnicalLayout([], old, metrics).length, 100);
    assert.equal(f.changes.length, 0);
    f.adapter.destroy();
  });

  test(`${engine}: histogram opacity and decorative reference levels create no extra data`, () => {
    const f = nativeFixture(engine);
    const { createTechnicalIndicatorInstance: create } = f.load(
      "model/technical-indicators/instances.ts"
    );
    const bars = Array.from({ length: 60 }, (_, i) => ({
      timestamp: Date.UTC(2025, 0, i + 1),
      open: 101 + i,
      high: 103 + i,
      low: 99 + i,
      close: 102 + i,
      volume: 4
    }));
    const instances = [
      create("macd", "macd", {
        styles: {
          histogram: {
            color: "#abcdef",
            width: 1,
            visible: true,
            opacity: 0.25,
            lineStyle: "dotted"
          }
        }
      }),
      create("rsi", "rsi"),
      create("rsi", "rsi-two", { pane: { kind: "pane", id: "rsi" } })
    ];
    f.adapter.setData(bars);
    f.adapter.updateTechnicalIndicators(instances, []);
    f.ready();
    if (engine === "lightweight") {
      const output = f.activeSeries().slice(4),
        histogram = output.find((series) => series.type === "Histogram");
      assert.equal(histogram.options.color, "rgba(171,205,239,0.25)");
      assert.equal(histogram.options.lineStyle, undefined);
      assert.equal(
        output.reduce((sum, series) => sum + series.labels.length, 0),
        4
      );
      assert.ok(output.every((series) => series.data.length === bars.length));
      assert.equal(f.panes.length, 3);
    } else {
      const output = f.activeIndicators().filter((item) => item.name.startsWith("PERSONAL_TA_"));
      assert.equal(output[0].styles.bars[0].upColor, "rgba(171,205,239,0.25)");
      assert.equal(
        output.reduce((sum, item) => sum + item.extendData.context.levels.length, 0),
        4
      );
      assert.ok(output.every((item) => item.result.length === bars.length));
      assert.equal(f.panes.length, 3);
    }
    const point = f.adapter.pointToPixel({ timestamp: bars[30].timestamp, value: 100 });
    assert.ok(point.y >= 0 && point.y <= f.adapter.plotSize().height);
    f.adapter.destroy();
  });
}

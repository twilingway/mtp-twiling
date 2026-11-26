import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";
import { nativeFixture } from "./native-technical-fixture.mjs";

const load = sourceLoader();
const { externalStudies } = load("model/technical-indicators/catalog-expansion/external.js");
const { compilePresentation, presentationColor } = load(
  "model/technical-indicators/presentation.js"
);
const { technicalRatingCategory } = load("model/technical-indicators/ta-batch-external-ratings.js");
const [ratio, ratings, interest] = externalStudies;

function ratingBars(count) {
  return Array.from({ length: count }, (_, index) => {
    const close = 90 + index / 5 + 8 * Math.sin(index / 3) + 2 * Math.cos(index / 13);
    return {
      timestamp: 1_700_000_000_000 + index * 60_000,
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close,
      volume: 25 + (index % 11)
    };
  });
}

test("The candle advance/decline ratio uses a full, editable window and separates missing data from zero", () => {
  assert.equal(ratio.catalogId, "STD;Advance_Decline_Ratio_Bars");
  assert.equal(ratio.definition.parameters[0].defaultValue, 9);
  assert.equal(ratio.history({ length: 3 }).historyRequirement.lookbackBars, 3);
  const bars = [2, 1, -1, 0, -1, -1, -2, null].map((close, timestamp) => ({
    timestamp,
    open: 0,
    high: null,
    low: null,
    close,
    volume: null
  }));
  assert.deepEqual(ratio.calculate(bars, { length: 3 }).value, [null, null, 2, 1, 0, 0, 0, null]);
});

test("Technical Ratings combines independent groups on the chart interval with no future candles", () => {
  const bars = ratingBars(320);
  const groups = ["overall", "averages", "oscillators"];
  const [overall, averages, oscillators] = groups.map(
    (group) => ratings.calculate(bars, { group }).value
  );
  assert.equal(ratings.catalogId, "STD;Technical%1Ratings");
  assert.equal(ratings.history({ group: "overall" }).warmupBars, 200);
  assert.equal(ratings.history({ group: "oscillators" }).warmupBars, 36);
  assert.equal(
    averages.findIndex((value) => value !== null),
    199
  );
  assert.equal(
    oscillators.findIndex((value) => value !== null),
    35
  );
  assert.equal(
    overall.findIndex((value) => value !== null),
    199
  );
  assert.ok(overall.some((value) => value > 0.1));
  assert.ok(overall.some((value) => value < -0.1));
  for (const [index, score] of overall.entries()) {
    const expected =
      averages[index] === null || oscillators[index] === null
        ? null
        : (averages[index] + oscillators[index]) / 2;
    assert.equal(score, expected);
    assert.ok(score === null || Math.abs(score) <= 1);
  }
  assert.deepEqual(
    ratings.calculate(bars.slice(0, 270), { group: "overall" }).value,
    overall.slice(0, 270)
  );
});

test("Missing volume removes average and overall ratings while oscillators stay usable", () => {
  const bars = ratingBars(225).map((bar) => ({ ...bar, volume: null }));
  for (const group of ["overall", "averages"]) {
    assert.ok(ratings.calculate(bars, { group }).value.every((value) => value === null));
  }
  assert.ok(
    ratings.calculate(bars, { group: "oscillators" }).value.some((value) => value !== null)
  );
});

test("Ratings columns preserve the category colors in the shared renderer contract", () => {
  const bars = ratingBars(320);
  const series = ratings.calculate(bars, { group: "averages" });
  const presentation = compilePresentation(ratings.definition.presentation, {
    timestamps: bars.map((bar) => bar.timestamp),
    series,
    visible: true,
    collapsed: false
  });
  const [plot] = presentation.plots;
  const colors = {
    "strong-sell": "#d8394e",
    sell: "#b85b67",
    neutral: "#7c8694",
    buy: "#4a9e82",
    "strong-buy": "#00875d"
  };
  assert.equal(plot.geometry.kind, "columns");
  assert.equal(presentationColor(plot, 0), null);
  for (const [index, score] of series.value.entries()) {
    if (score !== null)
      assert.equal(presentationColor(plot, index), colors[technicalRatingCategory(score)]);
  }
});

for (const mode of ["lightweight", "kline"]) {
  test(`${mode} presents calculated external-study series through the catalog`, () => {
    const fixture = nativeFixture(mode);
    try {
      const { technicalDefinitionForCatalog } = fixture.load(
        "model/technical-indicators/catalog.ts"
      );
      const { createTechnicalIndicatorInstance } = fixture.load(
        "model/technical-indicators/instances.ts"
      );
      const bars = ratingBars(220).map((bar, index) => ({
        ...bar,
        open: bar.close + (index % 4 === 0 ? 1 : -1)
      }));
      const ratioInstance = createTechnicalIndicatorInstance(
        technicalDefinitionForCatalog(ratio.catalogId),
        "ratio"
      );
      const ratingInstance = createTechnicalIndicatorInstance(
        technicalDefinitionForCatalog(ratings.catalogId),
        "ratings"
      );
      fixture.adapter.setData(bars);
      fixture.adapter.updateTechnicalIndicators([ratioInstance, ratingInstance], []);
      fixture.ready();
      const expectedRatio = ratio.calculate(bars, { length: 9 }).value;
      const expectedRating = ratings.calculate(bars, { group: "overall" }).value;
      const read = (item) =>
        (mode === "lightweight" ? item.data : item.result).map(({ value }) => value ?? null);
      const data = mode === "lightweight" ? fixture.activeSeries() : fixture.activeIndicators();
      for (const expected of [expectedRatio, expectedRating]) {
        assert.ok(
          data.some(
            (item) =>
              (mode === "lightweight" ? item.data : item.result)?.length === bars.length &&
              read(item).every((value, index) => value === expected[index])
          ),
          "rendered study values must match the selected catalog calculation"
        );
      }
    } finally {
      fixture.adapter.destroy();
    }
  });

  test(`${mode} updates open interest from its active instrument without replacing candles or camera`, () => {
    const fixture = nativeFixture(mode);
    try {
      const { technicalDefinitionForCatalog } = fixture.load(
        "model/technical-indicators/catalog.ts"
      );
      const { createTechnicalIndicatorInstance } = fixture.load(
        "model/technical-indicators/instances.ts"
      );
      const bars = ratingBars(5);
      const instance = createTechnicalIndicatorInstance(
        technicalDefinitionForCatalog(interest.catalogId),
        "interest"
      );
      fixture.adapter.setData(bars);
      fixture.adapter.updateTechnicalIndicators([instance], []);
      fixture.ready();
      const view = fixture.camera();
      const writes = fixture.primaryWrites();
      const observation = {
        unit: { kind: "base", currency: "BTC" },
        rows: [
          { timestamp: bars[2].timestamp, value: 0 },
          { timestamp: bars[4].timestamp, value: 3 }
        ]
      };
      const output = () => {
        const item =
          mode === "lightweight"
            ? fixture.activeSeries().at(-1).data
            : fixture.activeIndicators().find((entry) => entry.name.startsWith("PERSONAL_TA_"))
                .result;
        return item.map(({ value }) => value ?? null);
      };
      assert.deepEqual(output(), [null, null, null, null, null]);
      fixture.adapter.updateTechnicalInputs({
        openInterest: { ...observation, instrumentKey: "wrong" }
      });
      fixture.ready();
      assert.deepEqual(output(), [null, null, null, null, null]);
      fixture.adapter.updateTechnicalInputs({
        openInterest: { ...observation, instrumentKey: fixture.options.row.uid }
      });
      fixture.ready();
      assert.deepEqual(output(), [null, null, 0, null, 3]);
      fixture.adapter.updateTechnicalInputs({});
      fixture.ready();
      assert.deepEqual(output(), [null, null, null, null, null]);
      assert.deepEqual(fixture.camera(), view);
      assert.equal(fixture.primaryWrites(), writes);
    } finally {
      fixture.adapter.destroy();
    }
  });
}

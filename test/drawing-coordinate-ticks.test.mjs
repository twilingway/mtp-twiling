import assert from "node:assert/strict";
import test from "node:test";
import { row, sourceModules } from "./helpers/watchlist-sections.mjs";

const { nativePriceStep, priceStepDecimals, roundPriceToStep } =
  sourceModules()("charts/price-format.ts");

test("drawing prices use exchange ticks, including decimal and scientific tick sizes", () => {
  assert.equal(nativePriceStep({ step: 1, nativePriceStep: 0.1 }), 1);
  assert.equal(nativePriceStep({ step: null, nativePriceStep: 0.05 }), 0.05);
  assert.equal(nativePriceStep({ step: 0, nativePriceStep: Infinity }), null);

  for (const [step, decimals, value, expected] of [
    [1, 0, 12.061512979, 12],
    [5, 0, 12.74, 15],
    [0.05, 2, 12.08, 12.1],
    [0.05, 2, 12.075, 12.1],
    [0.05, 2, -12.075, -12.1],
    [0.0001, 4, 0.012349, 0.0123],
    [2.5e-8, 9, 5.1e-8, 5e-8]
  ]) {
    assert.equal(priceStepDecimals(step), decimals);
    assert.equal(roundPriceToStep(value, step), expected);
  }
  assert.equal(roundPriceToStep(12.061512979, null), 12.061512979);
  assert.ok(Number.isNaN(roundPriceToStep(NaN, 1)));
});

function priceField(step) {
  const points = [{ value: 12.061512979, timestamp: 1_780_000_000_000 }];
  const state = {
    preferences: { symbol: "TEST", instrumentUid: "selected", timeframe: "1d" },
    rows: [
      { ...row("TEST", "other-exchange"), step: 0.0001 },
      { ...row("TEST", "selected"), step }
    ],
    candles: []
  };
  const changes = [];
  let draft;
  const jsx = (type, props) => ({ type, props });
  const load = sourceModules({
    react: {
      useState(value) {
        if (draft === undefined) draft = value;
        return [draft, (next) => (draft = next)];
      }
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "screens/terminal/context.tsx": { useTerminal: () => ({ state }) }
  });
  const { DrawingCoordinatesFields } = load(
    "screens/terminal/drawings/DrawingCoordinatesFields.tsx"
  );
  const point = (index, patch) => {
    points[index] = { ...points[index], ...patch };
    changes.push(patch);
  };
  const render = () => {
    const field = DrawingCoordinatesFields({ points, point, setError() {} }).props.children[0].props
      .children[1];
    return field.type(field.props).props;
  };
  return { points, changes, render };
}

test("opening and blurring a price with an integer tick preserves the stored drawing coordinate", () => {
  const fixture = priceField(1);
  assert.equal(fixture.render().step, 1);
  assert.equal(fixture.render().value, "12");
  fixture.render().onBlur();
  assert.equal(fixture.render().value, "12");
  assert.deepEqual(fixture.changes, []);
  assert.equal(fixture.points[0].value, 12.061512979);
});

test("active typing previews a valid tick and displays the tick value after blur", () => {
  const fixture = priceField(0.05);
  assert.equal(fixture.render().step, 0.05);
  assert.equal(fixture.render().value, "12.05");
  fixture.render().onChange({ currentTarget: { value: "12.08" } });
  assert.equal(fixture.render().value, "12.08");
  assert.equal(fixture.points[0].value, 12.1);
  fixture.render().onBlur();
  assert.equal(fixture.render().value, "12.10");
});

test("unknown step accepts the entered precision", () => {
  const fixture = priceField(null);
  assert.equal(fixture.render().step, "any");
  assert.equal(fixture.render().value, "12.061512979");
  fixture.render().onChange({ currentTarget: { value: "12.123456" } });
  fixture.render().onBlur();
  assert.equal(fixture.render().value, "12.123456");
  assert.equal(fixture.points[0].value, 12.123456);
});

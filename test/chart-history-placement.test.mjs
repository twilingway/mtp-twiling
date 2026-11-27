import assert from "node:assert/strict";
import test from "node:test";
import { find } from "./controller-preference-routing-fixture.mjs";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const jsx = (type, props) => ({ type, props });
const noop = () => null;

function panelFixture() {
  let metrics = [{ key: "price", top: 0, width: 96, height: 200 }];
  const controller = {};
  const state = {
    owner: "history-panel",
    authenticated: true,
    rows: [],
    candles: [],
    preferences: {
      symbol: "SBER",
      timeframe: "1d",
      rangeDays: 3650,
      chartSettings: { ohlcDisplay: "corner" }
    }
  };
  const Range = () => null;
  const overrides = {
    react: {
      memo: (component) => component,
      useMemo: (factory) => factory(),
      useState: (initial) => [initial, () => {}]
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "screens/terminal/context.js": { useTerminal: () => ({ controller, state }) },
    "screens/terminal/intervals/ChartRangeControl.js": { ChartRangeControl: Range },
    "screens/terminal/use-technical-pane-metrics.js": { useTechnicalPaneMetrics: () => metrics },
    "screens/terminal/use-open-interest.js": { useOpenInterest: () => ({}) },
    "screens/terminal/use-quote-turnover.js": { useQuoteTurnover: () => ({}) },
    "screens/terminal/use-extra-study-data.js": {
      useExtraStudyData: () => ({ data: {}, calendar: {} })
    },
    "screens/terminal/SupplementalStudyStatus.js": {
      SupplementalStudyStatusContext: { Provider: Symbol("provider") }
    },
    "screens/terminal/ChartSurface.js": { ChartCanvas: noop, ChartGestures: noop },
    "screens/terminal/Watchlist.js": { InstrumentIcon: noop },
    "screens/terminal/OhlcLegend.js": { OhlcLegend: noop, OhlcLegendIcon: noop }
  };
  for (const name of [
    "ChartDemonstration",
    "ChartRangeZoom",
    "ImageLayer",
    "DrawingAxisLabels",
    "SelectedDrawingLock",
    "CandleCountdown",
    "IndicatorLegend",
    "ChartNavigation",
    "TechnicalIndicatorPanels",
    "CalendarAnalysisTables"
  ])
    overrides[`screens/terminal/${name}.js`] = { [name]: noop };
  overrides["screens/terminal/intervals/InlineTimeframeControl.js"] = {
    InlineTimeframeControl: noop
  };
  const load = createSourceLoader(overrides);
  const { ChartPanel } = load("screens/terminal/ChartPanel.js");
  return {
    ChartPanel,
    Range,
    setPrice: (height) => (metrics = [{ key: "price", top: 0, width: 96, height }])
  };
}

test("single and all sixteen panel slots render one history selector in the price heading and no footer", () => {
  const { ChartPanel, Range } = panelFixture();
  for (let slot = 1; slot <= 16; slot++) {
    const tree = ChartPanel({ slot });
    const heading = find(tree, (node) => node.props?.className === "chart-heading");
    const depth = find(heading, (node) => node.type === Range);
    assert.equal(heading.props["data-grid-depth"], "true");
    assert.equal(depth.props.slot, slot);
    assert.equal(depth.props.placement, "plot");
    assert.equal(
      tree.props.children.some((child) => child?.type === Range),
      false
    );
    assert.equal(
      find(tree, (node) => node.props?.["data-placement"] === "footer"),
      null
    );
    assert.equal(heading.props.style.width, 96);
    assert.equal(heading.props.style.maxHeight, 198);
  }
});

test("history selector follows price pane bounds and reappears after indicator focus restores them", () => {
  const f = panelFixture();
  f.setPrice(0);
  const focused = f.ChartPanel();
  const hidden = find(focused, (node) => node.props?.className === "chart-heading");
  assert.equal(hidden.props.style.maxHeight, 0);
  assert.equal(hidden.props.style.visibility, "hidden");
  f.setPrice(148);
  const restored = f.ChartPanel();
  const heading = find(restored, (node) => node.props?.className === "chart-heading");
  assert.equal(heading.props.style.maxHeight, 146);
  assert.equal(heading.props.style.visibility, undefined);
  assert.equal(find(heading, (node) => node.type === f.Range).props.placement, "plot");
});

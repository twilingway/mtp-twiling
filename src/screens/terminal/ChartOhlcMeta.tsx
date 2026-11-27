import { precision } from "../../charts/adapter.js";
import { ohlcCandleIndex, ohlcDisplayMode } from "../../model/ohlc-legend.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { useTerminal } from "./context.js";
import { OhlcLegend, OhlcLegendIcon } from "./OhlcLegend.js";
import { shallowEqual } from "./snapshot-selector.js";
import type { TerminalState } from "./state.js";

export function selectChartOhlcMeta(state: TerminalState) {
  const p = state.preferences;
  const mode = ohlcDisplayMode(p.chartSettings);
  const hoveredIndex =
    mode === "corner" && state.crosshairBar
      ? ohlcCandleIndex(state.candles, state.crosshairBar.timestamp)
      : -1;
  const index = hoveredIndex >= 0 ? hoveredIndex : state.candles.length - 1;
  const row = selectedMarketRow(state.rows, p);
  return {
    mode,
    identity: JSON.stringify([state.owner, p.symbol, p.instrumentUid, p.timeframe]),
    bar: state.candles[index],
    previousClose: state.candles[index - 1]?.close,
    digits: row ? precision(row) : 2,
    settings: p.chartSettings
  };
}

/** Keep corner hover updates inside the legend, outside the chart and toolbars. */
export function ChartOhlcMeta() {
  const { state } = useTerminal(selectChartOhlcMeta, shallowEqual);
  const { mode, identity, ...props } = state;
  if (mode === "icon") return <OhlcLegendIcon key={identity} {...props} />;
  return mode === "corner" ? <OhlcLegend {...props} /> : null;
}

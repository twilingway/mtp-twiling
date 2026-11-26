// Independent direct-window ordinary-double oracles for bounded, moderate random fixtures.
export function mean(values, length, mode = "SMA") {
  const known = [];
  let state = null;
  return values.map((value) => {
    if (value !== null) {
      known.push(value);
      if (mode === "EMA")
        state = state === null ? value : state + (2 / (length + 1)) * (value - state);
      if (mode === "RMA" && known.length === length)
        state = known.slice(-length).reduce((a, b) => a + b, 0) / length;
      else if (mode === "RMA" && known.length > length) state += (value - state) / length;
    }
    if (mode === "EMA" || mode === "RMA") return state;
    if (known.length < length) return null;
    const window = known.slice(-length);
    if (mode === "WMA")
      return (
        window.reduce((sum, value, i) => sum + value * (i + 1), 0) / ((length * (length + 1)) / 2)
      );
    const average = window.reduce((a, b) => a + b, 0) / length;
    return mode === "SD"
      ? Math.sqrt(window.reduce((sum, value) => sum + (value - average) ** 2, 0) / length)
      : average;
  });
}
export const swma = (values) =>
  values.map((_, i) => {
    const window = values.slice(i - 3, i + 1);
    return i < 3 || window.includes(null)
      ? null
      : (window[0] + 2 * window[1] + 2 * window[2] + window[3]) / 6;
  });
const div = (a, b, multiplier = 1) =>
  a === null || b === null || b === 0 ? null : (a / b) * multiplier;
export function stochOracle(
  bars,
  { rsiLength = 14, stochasticLength = 14, smoothK = 3, smoothD = 3 } = {}
) {
  const changes = bars.map((bar, i) =>
    i === 0 || bar.close === null || bars[i - 1].close === null
      ? null
      : bar.close - bars[i - 1].close
  );
  const up = mean(
    changes.map((v) => (v === null ? null : Math.max(0, v))),
    rsiLength,
    "RMA"
  );
  const down = mean(
    changes.map((v) => (v === null ? null : Math.max(0, -v))),
    rsiLength,
    "RMA"
  );
  let previousRsi = null;
  const rsi = up.map((v, i) => {
    if (changes[i] === null) return previousRsi;
    const result =
      changes[i] === 0 && rsiLength > 1 && previousRsi !== null
        ? previousRsi
        : div(v, v === null || down[i] === null ? null : v + down[i], 100);
    previousRsi = result;
    return result;
  });
  const raw = rsi.map((value, i) => {
    const window = rsi
      .slice(Math.max(0, i - stochasticLength + 1), i + 1)
      .filter((v) => v !== null);
    return value === null || !window.length
      ? null
      : div(value - Math.min(...window), Math.max(...window) - Math.min(...window), 100);
  });
  const k = mean(raw, smoothK);
  return { k, d: mean(k, smoothD) };
}
export function vigorOracle(bars, { length = 10 } = {}) {
  const difference = (a, b) =>
    bars.map((bar) => (bar[a] === null || bar[b] === null ? null : bar[a] - bar[b]));
  const top = mean(swma(difference("close", "open")), length);
  const bottom = mean(swma(difference("high", "low")), length);
  const value = top.map((v, i) => div(v, bottom[i]));
  return { value, signal: swma(value) };
}
export function volatilityOracle(
  bars,
  { length = 10, maType = "SMA", maLength = 14, bbMultiplier = 2 } = {}
) {
  const stddev = mean(
    bars.map((bar) => bar.close),
    length,
    "SD"
  );
  const upperInput = bars.map((bar, i) =>
    i > 0 && bar.close !== null && bars[i - 1].close !== null && bar.close <= bars[i - 1].close
      ? 0
      : stddev[i]
  );
  const lowerInput = bars.map((bar, i) =>
    i > 0 && bar.close !== null && bars[i - 1].close !== null && bar.close > bars[i - 1].close
      ? 0
      : stddev[i]
  );
  const upper = mean(upperInput, 14, "EMA");
  const lower = mean(lowerInput, 14, "EMA");
  const value = upper.map((v, i) =>
    div(v, v === null || lower[i] === null ? null : v + lower[i], 100)
  );
  let smoothing;
  if (maType === "None") smoothing = bars.map(() => null);
  else if (maType === "VWMA") {
    const numerator = mean(
      value.map((v, i) => (v === null || bars[i].volume === null ? null : v * bars[i].volume)),
      maLength
    );
    const denominator = mean(
      bars.map((bar) => bar.volume),
      maLength
    );
    smoothing = numerator.map((v, i) => div(v, denominator[i]));
  } else
    smoothing = mean(
      value,
      maLength,
      maType === "SMMA (RMA)" ? "RMA" : maType === "SMA + Bollinger Bands" ? "SMA" : maType
    );
  const spread = mean(value, maLength, "SD");
  const band = (sign) =>
    smoothing.map((v, i) =>
      maType !== "SMA + Bollinger Bands" || v === null || spread[i] === null
        ? null
        : v + sign * bbMultiplier * spread[i]
    );
  return { value, smoothing, upperBand: band(1), lowerBand: band(-1) };
}
export function coppockOracle(
  bars,
  { wmaLength = 10, longRocLength = 14, shortRocLength = 11 } = {}
) {
  const roc = (i, length) =>
    i < length ||
    bars[i].close === null ||
    bars[i - length].close === null ||
    bars[i - length].close === 0
      ? null
      : (100 * (bars[i].close - bars[i - length].close)) / bars[i - length].close;
  return mean(
    bars.map((_, i) => {
      const a = roc(i, longRocLength),
        b = roc(i, shortRocLength);
      return a === null || b === null ? null : a + b;
    }),
    wmaLength,
    "WMA"
  );
}
export function bullOracle(bars, { length = 13 } = {}) {
  const ema = mean(
    bars.map((bar) => bar.close),
    length,
    "EMA"
  );
  return bars.map((bar, i) =>
    bar.high === null || bar.low === null || ema[i] === null
      ? null
      : bar.high - ema[i] + (bar.low - ema[i])
  );
}

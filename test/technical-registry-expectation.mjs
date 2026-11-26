// Independently reviewed, ordered public implementation set. Update only after accepting a registry
// addition; never derive this expectation from production definitions or alter historical witnesses.
export const EXPECTED_COMPUTED_IDS = Object.freeze([
  "momentum",
  "roc",
  "cci",
  "williams-r",
  "mfi",
  "obv",
  "adl",
  "pvt",
  "wma",
  "vwma",
  "dema",
  "tema",
  "hma",
  "smma",
  "sma",
  "ema",
  "rsi",
  "macd",
  "bollinger-bands",
  "atr",
  "stochastic",
  "bollinger-percent-b",
  "bollinger-bandwidth",
  "historical-volatility",
  "awesome-oscillator",
  "balance-of-power",
  "cmo",
  "ultimate-oscillator",
  "trix",
  "aroon",
  "aroon-oscillator",
  "dmi",
  "adx",
  "vortex",
  "choppiness-index",
  "cmf",
  "chaikin-oscillator",
  "efi",
  "eom",
  "volume-oscillator",
  "nvi",
  "pvi",
  "tsi",
  "kst",
  "fisher-transform",
  "parabolic-sar",
  "supertrend",
  "alma",
  "lsma",
  "chandelier-exit"
]);
export const EXPECTED_COMPUTED_COUNT = EXPECTED_COMPUTED_IDS.length;
export const EXPECTED_TECHNICAL_COUNT = EXPECTED_COMPUTED_COUNT + 1; // Existing Volume.
export const EXPECTED_LIBRARY_COUNT = EXPECTED_TECHNICAL_COUNT + 4; // Existing MTP scripts.
export const EXPECTED_DRIVE_PARAMETER_KEYS = Object.freeze(
  "length source fastLength slowLength signalLength multiplier smoothK smoothD expansionLength contractionLength middleLength diLength adxSmoothing divisor emaLength oscillatorAverage signalAverage longLength shortLength roc1Length roc2Length roc3Length roc4Length sma1Length sma2Length sma3Length sma4Length atrLength factor start increment maximum offset sigma".split(
    " "
  )
);

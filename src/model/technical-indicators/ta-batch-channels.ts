import { bbTrendDefaults } from "./ta-batch-channels-bollinger.js";
import { envelopeDefaults, medianChannelDefaults } from "./ta-batch-channels-overlays.js";
import { chandeKrollStopDefaults, volatilityStopDefaults } from "./ta-batch-channels-stops.js";

export { donchianChannels, type DonchianOptions } from "./channel-average/channels.js";
export {
  bbTrend,
  bollingerBars,
  type BbTrendOptions,
  type BollingerBar
} from "./ta-batch-channels-bollinger.js";
export {
  envelope,
  medianChannel,
  type EnvelopeOptions,
  type MedianChannelOptions
} from "./ta-batch-channels-overlays.js";
export {
  chandeKrollStop,
  volatilityStop,
  type ChandeKrollStopOptions,
  type VolatilityStopOptions
} from "./ta-batch-channels-stops.js";

export const priceBandPresets = {
  "donchian-channels": {
    catalogId: "STD;Donchian_Channels",
    defaults: { length: 20, displayOffset: 0 },
    numericOutputs: ["basis", "upper", "lower"],
    presentation: "price-channel-with-display-offset"
  },
  envelope: {
    catalogId: "STD;ENV",
    defaults: envelopeDefaults,
    numericOutputs: ["basis", "upper", "lower"],
    presentation: "price-channel"
  },
  median: {
    catalogId: "STD;Median",
    defaults: medianChannelDefaults,
    numericOutputs: ["basis", "average", "upper", "lower"],
    presentation: "price-channel-with-directional-fill"
  },
  "chande-kroll-stop": {
    catalogId: "STD;Chande%1Kroll%1Stop",
    defaults: chandeKrollStopDefaults,
    numericOutputs: ["highStop", "lowStop"],
    presentation: "price-lines"
  },
  "volatility-stop": {
    catalogId: "STD;Volatility_Stop",
    defaults: volatilityStopDefaults,
    numericOutputs: ["value"],
    hiddenOutputs: ["direction"],
    presentation: "directional-price-stop"
  },
  bbtrend: {
    catalogId: "STD;BBTrend",
    defaults: bbTrendDefaults,
    numericOutputs: ["value"],
    presentation: "signed-percent-columns"
  },
  "bollinger-bars": {
    catalogId: "STD;Bollinger%1Bars",
    defaults: {},
    numericOutputs: [],
    presentation: "equal-width-candle-segments"
  }
} as const;

export { alma, lsma } from "./averages.js";
export type { AlmaOptions, LsmaOptions } from "./averages.js";
export { keltnerChannels, donchianChannels, chandelierExit } from "./channels.js";
export type {
  ChannelResult,
  KeltnerOptions,
  DonchianOptions,
  ChandelierOptions,
  ChandelierResult
} from "./channels.js";
export { channelAverageMetadata, channelAveragePresets } from "./metadata.js";
export type { ChannelAverageId, ChannelAverageParameters } from "./metadata.js";
export { MAX_CHANNEL_AVERAGE_BARS, MAX_DIRECT_WINDOW_OPERATIONS } from "./inputs.js";

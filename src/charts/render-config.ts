import { chartBackground, terminalTheme } from "../model/theme.js";
import { drawingToolbarSettings } from "../model/drawing-toolbar.js";
import { volumeAverageSettings } from "../model/volume-average.js";
import type {
  ChartSettings,
  IndicatorFlags,
  IndicatorKey,
  IndicatorOptions
} from "../model/types.js";

export interface ChartRenderConfig {
  settings: ChartSettings;
  indicators: IndicatorFlags;
}
const indicatorKeys: readonly IndicatorKey[] = [
  "ma",
  "ema",
  "volume",
  "mtp160",
  "mtp440",
  "mtp640",
  "mtpAll"
];

/** Only settings read by native canvases belong to the adapter's lifetime. */
export function chartRenderConfigKey(settings: ChartSettings, flags: IndicatorFlags): string {
  const tools = drawingToolbarSettings(settings),
    mtpHidden = tools.indicatorsHidden || (!!flags.mtpAll && settings.mtpAllHidden === true),
    indicatorOptions: IndicatorOptions = {};
  for (const key of indicatorKeys) {
    const style = settings.indicatorOptions?.[key];
    if (style)
      indicatorOptions[key] = {
        color: style.color,
        width: style.width,
        ...(style.opacity !== undefined ? { opacity: style.opacity } : {})
      };
  }
  const config: ChartRenderConfig = {
    settings: {
      theme: terminalTheme(settings),
      background: chartBackground(settings),
      scaleFontSize: settings.scaleFontSize ?? 11,
      grid: settings.grid !== false,
      bodyVisible: settings.bodyVisible !== false,
      upColor: settings.upColor ?? "#53b987",
      downColor: settings.downColor ?? "#eb4d5c",
      wickUpColor: settings.wickUpColor ?? "#336854",
      wickDownColor: settings.wickDownColor ?? "#7f323f",
      borderUpColor: settings.borderUpColor ?? "#53b987",
      borderDownColor: settings.borderDownColor ?? "#eb4d5c",
      borderVisible: settings.borderVisible !== false,
      wickVisible: settings.wickVisible !== false,
      priceLine: settings.priceLine !== false,
      ...(settings.lastPriceColor && { lastPriceColor: settings.lastPriceColor }),
      indicatorOptions,
      ...(flags.volume && !tools.indicatorsHidden
        ? { volumeAverage: volumeAverageSettings(settings) }
        : {}),
      drawingTools: {
        cursor: tools.cursor === "crosshair" ? "crosshair" : "arrow",
        indicatorsLocked: tools.indicatorsLocked
      }
    },
    indicators: {
      ma: !tools.indicatorsHidden && flags.ma,
      ema: !tools.indicatorsHidden && flags.ema,
      volume: !tools.indicatorsHidden && flags.volume,
      mtp160: !mtpHidden && flags.mtp160,
      mtp440: !mtpHidden && flags.mtp440,
      mtp640: !mtpHidden && flags.mtp640,
      mtpAll: !mtpHidden && !!flags.mtpAll
    }
  };
  return JSON.stringify(config);
}

/** Decode only keys produced by chartRenderConfigKey in the same render. */
export function chartRenderConfigFromKey(key: string): ChartRenderConfig {
  return JSON.parse(key) as ChartRenderConfig;
}

import { technicalCatalogData } from "./catalog-data.js";
import type { IndicatorLibraryEntry } from "../indicator-library.js";
import type { TechnicalIndicatorId } from "./types.js";

const implemented: Readonly<Record<string, TechnicalIndicatorId>> = {
  "STD;SMA": "sma",
  "STD;EMA": "ema",
  "STD;RSI": "rsi",
  "STD;MACD": "macd",
  "STD;Bollinger_Bands": "bollinger-bands",
  "STD;Average_True_Range": "atr",
  "STD;Stochastic": "stochastic",
  "STD;WMA": "wma",
  "STD;VWMA": "vwma",
  "STD;DEMA": "dema",
  "STD;TEMA": "tema",
  "STD;Hull%1MA": "hma",
  "STD;Smoothed%1Moving%1Average": "smma",
  "STD;Momentum": "momentum",
  "STD;ROC": "roc",
  "STD;CCI": "cci",
  "STD;Willams_R": "williams-r",
  "STD;Money_Flow": "mfi",
  "STD;On_Balance_Volume": "obv",
  "STD;Accumulation_Distribution": "adl",
  "STD;Price_Volume_Trend": "pvt",
  "STD;Bollinger_Bands_B": "bollinger-percent-b",
  "STD;Bollinger_Bands_Width": "bollinger-bandwidth",
  "STD;Historical_Volatility": "historical-volatility",
  "STD;Awesome_Oscillator": "awesome-oscillator",
  "STD;Balance%1of%1Power": "balance-of-power",
  "STD;Chande_Momentum_Oscillator": "cmo",
  "STD;Ultimate_Oscillator": "ultimate-oscillator",
  "STD;TRIX": "trix",
  "STD;Aroon": "aroon",
  "STD;Aroon_Oscillator": "aroon-oscillator",
  "STD;DMI": "dmi",
  "STD;Average%1Directional%1Index": "adx",
  "STD;Vortex%1Indicator": "vortex",
  "STD;Choppiness_Index": "choppiness-index",
  "STD;Chaikin_Money_Flow": "cmf",
  "STD;Chaikin_Oscillator": "chaikin-oscillator",
  "STD;EFI": "efi",
  "STD;EOM": "eom",
  "STD;Volume%1Oscillator": "volume-oscillator",
  "STD;Negative_Volume_Index": "nvi",
  "STD;Positive_Volume_Index": "pvi",
  "STD;True%1Strength%1Indicator": "tsi",
  "STD;Know_Sure_Thing": "kst",
  "STD;Fisher_Transform": "fisher-transform"
};

export function technicalDefinitionForCatalog(id: string): TechnicalIndicatorId | undefined {
  return Object.hasOwn(implemented, id) ? implemented[id] : undefined;
}

/** Named entries remain searchable even while their actual calculation is not implemented. */
export function technicalCatalogEntries(
  locale: "ru" | "en",
  blockedReason?: string
): IndicatorLibraryEntry[] {
  return technicalCatalogData.map(([id, ru, en, short, overlay]) => {
    const ready = !!technicalDefinitionForCatalog(id) || id === "Volume@tv-basicstudies";
    return {
      id,
      label: locale === "ru" ? ru : en,
      aliases: [ru, en, short],
      category: "technicals",
      available: ready && !blockedReason,
      description:
        id === "STD;CCI"
          ? locale === "ru"
            ? "Основная линия CCI в отдельной панели; без дополнительной линии сглаживания"
            : "Core CCI line in a separate pane; additional smoothing line is not included"
          : locale === "ru"
            ? overlay
              ? "На графике цены"
              : "Отдельная панель"
            : overlay
              ? "On the price chart"
              : "Separate pane",
      ...(!ready || blockedReason
        ? {
            reason:
              blockedReason ??
              (locale === "ru" ? "Расчёт пока не реализован" : "Calculation is not implemented yet")
          }
        : {})
    };
  });
}

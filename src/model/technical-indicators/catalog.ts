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
  "STD;Price_Volume_Trend": "pvt"
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

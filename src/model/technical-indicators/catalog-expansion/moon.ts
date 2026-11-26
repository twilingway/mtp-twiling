import { moonPhases } from "../ta-batch-sessions-moon.js";
import type { MoonEphemeris } from "../ta-batch-sessions-moon.js";
import type { TechnicalBar } from "../types.js";
import type { TechnicalCandleTint, TechnicalPriceCircle } from "./calendar-geometry.js";
import { defineCatalogStudy } from "./contract.js";
import { moonPhaseYears } from "./moon-phase-years.js";

export const moonAttribution = {
  line: "Moon Phases Table courtesy of Fred Espenak, www.Astropixels.com",
  url: "https://www.astropixels.com/ephemeris/moon/phases2001gmt.html"
};

let ephemeris: MoonEphemeris | undefined;
export function lunarEphemeris(): MoonEphemeris {
  ephemeris ??= {
    startTimestamp: Date.UTC(2001, 0, 1),
    endTimestamp: Date.UTC(2101, 0, 1),
    phases: moonPhaseYears.flatMap(([year, record]) =>
      record.split(" ").map((phase) => ({
        kind: phase[0] === "N" ? "new" : "full",
        timestamp: Date.UTC(
          year,
          Number(phase.slice(1, 3)) - 1,
          Number(phase.slice(3, 5)),
          Number(phase.slice(5, 7)),
          Number(phase.slice(7, 9))
        )
      }))
    )
  };
  return ephemeris;
}

export function moonPriceDecorations(
  bars: readonly TechnicalBar[]
): readonly (TechnicalCandleTint | TechnicalPriceCircle)[] {
  const tints: TechnicalCandleTint[] = [];
  const markers: TechnicalPriceCircle[] = [];
  let tint: TechnicalCandleTint | undefined;
  moonPhases(bars, lunarEphemeris()).forEach(({ stage, timestamp, markers: events }, index) => {
    if (stage !== tint?.styleId) {
      if (tint) tints.push(tint);
      tint = stage
        ? {
            kind: "candle-tint",
            styleId: stage,
            startTimestamp: timestamp,
            endTimestamp: timestamp
          }
        : undefined;
    } else if (tint) tint = { ...tint, endTimestamp: timestamp };
    const high = bars[index]!.high;
    if (high !== null)
      for (const event of events)
        markers.push({
          kind: "price-circle",
          styleId: event.kind === "new" ? "newMoon" : "fullMoon",
          timestamp,
          price: high
        });
  });
  if (tint) tints.push(tint);
  return [...tints, ...markers];
}

export const moonStudy = defineCatalogStudy<"moon-phases", Record<string, never>>({
  catalogId: "STD;Moon%1Phases",
  definition: {
    schemaVersion: 1,
    id: "moon-phases",
    title: "Фазы Луны",
    shortTitle: "Moon Phases",
    status: "computed",
    defaultPane: "overlay",
    parameters: [],
    outputs: [],
    levels: [],
    references: [
      moonAttribution.url,
      "https://www.tradingview.com/support/solutions/43000599884-moon-phases/"
    ],
    attribution: moonAttribution,
    priceRegionStyles: [
      { id: "waxing", title: "Растущая Луна", color: "#4494ca", opacity: 0.9 },
      { id: "waning", title: "Убывающая Луна", color: "#ab669a", opacity: 0.9 },
      { id: "newMoon", title: "Новолуние", color: "#171b25", opacity: 1 },
      { id: "fullMoon", title: "Полнолуние", color: "#f7efd9", opacity: 1 }
    ]
  },
  history: () => ({
    warmupBars: 1,
    historyRequirement: {
      kind: "finite",
      lookbackBars: 1,
      seedPolicy: "window",
      convergence: "exact-after-lookback"
    }
  }),
  calculate: () => ({}),
  priceRegions: moonPriceDecorations
});

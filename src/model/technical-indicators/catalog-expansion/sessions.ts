import { getInterval } from "../../intervals/registry.js";
import {
  DEFAULT_GAP_DEVIATION_PERCENT,
  DEFAULT_GAP_TRAIL_LENGTH
} from "../ta-batch-sessions-gaps.js";
import { civilClock } from "../ta-batch-sessions-calendar.js";
import type { ParameterDefinition } from "../types.js";
import { gapPriceRegions, sessionPriceRegions } from "./calendar-geometry.js";
import type {
  CalendarRegionHistoryRequirement,
  NamedSession,
  SessionDecorations
} from "./calendar-geometry.js";
import { defineCatalogStudy } from "./contract.js";
import { moonStudy } from "./moon.js";

interface GapParameters {
  closePartially: boolean;
  maxGaps: number;
  deviationPercent: number;
  limitTrail: boolean;
  maxTrailBars: number;
}

const sessions = ["session1", "session2", "session3"] as const;
type SessionKey = (typeof sessions)[number];
type TradingSessionsParameters = SessionDecorations &
  Record<`${SessionKey}Enabled`, boolean> &
  Record<`${SessionKey}${"Name" | "Start" | "End" | "TimeZone"}`, string>;

export interface SessionStudyParameters {
  gaps: GapParameters;
  "trading-sessions": TradingSessionsParameters;
  "moon-phases": Record<string, never>;
}

const flag = (key: string, defaultValue: boolean): ParameterDefinition => ({
  key,
  type: "boolean",
  defaultValue
});

const text = (
  key: string,
  defaultValue: string,
  maxLength: number,
  format?: "time"
): ParameterDefinition => ({
  key,
  type: "text",
  defaultValue,
  maxLength,
  ...(format && { format })
});

const eventHistory = (
  warmupBars: number,
  seedPolicy: CalendarRegionHistoryRequirement["seedPolicy"]
) => ({
  warmupBars,
  historyRequirement: {
    kind: "event-history" as const,
    lookbackBars: null,
    seedBars: warmupBars,
    seedPolicy,
    convergence: "full-input-dependent" as const
  }
});

const gapStyles = [
  { id: "upGap", title: "Восходящий гэп", color: "#168765", opacity: 0.24 },
  { id: "downGap", title: "Нисходящий гэп", color: "#ce4358", opacity: 0.24 }
] as const;

const gapStudy = defineCatalogStudy<"gaps", GapParameters>({
  catalogId: "STD;Gaps",
  definition: {
    schemaVersion: 1,
    id: "gaps",
    title: "Гэпы",
    shortTitle: "Gaps",
    status: "computed",
    defaultPane: "overlay",
    parameters: [
      flag("closePartially", false),
      { key: "maxGaps", type: "integer", min: 1, max: 1000, defaultValue: 100 },
      {
        key: "deviationPercent",
        type: "number",
        min: 0,
        max: 1000,
        defaultValue: DEFAULT_GAP_DEVIATION_PERCENT
      },
      flag("limitTrail", false),
      {
        key: "maxTrailBars",
        type: "integer",
        min: 1,
        max: 10000,
        defaultValue: DEFAULT_GAP_TRAIL_LENGTH
      }
    ],
    outputs: [],
    levels: [],
    references: ["https://www.tradingview.com/support/solutions/43000675999-gaps/"],
    priceRegionStyles: gapStyles
  },
  history: () => eventHistory(14, "rolling-range-gap-segments"),
  calculate: () => ({}),
  priceRegions(bars, params) {
    return gapPriceRegions(bars, {
      maxGaps: params.maxGaps,
      closePartially: params.closePartially,
      deviationPercent: params.deviationPercent,
      maxTrailBars: params.limitTrail ? params.maxTrailBars : null
    });
  }
});

const sessionPresets = [
  {
    key: "session1",
    name: "Токио",
    start: "09:00",
    end: "15:00",
    zone: "Asia/Tokyo",
    color: "#1766bf"
  },
  {
    key: "session2",
    name: "Лондон",
    start: "08:00",
    end: "16:30",
    zone: "Europe/London",
    color: "#982e8d"
  },
  {
    key: "session3",
    name: "Нью-Йорк",
    start: "09:30",
    end: "16:00",
    zone: "America/New_York",
    color: "#b45c00"
  }
] as const;

const minuteOfDay = (value: string): number => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
};

function namedSessions(params: TradingSessionsParameters): NamedSession[] {
  return sessions.map((id) => ({
    id,
    name: params[`${id}Name`],
    startMinute: minuteOfDay(params[`${id}Start`]),
    endMinute: minuteOfDay(params[`${id}End`]),
    timeZone: params[`${id}TimeZone`],
    visible: params[`${id}Enabled`]
  }));
}

const tradingSessionsStudy = defineCatalogStudy<"trading-sessions", TradingSessionsParameters>({
  catalogId: "STD;Trading%1Sessions",
  definition: {
    schemaVersion: 1,
    id: "trading-sessions",
    title: "Торговые сессии",
    shortTitle: "Sessions",
    status: "computed",
    defaultPane: "overlay",
    parameters: [
      flag("showSessionNames", true),
      flag("showOpenClose", false),
      flag("showTickRange", false),
      flag("showAverage", false),
      ...sessionPresets.flatMap(({ key, name, start, end, zone }) => [
        flag(`${key}Enabled`, true),
        text(`${key}Name`, name, 64),
        text(`${key}Start`, start, 5, "time"),
        text(`${key}End`, end, 5, "time"),
        text(`${key}TimeZone`, zone, 100)
      ])
    ],
    outputs: [],
    levels: [],
    references: ["https://www.tradingview.com/support/solutions/43000729030-trading-sessions/"],
    priceRegionStyles: sessionPresets.map(({ key, name, color }) => ({
      id: key,
      title: name,
      color,
      opacity: 0.15
    }))
  },
  validParams(params) {
    return namedSessions(params).every((session) => {
      if (!Number.isFinite(session.startMinute) || !Number.isFinite(session.endMinute))
        return false;
      if (!session.timeZone?.trim()) return true;
      try {
        civilClock(session.timeZone);
        return true;
      } catch {
        return false;
      }
    });
  },
  history: () => eventHistory(1, "session-openings"),
  calculate: () => ({}),
  priceRegions(bars, params, context) {
    const { chartInterval, exchangeTimeZone, priceStep } = context ?? {};
    if (!chartInterval || getInterval(chartInterval).group === "days") return [];
    return sessionPriceRegions(
      bars,
      namedSessions(params),
      {
        intraday: true,
        ...(exchangeTimeZone ? { exchangeTimeZone } : {}),
        ...(typeof priceStep === "number" && Number.isFinite(priceStep) && priceStep > 0
          ? { tickSize: priceStep }
          : {})
      },
      params
    );
  }
});

export const sessionStudies = [gapStudy, tradingSessionsStudy, moonStudy] as const;

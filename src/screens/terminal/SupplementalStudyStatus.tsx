import { createContext, useContext } from "react";
import type { TechnicalIndicatorId } from "../../model/technical-indicators/types.js";
import type { ChartOpenInterest } from "./use-open-interest.js";
import { isVolumeDeltaStudy } from "../../model/technical-indicators/catalog-expansion/volume-delta.js";
import {
  isMarketBreadthStudy,
  marketBreadthMetrics
} from "../../model/technical-indicators/catalog-expansion/market-breadth.js";

type Status = {
  status: ChartOpenInterest["status"] | "partial" | "needs-file" | "needs-comparison";
  currency?: string;
};
export const SupplementalStudyStatusContext = createContext<{
  openInterest?: Status;
  quoteTurnover?: Status;
  priceTarget?: Status;
  intrabarVolume?: Status;
  netVolume?: Status;
  priceLevel?: Status;
  marketBreadth?: Record<(typeof marketBreadthMetrics)[keyof typeof marketBreadthMetrics], Status>;
  correlation?: Status;
}>({});

export function SupplementalStudyStatus({
  definitionId,
  english
}: {
  definitionId: TechnicalIndicatorId;
  english: boolean;
}) {
  const source = useContext(SupplementalStudyStatusContext);
  const data =
    definitionId === "open-interest"
      ? source.openInterest
      : definitionId === "volume-24-hours"
        ? source.quoteTurnover
        : definitionId === "price-target"
          ? source.priceTarget
          : definitionId === "net-volume"
            ? source.netVolume
            : isVolumeDeltaStudy(definitionId)
              ? source.intrabarVolume
              : definitionId === "pivot-points-standard" ||
                  definitionId === "multi-time-period-charts"
                ? source.priceLevel
                : isMarketBreadthStudy(definitionId)
                  ? source.marketBreadth?.[marketBreadthMetrics[definitionId]]
                  : definitionId === "correlation-coefficient"
                    ? source.correlation
                    : undefined;
  if (!data || data.status === "hidden") return null;
  const text = {
    loading: english ? "Loading data…" : "Загрузка данных…",
    unsupported: english
      ? "Unavailable for this instrument or interval"
      : "Недоступно для инструмента или интервала",
    error: english ? "Source unavailable" : "Источник недоступен",
    partial: english ? "Some periods unavailable" : "Часть периодов недоступна",
    "needs-file": english
      ? "Choose market history in settings"
      : "Выберите историю рынка в настройках",
    "needs-comparison": english
      ? "Choose a comparison instrument in settings"
      : "Выберите инструмент сравнения в настройках",
    empty: english ? "No data for this range" : "Нет данных за этот период",
    ready: data.currency
  }[data.status];
  return text ? (
    <span role="status" data-study-data={data.status}>
      {" "}
      {isMarketBreadthStudy(definitionId) &&
        data.status !== "ready" &&
        data.currency &&
        `· ${data.currency} `}
      · {text}
    </span>
  ) : null;
}

import { createContext, useContext } from "react";
import type { TechnicalIndicatorId } from "../../model/technical-indicators/types.js";
import type { ChartOpenInterest } from "./use-open-interest.js";

type Status = Pick<ChartOpenInterest, "status" | "currency">;
export const SupplementalStudyStatusContext = createContext<{
  openInterest?: Status;
  quoteTurnover?: Status;
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
        : undefined;
  if (!data || data.status === "hidden") return null;
  const text = {
    loading: english ? "Loading data…" : "Загрузка данных…",
    unsupported: english
      ? "Unavailable for this instrument or interval"
      : "Недоступно для инструмента или интервала",
    error: english ? "Source unavailable" : "Источник недоступен",
    empty: english ? "No data for this range" : "Нет данных за этот период",
    ready: data.currency
  }[data.status];
  return text ? (
    <span role="status" data-study-data={data.status}>
      {" "}
      · {text}
    </span>
  ) : null;
}

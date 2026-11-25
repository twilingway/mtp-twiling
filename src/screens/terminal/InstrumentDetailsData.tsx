import type { SectionData, HistoryData } from "../../services/instrument-details/repository.js";
import { METRICS } from "../../model/instrument-details/data.js";
import { priceStats, seasonality } from "../../model/instrument-details/history.js";
import { currentDisplayPreferences } from "../../i18n/preferences.js";
import {
  detailDate as d,
  detailNumber as n,
  detailText as l,
  recommendation
} from "./InstrumentDetailsText.js";

export function InstrumentDetailsFundamentals({ data }: { data: SectionData["fundamentals"] }) {
  const { info, snapshot } = data;
  return (
    <>
      <dl className="instrument-details-facts">
        <div>
          <dt>ISIN</dt>
          <dd>{info.isin ?? "—"}</dd>
        </div>
        <div>
          <dt>{l("Биржа", "Exchange")}</dt>
          <dd>{info.exchange ?? "—"}</dd>
        </div>
        <div>
          <dt>{l("Страна риска", "Country of risk")}</dt>
          <dd>{info.country ?? "—"}</dd>
        </div>
        <div>
          <dt>{l("Лот, бумаг", "Lot, securities")}</dt>
          <dd>{n(info.lot, "", 0)}</dd>
        </div>
      </dl>
      {!snapshot ? (
        <p>
          {l(
            "Фундаментальные показатели не предоставлены T-Invest.",
            "T-Invest did not provide fundamentals."
          )}
        </p>
      ) : (
        <>
          <p className="instrument-details-caption">
            {l(
              "Снимок T-Invest без масштабирования; TTM — последние 12 месяцев, MRQ — последний квартал. Исторических финансовых отчётов в API нет.",
              "T-Invest snapshot values without scaling; TTM means trailing 12 months, MRQ means most recent quarter. The API has no historical financial statements."
            )}
          </p>
          <p className="instrument-details-caption">
            {l("Фискальный период", "Fiscal period")}: {d(snapshot.start)} — {d(snapshot.end)}
          </p>
          <dl className="instrument-details-facts">
            {METRICS.map(([key, ru, en, unit], index) => (
              <div key={key}>
                <dt>{l(ru, en)}</dt>
                <dd>
                  {n(
                    snapshot.values[index] ?? null,
                    unit === "money"
                      ? (snapshot.currency ?? "?")
                      : unit === "percent"
                        ? "%"
                        : unit === "ratio"
                          ? "×"
                          : ""
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p className="instrument-details-caption">
            {l(
              "Дата обновления показателей не передаётся. — означает отсутствие данных T-Invest, включая показатели со значением 0 в ответе.",
              "The API does not provide a snapshot update date. — means unavailable T-Invest data, including fundamentals returned as 0."
            )}
          </p>
        </>
      )}
    </>
  );
}
export function InstrumentDetailsDividends({ data }: { data: SectionData["dividends"] }) {
  return (
    <>
      <p className="instrument-details-caption">
        {l(
          "Реестр: последние 2 года и следующий год. На одну бумагу, как передано API; даты не гарантируют выплату.",
          "Record dates: past 2 years and next year. Per security, as provided by the API; dates do not guarantee payment."
        )}
      </p>
      {!data.length ? (
        <p>
          {l(
            "Дивиденды за этот период не предоставлены.",
            "No dividends provided for this period."
          )}
        </p>
      ) : (
        <ol className="instrument-details-events">
          {data.map((item, index) => (
            <li key={index}>
              <strong>{n(item.amount, item.currency ?? "?")}</strong>
              <span>
                {l("Реестр", "Record date")}: {d(item.record)}
              </span>
              <span>
                {l("Выплата", "Payment")}: {d(item.payment)}
              </span>
              <span>
                {l("Последний день покупки", "Last buy date")}: {d(item.buy)}
              </span>
              {item.type && <span>{item.type}</span>}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
export function InstrumentDetailsReports({ data }: { data: SectionData["reports"] }) {
  const period = (type: string | null) =>
    type === "PERIOD_TYPE_QUARTER"
      ? l("Квартал", "Quarter")
      : type === "PERIOD_TYPE_SEMIANNUAL"
        ? l("Полугодие", "Half-year")
        : type === "PERIOD_TYPE_ANNUAL"
          ? l("Год", "Year")
          : l("Период не указан", "Period unspecified");
  return (
    <>
      <p className="instrument-details-caption">
        {l(
          "GetAssetReports: даты публикации, не финансовые результаты. От −90 дней до +1 года; расписание может меняться.",
          "GetAssetReports: publication dates, not financial results. From −90 days to +1 year; the schedule may change."
        )}
      </p>
      {!data.length ? (
        <p>{l("Даты публикаций не предоставлены.", "No publication dates provided.")}</p>
      ) : (
        <ol className="instrument-details-events">
          {data.map((item, index) => (
            <li key={index}>
              <strong>{d(item.date)}</strong>
              <span>
                {period(item.type)} {item.period ?? "—"} · {item.year ?? "—"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
export function InstrumentDetailsForecasts({ data }: { data: SectionData["forecasts"] }) {
  return (
    <>
      <p className="instrument-details-caption">
        {l(
          "Прогнозы инвестдомов T-Invest — мнения, не обещанная доходность. Горизонт и дата консенсуса не передаются этим методом.",
          "T-Invest investment-house forecasts are opinions, not promised returns. This method provides no consensus date or horizon."
        )}
      </p>
      {!data.length ? (
        <p>{l("Прогнозы не предоставлены.", "No forecasts provided.")}</p>
      ) : (
        <ol className="instrument-details-events">
          {data.map((item, index) => (
            <li key={index}>
              <strong>
                {item.kind === "consensus"
                  ? l("Консенсус", "Consensus")
                  : (item.company ?? l("Инвестдом не указан", "Investment house unspecified"))}
              </strong>
              <span>
                {recommendation(item.recommendation)} · {d(item.date)}
              </span>
              <span>
                {l("Целевая цена", "Target price")}: {n(item.target, item.currency ?? "?")}
              </span>
              {(item.low !== null || item.high !== null) && (
                <span>
                  {l("Диапазон целей", "Target range")}: {n(item.low)} —{" "}
                  {n(item.high, item.currency ?? "?")}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
function HistoryCaption({ data }: { data: HistoryData }) {
  return (
    <>
      <p className="instrument-details-caption">
        {l("Запрошенный период", "Requested period")}: {d(data.from)} — {d(data.to)} · UTC
      </p>
      <p className="instrument-details-caption">
        {l("Завершённость подтверждена API", "Completion confirmed by the API")}:{" "}
        {data.completion.confirmed};{" "}
        {l(
          "старая локальная история без флага завершённости",
          "older local bars without completion metadata"
        )}
        : {data.completion.unknown}.
      </p>
      <p className="instrument-details-caption">
        {l("Дневные свечи T-Invest", "T-Invest daily candles")} ·{" "}
        {data.source === "local" ? l("локальная история", "local history") : "GetCandles"}.{" "}
        {l(
          "Изменение цены без дивидендов; сплиты самостоятельно не корректируются. Пропуски более 14 дней исключают расчёт.",
          "Price change excludes dividends; no independent split adjustment. Gaps over 14 days exclude the calculation."
        )}
      </p>
    </>
  );
}
export function InstrumentDetailsHistory({ data }: { data: HistoryData }) {
  const stats = priceStats(data.bars, data.to);
  return (
    <>
      <p>
        <strong>
          {l("Статистика закрытых дневных свечей на", "Closed daily candle statistics as of")}{" "}
          {d(stats.to)} · UTC
        </strong>
      </p>
      <HistoryCaption data={data} />
      <p className="instrument-details-caption">
        {l(
          "Доступный диапазон (приблизительное покрытие)",
          "Available range (approximate coverage)"
        )}
        : {d(stats.from)} — {d(stats.to)} · {stats.count} {l("дневных свечей", "daily bars")}
      </p>
      <dl className="instrument-details-facts">
        {stats.returns.map((item) => (
          <div key={item.months}>
            <dt>
              {item.months} {l("мес.", "mo.")}
            </dt>
            <dd>{n(item.value, "%")}</dd>
          </div>
        ))}
        <div>
          <dt>{l("Средний дневной объём · 30 сессий", "Average daily volume · 30 sessions")}</dt>
          <dd>
            {n(stats.average30)} {l("лотов", "lots")}
          </dd>
        </div>
      </dl>
      <p className="instrument-details-caption">
        {l(
          "—: недостаточно истории или нет свежих закрытых дней. Локальная история не хранит флаг завершённости: последние два UTC дня исключены. Покрытие не гарантирует отсутствие пропущенных торговых дней.",
          "—: insufficient history or no recent closed days. Local history does not store completion flags: the two most recent UTC days are excluded. Coverage does not guarantee that every trading day is present."
        )}
      </p>
    </>
  );
}
export function InstrumentDetailsSeasonality({ data }: { data: HistoryData }) {
  const months = seasonality(data.bars, data.to),
    stats = priceStats(data.bars, data.to);
  return (
    <>
      <HistoryCaption data={data} />
      <p className="instrument-details-caption">
        {l(
          "Доступный диапазон (приблизительное покрытие)",
          "Available range (approximate coverage)"
        )}
        : {d(stats.from)} — {d(stats.to)} · {stats.count} {l("свечей", "bars")}
      </p>
      <p className="instrument-details-caption">
        {l(
          "Среднее изменение от последнего закрытия перед месяцем до последнего закрытия месяца. Минимум 3 полных наблюдения; текущий месяц исключён. Это историческая статистика, не прогноз.",
          "Mean change from the close before a month to its last close. At least 3 complete observations; the current month is excluded. Historical statistics, not a forecast."
        )}
      </p>
      <table className="instrument-details-seasonality">
        <thead>
          <tr>
            <th>{l("Месяц", "Month")}</th>
            <th>{l("Среднее", "Mean")}</th>
            <th>N</th>
            <th>{l("Рост", "Positive")}</th>
          </tr>
        </thead>
        <tbody>
          {months.map((item) => (
            <tr key={item.month}>
              <th>
                {new Intl.DateTimeFormat(currentDisplayPreferences().locale, {
                  month: "short",
                  timeZone: "UTC"
                }).format(Date.UTC(2020, item.month, 1))}
              </th>
              <td>{n(item.average, "%")}</td>
              <td>{item.count}</td>
              <td>{n(item.positive, "%", 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {months.some((item) => item.average === null) && (
        <p>
          {l(
            "Неполная история: для части месяцев недостаточно наблюдений.",
            "Incomplete history: some months have too few observations."
          )}
        </p>
      )}
    </>
  );
}

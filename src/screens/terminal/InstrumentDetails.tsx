import { useState } from "react";
import type { MarketRow } from "../../model/types.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import {
  detailsRepository,
  isDetailsClient
} from "../../services/instrument-details/repository.js";
import type { DetailsClient, HistoryReader } from "../../services/instrument-details/repository.js";
import {
  InstrumentDetailsAccordion as Accordion,
  InstrumentDetailsLoad as Load
} from "./InstrumentDetailsSection.js";
import {
  InstrumentDetailsFundamentals,
  InstrumentDetailsDividends,
  InstrumentDetailsReports,
  InstrumentDetailsForecasts,
  InstrumentDetailsHistory,
  InstrumentDetailsSeasonality
} from "./InstrumentDetailsData.js";
import { detailText as l } from "./InstrumentDetailsText.js";
import { useTerminal } from "./context.js";

const readHistory: HistoryReader = async (...args) =>
  (await import("../../services/storage-v2.js")).loadHistory(...args);

export function InstrumentDetails({ row }: { row: MarketRow }) {
  const { state, controller } = useTerminal();
  const session = controller.sessionKey();
  const [open, setOpen] = useState(false);
  const client =
    isDetailsClient(session) &&
    session.owner === state.owner &&
    session.authenticated &&
    !session.closed
      ? session
      : null;
  return (
    <details
      className="instrument-details"
      onToggle={(event) => {
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
      }}
    >
      <summary>{l("Компания и статистика", "Company and statistics")}</summary>
      {open &&
        (row.providerRef ? (
          <p>
            {l(
              "Данные Bybit: цена контракта или токена, без корпоративных показателей T-Invest.",
              "Bybit contract/token prices; T-Invest company data does not apply."
            )}
          </p>
        ) : !state.authenticated || !client ? (
          <p>{l("Подключите личный ключ T-Invest.", "Connect your personal T-Invest key.")}</p>
        ) : !row.uid ? (
          <p>{l("UID инструмента недоступен.", "Instrument UID is unavailable.")}</p>
        ) : state.importingBackup || state.importRecoveryRequired ? (
          <p>{l("Дождитесь завершения импорта.", "Wait for the import to complete.")}</p>
        ) : (
          <InstrumentDetailsSession key={`${state.owner}:${row.uid}`} row={row} client={client} />
        ))}
    </details>
  );
}
function InstrumentDetailsSession({ row, client }: { row: MarketRow; client: DetailsClient }) {
  const { state, controller } = useTerminal(),
    [seasonal, setSeasonal] = useState(false);
  const uid = row.uid!,
    owner = state.owner,
    repository = detailsRepository(client, readHistory);
  const valid = () => {
    const current = controller.getSnapshot();
    return (
      current.owner === owner &&
      current.authenticated &&
      !current.importingBackup &&
      !current.importRecoveryRequired &&
      controller.sessionKey() === client &&
      selectedMarketRow(current.rows, current.preferences)?.uid === uid
    );
  };
  const seed =
    state.preferences.timeframe === "1d" &&
    !state.loading &&
    state.historyViewReady !== false &&
    selectedMarketRow(state.rows, state.preferences)?.uid === uid
      ? state.candles
      : [];
  const common = { repository, uid, seed, valid };
  return (
    <div className="instrument-details-body">
      {!row.type ? (
        <>
          <Accordion title={l("Основные показатели", "Key fundamentals")}>
            <Load {...common} section="fundamentals">
              {(data) => <InstrumentDetailsFundamentals data={data} />}
            </Load>
          </Accordion>
          <Accordion title={l("Дивиденды", "Dividends")}>
            <Load {...common} section="dividends">
              {(data) => <InstrumentDetailsDividends data={data} />}
            </Load>
          </Accordion>
          <Accordion title={l("Календарь отчётности", "Reporting calendar")}>
            <Load {...common} section="reports">
              {(data) => <InstrumentDetailsReports data={data} />}
            </Load>
          </Accordion>
          <Accordion title={l("Прогнозы аналитиков", "Analyst forecasts")}>
            <Load {...common} section="forecasts">
              {(data) => <InstrumentDetailsForecasts data={data} />}
            </Load>
          </Accordion>
        </>
      ) : (
        <p className="instrument-details-caption">
          {l(
            "Показатели компании, дивиденды и отчётность применимы к акциям.",
            "Company fundamentals, dividends and reports apply to shares."
          )}
        </p>
      )}
      <Accordion
        title={l("Динамика цены и объём · 1 год", "Price performance and volume · 1 year")}
      >
        <Load {...common} section="history">
          {(data) => <InstrumentDetailsHistory data={data} />}
        </Load>
      </Accordion>
      <Accordion title={l("Месячная сезонность", "Monthly seasonality")}>
        <p className="instrument-details-caption">
          {l(
            "До 6 лет дневных свечей. Сначала используется история устройства, затем до 6 последовательных запросов; в хранилище ничего не записывается.",
            "Up to 6 years of daily candles. Uses device history first, then up to 6 sequential requests; nothing is written to storage."
          )}
        </p>
        {seasonal ? (
          <Load {...common} section="seasonality">
            {(data) => <InstrumentDetailsSeasonality data={data} />}
          </Load>
        ) : (
          <button type="button" onClick={() => setSeasonal(true)}>
            {l("Загрузить сезонность", "Load seasonality")}
          </button>
        )}
      </Accordion>
    </div>
  );
}

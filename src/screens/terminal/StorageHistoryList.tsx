import { useState } from "react";
import { historyInstruments } from "../../model/history-instruments.js";
import type { MarketRow, Timeframe } from "../../model/types.js";
import type { HistoryGroup } from "../../services/storage-history.js";
import { t } from "../../i18n/messages.js";
import { intlLocale } from "../../i18n/preferences.js";
import { PERIOD_LABELS, number } from "./state.js";

interface Props {
  groups: readonly HistoryGroup[];
  rows: readonly MarketRow[];
  blocked: boolean;
  bytes: (value: number) => string;
  onSelect: (uid: string, timeframe: Timeframe | "all") => void;
}
export function StorageHistoryList({ groups, rows, blocked, bytes, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const items = historyInstruments(groups, rows, query, intlLocale());
  return (
    <section className="history-instruments" aria-labelledby="history-instruments-title">
      <h4 id="history-instruments-title">{t("История по инструментам и интервалам")}</h4>
      <label className="history-instrument-search">
        <span>{t("Поиск инструмента в хранилище")}</span>
        <input
          type="search"
          value={query}
          placeholder={t("Тикер или название инструмента")}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="storage-instrument-list" id="history-storage-details">
        {!items.length && (
          <p role="status">
            {t(groups.length ? "Инструменты не найдены" : "Сохранённых свечей нет")}
          </p>
        )}
        {items.map((item) => (
          <details
            className="storage-instrument"
            key={item.uid}
            open={query.trim() ? true : undefined}
          >
            <summary>
              <span className="storage-instrument-name" title={item.uid}>
                <strong>{item.name}</strong>
                {item.ticker && <small>{item.ticker}</small>}
              </span>
              <span className="storage-instrument-totals">
                {bytes(item.bytes)} · {number(item.bars, 0)} {t("свечей")}
              </span>
            </summary>
            <button type="button" disabled={blocked} onClick={() => onSelect(item.uid, "all")}>
              {t("Выбрать все интервалы инструмента")}
            </button>
            <div className="storage-table-scroll">
              <table className="storage-history-table">
                <thead>
                  <tr>
                    <th>{t("Интервал")}</th>
                    <th>{t("Свечей")}</th>
                    <th>{t("Объём")}</th>
                    <th>{t("Выбор")}</th>
                  </tr>
                </thead>
                <tbody>
                  {item.groups.map((group) => (
                    <tr key={group.timeframe}>
                      <td>{t(PERIOD_LABELS[group.timeframe])}</td>
                      <td>{number(group.bars, 0)}</td>
                      <td>{bytes(group.bytes)}</td>
                      <td>
                        <button
                          type="button"
                          disabled={blocked}
                          onClick={() => onSelect(item.uid, group.timeframe)}
                        >
                          {t("Выбрать")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

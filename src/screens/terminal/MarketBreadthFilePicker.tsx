import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  MAX_MARKET_BREADTH_FILE_SIZE,
  parseMarketBreadthFile
} from "../../model/technical-indicators/catalog-expansion/market-breadth.js";
import type { ImportedMarketBreadth } from "../../model/technical-indicators/catalog-expansion/market-breadth.js";

interface MarketBreadthFilePickerProps {
  english: boolean;
  data: ImportedMarketBreadth | null;
  onChange: (data: ImportedMarketBreadth | null) => void;
}

type ImportError = "size" | "read" | "format";

export function MarketBreadthFilePicker({ english, data, onChange }: MarketBreadthFilePickerProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ImportError | null>(null);
  const revision = useRef(0);
  const label = (ru: string, en: string) => (english ? en : ru);
  const errors: Record<ImportError, string> = {
    size: label("Допустим JSON до 16 МБ.", "Choose a JSON file up to 16 MB."),
    read: label("Не удалось прочитать файл.", "The file could not be read."),
    format: label(
      "Проверьте формат, даты покрытия и агрегаты в файле.",
      "Check the format, coverage dates, and aggregates in the file."
    )
  };

  useEffect(
    () => () => {
      revision.current++;
    },
    []
  );

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const requested = ++revision.current;
    setError(null);
    if (file.size > MAX_MARKET_BREADTH_FILE_SIZE) {
      setPending(false);
      setError("size");
      return;
    }
    setPending(true);
    let contents: string;
    try {
      contents = await file.text();
    } catch {
      if (revision.current === requested) {
        setPending(false);
        setError("read");
      }
      return;
    }
    if (revision.current !== requested) return;
    setPending(false);
    let source: ImportedMarketBreadth;
    try {
      source = parseMarketBreadthFile(contents);
    } catch {
      setError("format");
      return;
    }
    onChange(source);
  }

  function clear() {
    revision.current++;
    setError(null);
    setPending(false);
    onChange(null);
  }

  return (
    <section aria-label={label("Данные ширины рынка", "Market breadth data")} aria-busy={pending}>
      <label>
        {label("Выбрать JSON с историей рынка", "Choose market history JSON")}
        <input
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            void selectFile(event);
          }}
        />
      </label>
      {pending && <p role="status">{label("Проверяем файл…", "Checking file…")}</p>}
      {error && <p role="alert">{errors[error]}</p>}
      {data && (
        <>
          <dl>
            <dt>{label("Рынок", "Market")}</dt>
            <dd>{data.metadata.marketId}</dd>
            <dt>{label("Источник", "Source")}</dt>
            <dd>{data.metadata.source}</dd>
            <dt>{label("Покрытие", "Coverage")}</dt>
            <dd>
              {data.metadata.from} — {data.metadata.to} · {data.metadata.timeZone}
            </dd>
            <dt>{label("Дни со счётчиками", "Days with counts")}</dt>
            <dd>{data.coverage.countDays}</dd>
            <dt>{label("Дни с объёмом", "Days with volume")}</dt>
            <dd>
              {data.coverage.volumeDays}
              {data.metadata.volumeUnit && ` · ${data.metadata.volumeUnit}`}
            </dd>
          </dl>
          <button type="button" onClick={clear}>
            {label("Отключить локальный источник", "Disconnect local source")}
          </button>
        </>
      )}
      <details>
        <summary>{label("Формат и права на данные", "Format and data rights")}</summary>
        <p>
          {label(
            "Используйте исторический состав одного рынка. Укажите источник, часовой пояс и даты в формате ГГГГ-ММ-ДД. Отметьте дни без торгов и дни без данных.",
            "Use historical membership for a single market. Provide the source, time zone and YYYY-MM-DD dates. Mark closed days and days with missing data."
          )}
        </p>
        <p>
          {label(
            "Ряды работают на дневном графике. Выбирайте файл, данные которого вам разрешено использовать. Файл обрабатывается на устройстве.",
            "Studies use daily charts. Choose a file with data you have permission to use. The file is processed on this device."
          )}
        </p>
      </details>
    </section>
  );
}

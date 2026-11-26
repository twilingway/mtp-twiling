import { useEffect, useRef, useState } from "react";
import { t, systemText } from "../../i18n/messages.js";
import { intlLocale } from "../../i18n/preferences.js";
import type { Locale } from "../../i18n/preferences.js";
import { summarizeBackupFile } from "../../model/backup-transfer-progress.js";
import type {
  BackupFileSummary,
  ExportStorageStage,
  FileImportProgress
} from "../../model/backup-transfer-progress.js";
import { useTerminal } from "./context.js";
import { LegacyGuestRecovery } from "./LegacyGuestRecovery.js";

type Operation = "import" | "export";
type TransferStage = "queued" | "encode" | ExportStorageStage | FileImportProgress["stage"];

type FileDetails = { bytes?: number; summary?: BackupFileSummary };
type Transfer = FileDetails & { operation: Operation; stage: TransferStage; startedAt: number };
type Receipt = FileDetails & {
  operation: Operation;
  elapsed?: number;
  message: string;
  error?: boolean;
};

const stages: Record<TransferStage, readonly [string, string]> = {
  queued: ["Подготавливаем перенос…", "Preparing transfer…"],
  flush: ["Сохраняем текущие изменения…", "Saving current changes…"],
  collect: ["Собираем данные для выгрузки…", "Collecting data for export…"],
  encode: ["Формируем файл JSON…", "Creating the JSON file…"],
  read: ["Читаем выбранный файл…", "Reading the selected file…"],
  validate: ["Проверяем содержимое файла…", "Checking the file contents…"],
  write: ["Записываем данные профиля…", "Writing the profile data…"],
  restore: ["Восстанавливаем рабочее пространство…", "Restoring the workspace…"]
};

function transferDetails(
  locale: Locale,
  { bytes, summary }: FileDetails,
  elapsed: number | undefined
): string {
  const number = new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 1 });
  const ru = locale === "ru";
  const parts: string[] = [];
  if (elapsed !== undefined) parts.push(`${number.format(elapsed / 1000)} ${ru ? "с" : "s"}`);
  if (bytes !== undefined) {
    const [divisor, unit] =
      bytes >= 1_000_000
        ? [1_000_000, ru ? "МБ" : "MB"]
        : bytes >= 1_000
          ? [1_000, ru ? "кБ" : "kB"]
          : [1, ru ? "Б" : "B"];
    parts.push(`${number.format(bytes / divisor)} ${unit}`);
  }
  if (summary) {
    const counts = [
      ...(summary.instruments === undefined
        ? []
        : [`${ru ? "инструменты" : "instruments"} ${number.format(summary.instruments)}`]),
      `${ru ? "рисунки" : "drawings"} ${number.format(summary.drawings)}`,
      `${ru ? "изображения" : "images"} ${number.format(summary.images)}`
    ];
    parts.push(`${ru ? "В файле" : "In the file"} — ${counts.join(", ")}`);
  }
  return parts.join(" · ");
}

export function BackupTransferSettings({ active }: { active: boolean }) {
  const { controller, state } = useTerminal();
  const [history, setHistory] = useState(false);
  const [transfer, setTransfer] = useState<Transfer>();
  const [receipt, setReceipt] = useState<Receipt>();
  const [measuredAt, setMeasuredAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const locale = state.preferences.locale ?? "ru";
  const localized = (ru: string, en: string) => (locale === "en" ? en : ru);
  const startedAt = transfer?.startedAt;
  const busy = transfer !== undefined;

  useEffect(() => {
    const field = input.current;
    if (!field) return;
    const cancelled = () =>
      setReceipt({
        operation: "import",
        message: locale === "en" ? "No file chosen." : "Файл не выбран."
      });
    field.addEventListener("cancel", cancelled);
    return () => field.removeEventListener("cancel", cancelled);
  }, [locale]);

  useEffect(() => {
    if (startedAt === undefined) return;
    const timer = window.setInterval(() => setMeasuredAt(performance.now()), 250);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  function start(operation: Operation, details: FileDetails = {}) {
    const startedAt = performance.now();
    setMeasuredAt(startedAt);
    setReceipt(undefined);
    setTransfer({ operation, stage: "queued", startedAt, ...details });
    return {
      phase: (stage: TransferStage, details: FileDetails = {}) =>
        setTransfer((current) => (current ? { ...current, stage, ...details } : current)),
      finish: (message: string, success: boolean, fileDetails = details) => {
        setTransfer(undefined);
        setReceipt({
          operation,
          message,
          error: !success,
          elapsed: performance.now() - startedAt,
          ...fileDetails
        });
      }
    };
  }

  async function exportFile() {
    const flow = start("export");
    try {
      const backup = await controller.exportBackup(history, undefined, flow.phase);
      const summary = summarizeBackupFile(backup);
      flow.phase("encode", { summary });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = `mtp-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      flow.finish(
        localized(
          "Файл передан браузеру для скачивания.",
          "The file was sent to the browser for download."
        ),
        true,
        { bytes: blob.size, summary }
      );
    } catch (error) {
      flow.finish(
        error instanceof Error ? systemText(error.message) : t("Экспорт недоступен"),
        false
      );
    }
  }

  async function importFile(field: HTMLInputElement) {
    const file = field.files?.[0];
    if (!file) {
      setReceipt({ operation: "import", message: localized("Файл не выбран.", "No file chosen.") });
      return;
    }
    if (file.size > 256 * 1024 * 1024) {
      field.value = "";
      setReceipt({
        operation: "import",
        error: true,
        message: t("Для импорта допустим файл до 256 МБ."),
        bytes: file.size
      });
      return;
    }
    const flow = start("import", { bytes: file.size });
    let summary: BackupFileSummary | undefined;
    try {
      await controller.importBackupFile(file, (progress) => {
        if (progress.summary) summary = progress.summary;
        flow.phase(progress.stage, summary ? { summary } : {});
      });
      flow.finish(
        localized(
          "Импорт завершён. Рисунки доступны на графиках своих инструментов.",
          "Import complete. Drawings are available on their instruments' charts."
        ),
        true,
        { bytes: file.size, ...(summary ? { summary } : {}) }
      );
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "NotReadableError"
          ? localized(
              "Браузер не может прочитать этот файл. Скачайте JSON через браузер и выберите скачанную копию из «Загрузок».",
              "The browser could not read this file. Download the JSON in the browser and choose that copy from Downloads."
            )
          : error instanceof Error
            ? systemText(error.message)
            : t("Импорт недоступен");
      flow.finish(message, false, { bytes: file.size, ...(summary ? { summary } : {}) });
    } finally {
      field.value = "";
    }
  }

  const details = transfer
    ? transferDetails(locale, transfer, Math.max(0, measuredAt - transfer.startedAt))
    : receipt && transferDetails(locale, receipt, receipt.elapsed);
  const operation = transfer?.operation ?? receipt?.operation;

  return (
    <section className="transfer-settings">
      <h3>{t("Перенос между устройствами")}</h3>
      <p>
        {t(
          "Формат 2: обновите приложение на другом устройстве. Старые данные и синхронизация формата 1 сохраняются отдельно."
        )}
      </p>
      {state.pendingPublicSource && (
        <div role="status">
          <p>
            {t(
              "В другом локальном профиле сохранены публичные инструменты. Существующую разметку этого профиля заменять не будем."
            )}
          </p>
          <button
            type="button"
            disabled={busy || state.profileTransition}
            onClick={() => {
              void controller
                .mergePublicProfile()
                .catch((error: unknown) =>
                  controller.notify(error instanceof Error ? error.message : "Перенос недоступен")
                );
            }}
          >
            {t("Добавить недостающие публичные данные")}
          </button>
        </div>
      )}
      <p>
        {t(
          "Индикаторы, вид графиков, список инструментов, линии и изображения. API-ключ не включается."
        )}
      </p>
      <label className="checkbox-label">
        <input
          id="export-history"
          type="checkbox"
          checked={history}
          onChange={(e) => setHistory(e.target.checked)}
        />
        {t("Также включить историю свечей")}
      </label>
      <div>
        <button
          type="button"
          id="export-settings"
          disabled={busy || state.backupBusy || !state.marketReady}
          onClick={() => void exportFile()}
        >
          {t("Экспорт")}
        </button>
        <button
          type="button"
          id="import-settings"
          disabled={busy || state.backupBusy || !state.marketReady}
          onClick={() => {
            setReceipt(undefined);
            input.current?.click();
          }}
        >
          {t("Импорт")}
        </button>
      </div>
      <input
        type="file"
        ref={input}
        id="settings-file"
        accept="application/json,.json"
        hidden
        onChange={(event) => void importFile(event.currentTarget)}
      />
      {(transfer || receipt) && (
        <aside className="backup-transfer-report">
          {transfer && <progress aria-label={localized("Перенос файла", "File transfer")} />}
          <p
            id={operation === "export" ? "backup-export-result" : "backup-import-result"}
            role={receipt?.error ? "alert" : "status"}
          >
            {transfer ? stages[transfer.stage][locale === "en" ? 1 : 0] : receipt?.message}
          </p>
          {details && <p>{details}</p>}
        </aside>
      )}
      <LegacyGuestRecovery active={active} includeHistory={history} />
    </section>
  );
}

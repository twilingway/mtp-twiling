import { useEffect, useState } from "react";
import { t } from "../../i18n/messages.js";
import { intlLocale } from "../../i18n/preferences.js";
import type {
  DriveOperationTime,
  DriveProgress,
  DriveStage
} from "../../services/drive/progress.js";

const stages: Record<DriveStage, string> = {
  "collect-local": "Собираем данные устройства",
  "read-versions": "Читаем список версий Google Диска",
  "check-versions": "Проверяем облачные версии",
  "prepare-upload": "Готовим данные к отправке",
  upload: "Отправляем файлы на Google Диск",
  download: "Получаем файлы с Google Диска",
  confirm: "Подтверждаем версию на Google Диске",
  apply: "Применяем данные на устройстве",
  "save-status": "Сохраняем результат синхронизации"
};

function duration(elapsedMs: number): string {
  return new Intl.NumberFormat(intlLocale(), {
    style: "unit",
    unit: "second",
    maximumFractionDigits: 1
  }).format(elapsedMs / 1000);
}

export function DriveOperationProgress({
  progress,
  previous
}: {
  progress?: DriveProgress | undefined;
  previous?: DriveOperationTime | undefined;
}) {
  const [now, setNow] = useState(() => performance.now());
  const startedAt = progress?.startedAt;
  useEffect(() => {
    if (startedAt === undefined) return;
    const clock = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(clock);
  }, [startedAt]);
  if (progress) {
    const transfer = progress.transfer;
    const number = new Intl.NumberFormat(intlLocale());
    return (
      <div id="google-drive-progress" data-drive-stage={progress.stage}>
        <p role="status">{t(stages[progress.stage])}</p>
        <small>
          {t("Прошло времени")}: {duration(Math.max(0, now - progress.startedAt))}
          {progress.listedVersions !== undefined && (
            <>
              {" · "}
              {t("Версий найдено")}: {number.format(progress.listedVersions)}
            </>
          )}
          {transfer && (
            <>
              {" · "}
              {t("Файлов обработано")}: {transfer.completedFiles}/{transfer.totalFiles}
              {" · "}
              {t(progress.stage === "upload" ? "Отправлено байтов" : "Получено байтов")}:{" "}
              {number.format(transfer.transferredBytes)}
            </>
          )}
        </small>
      </div>
    );
  }
  return previous ? (
    <details id="google-drive-last-duration">
      <summary>
        {t("Длительность последней попытки")}: {duration(previous.elapsedMs)}
      </summary>
      {previous.listedVersions !== undefined && (
        <small>
          {t("Версий найдено")}:{" "}
          {new Intl.NumberFormat(intlLocale()).format(previous.listedVersions)}
        </small>
      )}
      <ul>
        {previous.stages.map(({ stage, elapsedMs }) => (
          <li key={stage}>
            {t(stages[stage])}: {duration(elapsedMs)}
          </li>
        ))}
      </ul>
    </details>
  ) : null;
}

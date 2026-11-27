import { useState } from "react";
import { t } from "../../i18n/messages.js";
import { intlLocale } from "../../i18n/preferences.js";
import type { GoogleSlotProvider } from "../../services/drive/device-slot-provider.js";
import type { GoogleStatus } from "../../services/drive/device-slot-status.js";

type Compaction = NonNullable<GoogleStatus["compaction"]>;
type LegacyArchive = NonNullable<GoogleStatus["legacyArchives"]>[number];
type Action = "compact" | "inspect" | "download" | "late";
type ArchiveActions = Pick<
  GoogleSlotProvider,
  "compactLegacy" | "inspectLegacyArchives" | "downloadLegacyRawArchive" | "inspectLateLegacy"
>;

const stageLabels = {
  checking: "Проверяем старые файлы Google Диска…",
  archive: "Сохраняем архив на Google Диске…",
  verify: "Проверяем сохранённый архив…",
  record: "Подтверждаем доступность архива…",
  delete: "Удаляем старые файлы с Google Диска…",
  complete: "Очистка старых файлов завершена",
  paused: "Очистка старых файлов приостановлена"
} satisfies Record<Compaction["phase"], string>;

const metrics = [
  ["archivedFiles", "В архиве"],
  ["deletedFiles", "Удалено"],
  ["pendingFiles", "Ожидают удаления"],
  ["changedFiles", "Изменились и сохранены"]
] as const;

function validDate(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function saveArchive(body: Blob, createdAt: string): void {
  const day = validDate(createdAt)?.toISOString().slice(0, 10);
  const link = document.createElement("a");
  const url = URL.createObjectURL(body);
  try {
    link.href = url;
    link.download = `mtp-google${day ? `-${day}` : ""}.mtp-raw-archive`;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

function isCompacting(progress: Compaction | undefined): boolean {
  return !!progress && progress.phase !== "complete" && progress.phase !== "paused";
}

function CompactionProgress({ progress }: { progress: Compaction }) {
  const label = t(stageLabels[progress.phase]);
  const number = new Intl.NumberFormat(intlLocale());
  return (
    <div className="cloud-retention-progress" data-phase={progress.phase}>
      <p className="cloud-retention-stage" role="status">
        {label}
      </p>
      {isCompacting(progress) && <progress aria-label={label} />}
      <dl className="cloud-retention-counts">
        {metrics.map(([key, name]) => {
          const count = progress[key];
          if (count === undefined || (key === "changedFiles" && count === 0)) return null;
          return (
            <div key={key}>
              <dt>{t(name)}</dt>
              <dd>{number.format(count)}</dd>
            </div>
          );
        })}
      </dl>
      {!!progress.archivedFiles && (
        <p className="cloud-retention-note">{t("Архив сохранён и проверен на Google Диске.")}</p>
      )}
      {progress.phase === "paused" && (
        <p className="cloud-retention-note">
          {t(
            progress.error === "not-ready"
              ? "Сначала подтвердите новую версию Google Диска."
              : "Повторите очистку, чтобы продолжить."
          )}
        </p>
      )}
    </div>
  );
}

function ArchiveHistory({
  archives,
  lateChanges,
  disabled,
  action,
  inspect,
  inspectLate,
  download
}: {
  archives: GoogleStatus["legacyArchives"];
  lateChanges: GoogleStatus["legacyLateChanges"];
  disabled: boolean;
  action: Action | undefined;
  inspect: () => void;
  inspectLate: () => void;
  download: (archive: LegacyArchive) => void;
}) {
  const date = new Intl.DateTimeFormat(intlLocale(), { dateStyle: "medium", timeStyle: "short" });
  const number = new Intl.NumberFormat(intlLocale());
  const size = new Intl.NumberFormat(intlLocale(), { style: "unit", unit: "byte" });
  const lateCount = lateChanges?.reduce((count, item) => count + item.snapshotIds.length, 0);
  return (
    <details className="cloud-retention-history">
      <summary>{t("Архивы старых файлов")}</summary>
      <div className="cloud-retention-history-actions">
        <button type="button" disabled={disabled} onClick={inspect}>
          {t("Проверить архивы")}
        </button>
        <button type="button" disabled={disabled} onClick={inspectLate}>
          {t("Проверить старые записи")}
        </button>
      </div>
      {action === "inspect" && <p role="status">{t("Ищем сохранённые архивы…")}</p>}
      {action === "download" && <p role="status">{t("Скачиваем сохранённый архив…")}</p>}
      {action === "late" && <p role="status">{t("Проверяем записи в старом формате…")}</p>}
      {lateCount !== undefined && action !== "late" && (
        <p className="cloud-retention-note" role="status">
          {lateCount ? (
            <>
              {t("Новых снимков в старом формате")} {number.format(lateCount)}.{" "}
              {t("Эти снимки требуют сверки.")}
            </>
          ) : (
            t("Новых записей в старом формате нет.")
          )}
        </p>
      )}
      {archives?.length === 0 && <p>{t("Сохранённых архивов пока нет.")}</p>}
      {archives && archives.length > 0 && (
        <ul className="cloud-retention-archives">
          {archives.map((archive) => {
            const createdAt = validDate(archive.createdAt);
            return (
              <li key={archive.id}>
                <div className="cloud-retention-archive-meta">
                  {createdAt ? (
                    <time dateTime={createdAt.toISOString()}>{date.format(createdAt)}</time>
                  ) : (
                    <strong>{t("Дата неизвестна")}</strong>
                  )}
                  <small>
                    {size.format(archive.bytes)}
                    {archive.fileCount === undefined
                      ? null
                      : ` · ${t("Файлов в архиве")} ${number.format(archive.fileCount)}`}
                  </small>
                </div>
                <button type="button" disabled={disabled} onClick={() => download(archive)}>
                  {t("Скачать сохранённый архив")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}

export function GoogleCompactionSettings({
  google,
  status,
  blocked
}: {
  google: ArchiveActions;
  status: Pick<
    GoogleStatus,
    "connected" | "compaction" | "legacyArchives" | "legacyLateChanges" | "migrationRequired"
  >;
  blocked: boolean;
}) {
  const [task, setTask] = useState<{ action: Action; previous: Compaction | undefined }>();
  const [failed, setFailed] = useState(false);
  const current = status.connected ? status.compaction : undefined;
  const action = task?.action;
  const progress: Compaction | undefined =
    status.connected && action === "compact" && current === task?.previous
      ? { phase: "checking" }
      : current;
  const disabled = blocked || !status.connected || isCompacting(current) || !!task;

  const run = async (next: Action, operation: () => Promise<void>) => {
    if (disabled || (next === "compact" && status.migrationRequired)) return;
    setTask({ action: next, previous: current });
    setFailed(false);
    try {
      await operation();
    } catch {
      setFailed(true);
    } finally {
      setTask(undefined);
    }
  };

  return (
    <section className="cloud-retention" aria-label={t("Очистка старых файлов Google Диска")}>
      <h4>{t("Очистка старых файлов Google Диска")}</h4>
      {!status.connected && (
        <p className="cloud-retention-note">
          {t("Подключите Google Диск для очистки и просмотра архивов.")}
        </p>
      )}
      {progress && <CompactionProgress progress={progress} />}
      {failed && status.connected && (
        <p className="cloud-retention-note" role="status">
          {t("Действие с архивом не выполнено. Повторите попытку.")}
        </p>
      )}
      <p className="cloud-retention-note">
        {t(
          "После очистки старые версии приложения нужно обновить. Сохранённые архивы останутся в облаке."
        )}
      </p>
      <button
        className="cloud-retention-compact"
        type="button"
        disabled={disabled || !!status.migrationRequired}
        onClick={() => void run("compact", () => google.compactLegacy())}
      >
        {t(
          current?.phase === "paused"
            ? "Повторить очистку"
            : "Сохранить архив и очистить старые файлы"
        )}
      </button>
      <ArchiveHistory
        archives={status.connected ? status.legacyArchives : undefined}
        lateChanges={status.connected ? status.legacyLateChanges : undefined}
        disabled={disabled}
        action={status.connected ? action : undefined}
        inspect={() => void run("inspect", () => google.inspectLegacyArchives())}
        inspectLate={() =>
          void run("late", async () => {
            if (!(await google.inspectLateLegacy())) throw new Error("Legacy review unavailable");
          })
        }
        download={(archive) =>
          void run("download", async () => {
            const body = await google.downloadLegacyRawArchive(archive.id);
            if (!body) throw new Error("Archive download unavailable");
            saveArchive(body, archive.createdAt);
          })
        }
      />
    </section>
  );
}

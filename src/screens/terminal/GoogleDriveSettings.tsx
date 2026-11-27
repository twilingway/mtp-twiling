import { useState, useSyncExternalStore } from "react";
import { t } from "../../i18n/messages.js";
import { terminalGoogleRetention } from "./controller-drive.js";
import { useTerminal, useTerminalController } from "./context.js";
import { shallowEqual } from "./snapshot-selector.js";
import type { TerminalState } from "./state.js";

type GoogleRetention = NonNullable<ReturnType<typeof terminalGoogleRetention>>;
const selectRetentionControls = (state: TerminalState) => ({
  importRecoveryRequired: state.importRecoveryRequired,
  locale: state.preferences.locale
});
export function GoogleDriveSettings() {
  const controller = useTerminalController();
  const google = terminalGoogleRetention(controller);
  return google ? <RetentionDetails google={google} /> : null;
}
function RetentionDetails({ google }: { google: GoogleRetention }) {
  const { controller, state } = useTerminal(selectRetentionControls, shallowEqual);
  const status = useSyncExternalStore(google.subscribe, google.getSnapshot, google.getSnapshot);
  const [busy, setBusy] = useState(false);
  const capability = status.writeCapability;
  const blocked =
    busy ||
    capability?.phase === "checking" ||
    status.phase === "syncing" ||
    !status.connected ||
    !!state.importRecoveryRequired;
  const run = (operation: () => Promise<unknown>) => {
    setBusy(true);
    void operation()
      .catch(() => controller.notify(t("Операция Google не подтверждена. Повторите проверку.")))
      .finally(() => setBusy(false));
  };
  const downloadArchive = async () => {
    const archive = await google.prepareLegacyArchive();
    if (!archive) return;
    const url = URL.createObjectURL(archive),
      link = document.createElement("a");
    link.href = url;
    link.download = `mtp-drive-${new Date().toISOString().slice(0, 10)}.mtp-drive-archive`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (!status.enabled) return null;
  return (
    <>
      {capability?.phase === "cleanup-pending" && capability.cleanupPending > 0 && (
        <small role="status" data-google-write-capability="cleanup-pending">
          {t("Google Диск: удаление временных данных проверки будет повторено автоматически.")}
        </small>
      )}
      <details className="cloud-google-details" open={!!status.migrationRequired}>
        <summary>{t("Версии Google и совместимость")}</summary>
        {busy && <p role="status">{t("Выполняем действие…")}</p>}
        <label>
          {t("Режим синхронизации Google")}
          <select
            value={status.mode}
            disabled={blocked}
            onChange={(event) => {
              const mode = event.target.value === "test" ? "test" : "normal";
              run(() => google.setSlotMode(mode));
            }}
          >
            <option value="normal">{t("Версии каждого устройства")}</option>
            <option value="test">{t("Общий слот · тест")}</option>
          </select>
        </label>
        {status.migrationRequired && (
          <div className="drive-conflict">
            <p>
              {t(
                "Старые снимки Google сохранены. Скачайте и проверьте архив перед выбором версии."
              )}
            </p>
            <button type="button" disabled={blocked} onClick={() => run(downloadArchive)}>
              {t("Скачать архив старых снимков")}
            </button>
            <label>
              {t("Проверить скачанный архив")}
              <input
                type="file"
                accept=".mtp-drive-archive,application/octet-stream"
                disabled={blocked}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) run(() => google.verifyLegacyArchive(file));
                }}
              />
            </label>
            {status.archive && (
              <p role="status">
                {status.archive.count} {t("снимков в архиве")} ·{" "}
                {status.archive.bytes.toLocaleString()} bytes ·{" "}
                {t(status.archive.verified ? "Архив проверен" : "Нужно проверить архив")}
              </p>
            )}
          </div>
        )}
        {status.previousVersions && status.previousVersions.length > 0 && (
          <div>
            <h4>{t("Предыдущие версии Google")}</h4>
            <p>
              {t(
                "Восстановление заменит настройки и разметку на устройстве. Облачные снимки сохранятся."
              )}
            </p>
            {status.previousVersions.map((version) => (
              <p key={version.id}>
                {version.size.toLocaleString()} bytes{" "}
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() => run(() => google.restorePrevious(version.id))}
                >
                  {t("Восстановить предыдущую версию")}
                </button>
              </p>
            ))}
          </div>
        )}
        <details className="cloud-google-diagnostics">
          <summary>{t("Диагностика Google")}</summary>
          <p>{t("Проверка подключения не отправляет рабочее пространство.")}</p>
          <button
            type="button"
            disabled={blocked}
            onClick={() => run(() => google.runUploadProbe())}
          >
            {t("Повторить проверку подключения")}
          </button>
        </details>
      </details>
    </>
  );
}

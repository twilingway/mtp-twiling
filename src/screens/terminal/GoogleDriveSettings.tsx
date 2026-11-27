import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { t } from "../../i18n/messages.js";
import { terminalGoogleRetention } from "./controller-drive.js";
import { useTerminal } from "./context.js";

type GoogleRetention = NonNullable<ReturnType<typeof terminalGoogleRetention>>;
export function GoogleDriveSettings() {
  const { controller } = useTerminal();
  const google = terminalGoogleRetention(controller);
  return google ? <RetentionDetails google={google} /> : null;
}
function RetentionDetails({ google }: { google: GoogleRetention }) {
  const { controller, state } = useTerminal();
  const status = useSyncExternalStore(google.subscribe, google.getSnapshot, google.getSnapshot);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0),
    [duration, setDuration] = useState<number | null>(null);
  const started = useRef(0);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started.current) / 1000)),
      1000
    );
    return () => clearInterval(timer);
  }, [busy]);
  const blocked =
    busy || status.phase === "syncing" || !status.connected || !!state.importRecoveryRequired;
  const run = (operation: () => Promise<unknown>) => {
    started.current = Date.now();
    setElapsed(0);
    setBusy(true);
    void operation()
      .catch(() => controller.notify(t("Операция Google не подтверждена. Повторите проверку.")))
      .finally(() => {
        setDuration(Math.max(0, Date.now() - started.current));
        setBusy(false);
      });
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
  return (
    <details
      className="cloud-google-details"
      open={status.uploadProbeBytes === 0 || !!status.migrationRequired}
    >
      <summary>{t("Версии Google и совместимость")}</summary>
      {busy && (
        <p role="status">
          {t("Выполняем проверку…")} {elapsed} {t("с")}
        </p>
      )}
      {!busy && duration !== null && (
        <small>
          {t("Время последней попытки")}: {(duration / 1000).toFixed(1)} {t("с")}
        </small>
      )}
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
      <p>
        {t(
          status.uploadProbeBytes > 0 ? "Проверенный объём загрузки" : "Загрузка ещё не проверена"
        )}
        {status.uploadProbeBytes > 0 ? `: ${status.uploadProbeBytes.toLocaleString()} bytes` : null}
      </p>
      {status.connected && status.uploadProbeBytes === 0 && (
        <p role="status">{t("Перед отправкой нужно проверить загрузку Google.")}</p>
      )}
      <button type="button" disabled={blocked} onClick={() => run(() => google.runUploadProbe())}>
        {t("Проверить загрузку Google")}
      </button>
      {status.migrationRequired && (
        <div className="drive-conflict">
          <p>
            {t("Старые снимки Google сохранены. Скачайте и проверьте архив перед выбором версии.")}
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
    </details>
  );
}

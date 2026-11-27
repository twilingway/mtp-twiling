import { useSyncExternalStore } from "react";
import { t } from "../../i18n/messages.js";
import type { CloudProviderId } from "../../model/cloud-sync.js";
import { useTerminalController, useTerminalState } from "./context.js";
import type { TerminalState } from "./state.js";
import { CLOUD_PROVIDERS, terminalCloudSync } from "./controller-cloud-sync.js";

const selectLocale = (state: TerminalState) => state.preferences.locale;
function ProviderPause({ id }: { id: CloudProviderId }) {
  const controller = useTerminalController();
  useTerminalState(controller, selectLocale);
  const provider = terminalCloudSync(controller, id);
  const status = useSyncExternalStore(
    provider.subscribe,
    provider.getSnapshot,
    provider.getSnapshot
  );
  if (!status.enabled) return null;
  if (status.phase === "connecting" || status.phase === "syncing") return null;
  const reason =
    status.phase === "conflict"
      ? "Выберите версию"
      : status.error === "unsupported-format"
        ? "Обновите приложение: формат облака пока не поддерживается. Данные сохранены."
        : status.phase === "auth-required"
          ? "Требуется повторный вход"
          : status.pauseReason === "configuration-required"
            ? "Нужна настройка OAuth приложения"
            : status.pauseReason === "offline"
              ? "Нет интернета"
              : status.pauseReason === "network"
                ? "Нет связи с облаком. Повторите проверку."
                : status.error === "indeterminate"
                  ? "Не удалось подтвердить результат. Повторная проверка использует ту же операцию."
                  : status.error === "local-save"
                    ? "Не удалось сохранить результат на устройстве. Повторите операцию."
                    : status.error === "quota"
                      ? "Облако ограничило запросы или доступное место"
                      : status.error === "permission"
                        ? "Облако не предоставило нужные права"
                        : status.error === "remote-invalid"
                          ? "Данные облака повреждены. Данные устройства сохранены."
                          : status.error === "limit"
                            ? "Превышен допустимый размер снимка"
                            : null;
  if (!reason) return null;
  return (
    <aside className="drive-pause-banner" data-provider={id} data-active="true" role="status">
      <button type="button" onClick={() => controller.setDialog("account", "cloud")}>
        <span className="drive-pause-service">
          {t(id === "google-drive" ? "Google Диск" : "Яндекс Диск")}
        </span>
        <span className="drive-pause-reason">{t(reason)}</span>
        {status.pendingChanges && <span className="drive-pause-pending">{t("Не отправлено")}</span>}
      </button>
    </aside>
  );
}
export function CloudPauseBanner() {
  return (
    <>
      {CLOUD_PROVIDERS.map((id) => (
        <ProviderPause key={id} id={id} />
      ))}
    </>
  );
}

import { t } from "../../i18n/messages.js";
import { useTerminalController, useTerminalState } from "./context.js";
import type { TerminalState } from "./state.js";
import { terminalCloudSync } from "./controller-cloud-sync.js";
import { CloudProviderSettings } from "./CloudProviderSettings.js";
import { GoogleDriveSettings } from "./GoogleDriveSettings.js";

const selectLocale = (state: TerminalState) => state.preferences.locale;
export function CloudSyncSettings() {
  const controller = useTerminalController();
  useTerminalState(controller, selectLocale);
  return (
    <section id="cloud-sync-settings" className="transfer-settings cloud-sync-settings">
      <h3>{t("Облачная синхронизация")}</h3>
      <p>
        {t(
          "Настройки, инструменты, индикаторы, рисунки, изображения и сохранённые виды. Расположение всех окон пока не переносится."
        )}
      </p>
      <p>
        {t(
          "Каждое облако подключается отдельно. Ключ банка, история свечей и текущие котировки в облако не передаются."
        )}
      </p>
      <CloudProviderSettings provider={terminalCloudSync(controller, "google-drive")}>
        <GoogleDriveSettings />
      </CloudProviderSettings>
      <CloudProviderSettings provider={terminalCloudSync(controller, "yandex-disk")} />
    </section>
  );
}

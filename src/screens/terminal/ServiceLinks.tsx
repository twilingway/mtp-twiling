import { t } from "../../i18n/messages.js";

export function ServiceLinks({
  onHelp,
  helpLabel = t("Помощь")
}: {
  onHelp?: () => void;
  helpLabel?: string;
}) {
  return (
    <nav className="service-links" aria-label={t("Ссылки приложения")}>
      {onHelp && (
        <button type="button" onClick={onHelp}>
          {helpLabel}
        </button>
      )}
      <a href="https://github.com/twilingway/mtp-twiling" target="_blank" rel="noopener noreferrer">
        GitHub
      </a>
      <a
        href="./privacy.html"
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("Политика конфиденциальности")}
      >
        {t("Приватность")}
      </a>
    </nav>
  );
}

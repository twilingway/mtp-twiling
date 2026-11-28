import { useState } from "react";
import type { CloudDeleteTarget, CloudRemoteDeletion } from "../../model/cloud-sync.js";
import { t } from "../../i18n/messages.js";
import { intlLocale } from "../../i18n/preferences.js";

const reasons: Record<NonNullable<CloudRemoteDeletion["reason"]>, string> = {
  current: "Текущая версия защищена. Можно удалить предыдущую копию.",
  "last-head":
    "Это последняя независимая версия клиента. Сначала выберите и сохраните нужную версию.",
  legacy: "Старая версия формата защищена от ручного удаления.",
  conflict: "Сначала разрешите конфликт версий и повторите проверку.",
  unsupported: "Для удаления этой версии требуется обновление приложения."
};

export function CloudDeleteVersion({
  id,
  deletion,
  busy,
  blocked,
  retry = false,
  deleting = false,
  failed = false,
  target,
  onDelete
}: {
  id: string;
  deletion: CloudRemoteDeletion;
  busy: boolean;
  blocked: boolean;
  retry?: boolean;
  deleting?: boolean;
  failed?: boolean;
  target?: CloudDeleteTarget | undefined;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (deleting)
    return (
      <div className="cloud-delete-controls" aria-busy="true">
        <p role="status">{t("Удаляем…")}</p>
        <small>{t("Копия исчезнет из списка после подтверждения удаления облаком.")}</small>
      </div>
    );
  if (!deletion.allowed)
    return <p className="cloud-delete-protected">{t(reasons[deletion.reason ?? "current"])}</p>;
  return (
    <div className="cloud-delete-controls">
      {failed && (
        <p role="alert">
          {t("Удаление не подтверждено. Копия остаётся в списке. Повторите попытку.")}
        </p>
      )}
      {!confirming ? (
        <button type="button" disabled={busy || blocked} onClick={() => setConfirming(true)}>
          {t(retry ? "Проверить и продолжить удаление…" : "Удалить эту копию…")}
        </button>
      ) : (
        <div role="group" aria-label={t("Подтверждение удаления")}>
          <p>
            {t("Безвозвратно удалить выбранное сохранение из Яндекс Диска?")}{" "}
            <strong>{id.slice(0, 8)}</strong>
          </p>
          {target && (
            <dl className="cloud-delete-target">
              <dt>{t("Клиент")}</dt>
              <dd>{target.deviceId}</dd>
              <dt>{t("Снимок создан")}</dt>
              <dd>{new Date(target.date).toLocaleString(intlLocale())}</dd>
              <dt>{t("Копий к удалению")}</dt>
              <dd>{target.versions}</dd>
            </dl>
          )}
          {deletion.kind === "retired-peer" && (
            <p>{t("Будут удалены все сохранения выбранного старого клиента.")}</p>
          )}
          <p>
            {t(
              "Оставшиеся текущие версии и данные этого устройства сохранятся. Отменить удаление нельзя."
            )}
          </p>
          <button
            type="button"
            className="cloud-delete-confirm"
            disabled={busy || blocked}
            onClick={() => {
              setConfirming(false);
              onDelete(id);
            }}
          >
            {t("Удалить безвозвратно")}
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
            {t("Отмена")}
          </button>
        </div>
      )}
    </div>
  );
}

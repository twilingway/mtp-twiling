import type {
  CloudComparison,
  CloudSelection,
  CloudSummary,
  CloudProviderId,
  CloudSyncStatus
} from "../../model/cloud-sync.js";
import { t } from "../../i18n/messages.js";
import { intlLocale } from "../../i18n/preferences.js";
import { CloudDeleteVersion } from "./CloudDeleteVersion.js";
import { CloudRemoteVersions } from "./CloudRemoteVersions.js";

interface Props {
  id: CloudProviderId;
  comparison: Omit<CloudComparison, "checkedAt"> & { checkedAt?: string };
  busy: boolean;
  blocked: boolean;
  activeChoice?: CloudSelection | undefined;
  migration: boolean;
  receiveAvailable: boolean;
  clientId?: string | undefined;
  deleteAction?: CloudSyncStatus["deleteAction"] | undefined;
  onSend: () => void;
  onReceive: (id: string) => void;
  onDelete?: ((id: string) => void) | undefined;
}
function VersionDate({ value, local = false }: { value?: string | undefined; local?: boolean }) {
  const known = value && Number.isFinite(Date.parse(value));
  return (
    <p className="cloud-version-date">
      <span>{t(local ? "Проверено состояние" : "Снимок создан")}</span>
      {known ? (
        <time dateTime={value}>{new Date(value).toLocaleString(intlLocale())}</time>
      ) : (
        <strong>{t(local ? "Время проверки неизвестно" : "Дата снимка неизвестна")}</strong>
      )}
    </p>
  );
}
function Summary({ value }: { value: CloudSummary }) {
  return (
    <dl className="cloud-version-counts">
      <div>
        <dt>{t("Инструментов")}</dt>
        <dd>{value.instruments}</dd>
      </div>
      <div>
        <dt>{t("Рисунки")}</dt>
        <dd>{value.drawings}</dd>
      </div>
      <div>
        <dt>{t("Изображения")}</dt>
        <dd>{value.images}</dd>
      </div>
    </dl>
  );
}
export function CloudVersionComparison({
  id,
  comparison,
  busy,
  blocked,
  activeChoice,
  migration,
  receiveAvailable,
  clientId,
  deleteAction,
  onSend,
  onReceive,
  onDelete
}: Props) {
  const cloudTitle = id === "yandex-disk" ? "В Яндекс Диске" : "В Google Диске";
  const receiveEffect = migration
    ? "Перенос обновит старые сохранения в Google Диске и заменит данные на этом устройстве."
    : "Получение заменит поддерживаемые настройки, инструменты и разметку на устройстве. Снимки в облаке сохранятся.";
  return (
    <section id={`${id}-conflict`} className="cloud-comparison" aria-busy={busy}>
      <h4>{t("Сравнение версий")}</h4>
      <div className="cloud-comparison-local">
        <article className="cloud-version-card cloud-version-local">
          <h5>{t("На этом устройстве")}</h5>
          <VersionDate value={comparison.checkedAt} local />
          <Summary value={comparison.local} />
          <p id={`${id}-send-effect`}>
            {t(
              id === "yandex-disk"
                ? "Отправка сохранит текущую версию этого клиента и одну предыдущую копию."
                : "Отправка сохранит версию устройства в облаке. Предыдущие снимки сохранятся."
            )}
          </p>
          <p>{t("На устройстве ничего не заменяется.")}</p>
          <button
            type="button"
            id={`${id}-choose-local`}
            aria-describedby={`${id}-send-effect`}
            aria-busy={activeChoice?.kind === "local"}
            disabled={busy || blocked}
            onClick={onSend}
          >
            <span aria-hidden="true">↑</span>{" "}
            {t(activeChoice?.kind === "local" ? "Отправляем…" : "Отправить версию устройства")}
          </button>
        </article>
        {comparison.remotes.length === 0 && (
          <article className="cloud-version-card cloud-version-remote">
            <h5>{t(cloudTitle)}</h5>
            <p>{t("В облаке пока нет доступных снимков.")}</p>
          </article>
        )}
      </div>
      {comparison.remotes.length > 0 && (
        <p className="cloud-version-total">
          {t("Всего снимков в списке")}: <strong>{comparison.remotes.length}</strong>
          {id === "yandex-disk" && (
            <small>
              {t(
                "Для каждого клиента хранятся текущая и предыдущая версии. Сохранения других браузеров и тестового клиента считаются отдельно. Старые форматы показаны отдельно."
              )}
            </small>
          )}
        </p>
      )}
      <CloudRemoteVersions remotes={comparison.remotes} clientId={clientId}>
        {(remote, index) => {
          const selected = activeChoice?.kind === "remote" && activeChoice.id === remote.id;
          const deleting = deleteAction?.id === remote.id && deleteAction.state === "running";
          const failed =
            deleteAction?.id === remote.id &&
            (deleteAction.state === "unconfirmed" || deleteAction.state === "review");
          const description =
            index === 0 ? `${id}-receive-effect` : `${id}-receive-effect-${index}`;
          return (
            <article
              key={remote.id}
              className="cloud-version-card cloud-version-remote"
              data-cloud-version={remote.id}
              aria-busy={deleting}
            >
              <h5>{t(cloudTitle)}</h5>
              {remote.deviceLabel && <p className="cloud-version-device">{remote.deviceLabel}</p>}
              <p className="cloud-version-device" title={remote.id}>
                {t("Сохранение")} · {remote.id.slice(0, 8)}
              </p>
              <VersionDate value={remote.date} />
              {remote.deletion && (
                <p>
                  {t(
                    remote.deletion.kind === "previous"
                      ? "Предыдущая версия"
                      : remote.deletion.kind === "legacy"
                        ? "Сохранение старого формата"
                        : remote.deletion.kind === "retired-peer"
                          ? "Принятая версия старого клиента"
                          : "Текущая версия"
                  )}
                </p>
              )}
              <Summary value={remote} />
              <p id={description}>{t(receiveEffect)}</p>
              {!migration && <p>{t("Облачные версии не изменятся.")}</p>}
              <button
                type="button"
                data-cloud-remote={index}
                aria-describedby={description}
                aria-busy={selected}
                disabled={busy || blocked || !receiveAvailable}
                onClick={() => onReceive(remote.id)}
              >
                <span aria-hidden="true">↓</span>{" "}
                {t(
                  selected
                    ? "Получаем…"
                    : migration
                      ? "Перенести и получить"
                      : "Получить эту версию"
                )}
              </button>
              {onDelete && remote.deletion && (
                <CloudDeleteVersion
                  key={`${remote.id}:${comparison.checkedAt ?? ""}`}
                  id={remote.id}
                  deletion={remote.deletion}
                  target={
                    remote.deviceId && remote.date
                      ? {
                          deviceId: remote.deviceId,
                          date: remote.date,
                          versions: remote.deletion.versions ?? 1,
                          kind: remote.deletion.kind
                        }
                      : undefined
                  }
                  busy={busy}
                  blocked={blocked}
                  deleting={deleting}
                  failed={failed}
                  retry={failed}
                  onDelete={onDelete}
                />
              )}
            </article>
          );
        }}
      </CloudRemoteVersions>
    </section>
  );
}

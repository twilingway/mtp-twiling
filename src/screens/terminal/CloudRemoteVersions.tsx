import type { ReactNode } from "react";
import type { CloudRemoteChoice } from "../../model/cloud-sync.js";
import { CLOUD_TEST_CLIENT_ID } from "../../model/cloud-client-identity.js";
import { t } from "../../i18n/messages.js";

interface Group {
  id: string;
  title: string;
  own: boolean;
  versions: { remote: CloudRemoteChoice; index: number }[];
}

export function CloudRemoteVersions({
  remotes,
  clientId,
  children
}: {
  remotes: readonly CloudRemoteChoice[];
  clientId?: string | undefined;
  children: (remote: CloudRemoteChoice, index: number) => ReactNode;
}) {
  const groups = new Map<string, Group>();
  remotes.forEach((remote, index) => {
    const legacy = remote.deletion?.kind === "legacy";
    const id = legacy ? "legacy" : (remote.deviceId ?? "unknown");
    let group = groups.get(id);
    if (!group) {
      const own = !!clientId && remote.deviceId === clientId;
      const testing = remote.deviceId === CLOUD_TEST_CLIENT_ID;
      const title = legacy
        ? t("Старый формат")
        : testing
          ? `${t("Тестирование")}${own ? ` · ${t("Активный клиент")}` : ""}`
          : own
            ? t("Этот браузер")
            : remote.deviceId
              ? `${t("Другой браузер")} · ${remote.deviceId.slice(0, 8)}`
              : t("Клиент не указан");
      group = { id, title, own: own && !legacy, versions: [] };
      groups.set(id, group);
    }
    group.versions.push({ remote, index });
  });
  return [...groups.values()]
    .sort((a, b) => Number(b.own) - Number(a.own))
    .map((group) => {
      const current = group.versions.filter(
        ({ remote }) => !["previous", "legacy"].includes(remote.deletion?.kind ?? "")
      );
      const archived = group.versions.filter(
        ({ remote }) => remote.deletion?.kind === "previous" || remote.deletion?.kind === "legacy"
      );
      return (
        <section key={group.id} className="cloud-client-group" data-cloud-client={group.id}>
          <header className="cloud-client-group-heading">
            <h5>{group.title}</h5>
            <span>
              {t("Снимков")}: {group.versions.length}
            </span>
          </header>
          {current.length > 0 && (
            <div className="cloud-comparison-grid">
              {current.map(({ remote, index }) => children(remote, index))}
            </div>
          )}
          {archived.length > 0 && (
            <section className="cloud-version-archive">
              <h6>
                {t(group.id === "legacy" ? "Сохранения старого формата" : "Предыдущие копии")} ·{" "}
                {archived.length}
              </h6>
              <div className="cloud-comparison-grid">
                {archived.map(({ remote, index }) => children(remote, index))}
              </div>
            </section>
          )}
        </section>
      );
    });
}

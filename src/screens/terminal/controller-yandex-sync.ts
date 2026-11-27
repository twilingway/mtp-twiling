import type { CloudSyncProvider } from "../../model/cloud-sync.js";
import type { CloudSyncHost } from "./controller-cloud-host.js";
import type { YandexPublicConfig } from "../../services/yandex/types.js";
import { YandexCoordinator } from "../../services/yandex/coordinator.js";

export function createTerminalYandexSync(
  host: CloudSyncHost,
  config: YandexPublicConfig | undefined
): CloudSyncProvider {
  return new YandexCoordinator(host, config);
}
/** A diagnostic closure; the result exposes no credential, account ID or signed URL. */
export async function runTerminalYandexSyntheticProbe(
  provider: CloudSyncProvider,
  cleanup = false
) {
  if (!(provider instanceof YandexCoordinator)) throw new Error("Yandex provider required");
  return provider.runSyntheticProbe(cleanup);
}

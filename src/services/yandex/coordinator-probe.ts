import type { YandexAuthorization } from "./types.js";
import { YandexError } from "./types.js";
import { runYandexSyntheticProbe } from "./probe.js";
import type { yandexWriterLock } from "./journal.js";
import type { YandexSettings } from "./journal.js";
import type { CloudClientMode } from "../../model/cloud-sync.js";

export function yandexCoordinatorProbe(options: {
  authorization(): YandexAuthorization | undefined;
  enabled(): boolean;
  busy(): boolean;
  epoch(): number;
  settings(): Promise<readonly [YandexSettings, CloudClientMode | undefined]>;
  lock: typeof yandexWriterLock;
}) {
  return async (cleanup = false) => {
    const authorization = options.authorization(),
      epoch = options.epoch();
    if (!options.enabled() || !authorization) throw new YandexError("auth-required");
    if (options.busy()) throw new YandexError("busy");
    const result = await options.lock(authorization, async () => {
      const check = async () => {
        authorization.signal.throwIfAborted();
        if (
          epoch !== options.epoch() ||
          !options.enabled() ||
          authorization !== options.authorization()
        )
          throw new YandexError("auth-cancelled");
        const [settings, mode] = await options.settings();
        if (!settings.enabled || settings.clientMode !== mode)
          throw new YandexError("local-changed");
        authorization.signal.throwIfAborted();
        if (
          epoch !== options.epoch() ||
          !options.enabled() ||
          authorization !== options.authorization()
        )
          throw new YandexError("auth-cancelled");
      };
      await check();
      const result = await runYandexSyntheticProbe(authorization, {}, cleanup);
      await check();
      return result;
    });
    if (epoch !== options.epoch() || !options.enabled()) throw new YandexError("auth-cancelled");
    return result;
  };
}

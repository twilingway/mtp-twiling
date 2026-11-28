import type { YandexAuth } from "./auth.js";
import type { YandexJournal, yandexWriterLock } from "./journal.js";
import type { YandexTransport } from "./transport.js";
import type { YandexAuthorization } from "./types.js";

export type YandexAuthClient = Pick<
  YandexAuth,
  "begin" | "restore" | "completeCallback" | "suspend" | "disconnect"
>;
export interface YandexCoordinatorOptions {
  auth?: YandexAuthClient;
  journal?: YandexJournal;
  transport?: (authorization: YandexAuthorization) => YandexTransport;
  lock?: typeof yandexWriterLock;
  manualDeleteTimeoutMs?: number;
}

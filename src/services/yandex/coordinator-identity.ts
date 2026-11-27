import type { CloudClientMode, CloudSyncStatus } from "../../model/cloud-sync.js";
import { cloudClientLabel, defaultCloudClientMode } from "../../model/cloud-client-identity.js";
import type { CloudSyncHost } from "../../screens/terminal/controller-cloud-host.js";
import { YandexRevisions } from "./revisions.js";
import type { YandexRemote } from "./revisions.js";
import type { YandexJournal } from "./journal.js";
import type { YandexSettings } from "./journal.js";
import type { YandexStatusClear } from "./coordinator-status.js";
import type { YandexAuthorization } from "./types.js";
import { YandexError } from "./types.js";
import type { YandexTransport } from "./transport.js";

export const yandexClientStatus = (mode: CloudClientMode) => ({
  clientMode: mode,
  clientLabel: cloudClientLabel(mode)
});
interface ClientSettings {
  enabled: boolean;
  automatic: boolean;
  clientMode: CloudClientMode;
}
async function saveYandexClientSettings(
  previous: Promise<void>,
  journal: YandexJournal,
  settings: ClientSettings,
  changes: Partial<ClientSettings>
): Promise<void> {
  try {
    await previous.catch(() => undefined);
    const current = await journal.settings();
    Object.assign(
      settings,
      current,
      { clientMode: current.clientMode ?? settings.clientMode },
      changes
    );
    await journal.saveSettings(settings, new AbortController().signal);
  } catch {
    throw new YandexError("local-save");
  }
}
export function yandexPreparedClientStatus(
  settings: YandexSettings,
  automatic?: boolean,
  mode?: CloudClientMode
): Partial<CloudSyncStatus> {
  return {
    prepared: true,
    preparing: false,
    automatic: automatic ?? settings.automatic,
    ...yandexClientStatus(mode ?? settings.clientMode ?? "normal")
  };
}
export function yandexClientPreferences(
  previous: CloudSyncStatus,
  settings: YandexSettings & { clientMode: CloudClientMode }
) {
  const changedMode = settings.clientMode !== previous.clientMode;
  const unchangedEnabled = settings.enabled === previous.enabled;
  const patch: Partial<CloudSyncStatus> = {
    ...settings,
    ...yandexClientStatus(settings.clientMode),
    prepared: true,
    preparing: false,
    ...(!unchangedEnabled ? { phase: settings.enabled ? "disconnected" : "disabled" } : {})
  };
  const clear: YandexStatusClear[] =
    unchangedEnabled && !changedMode
      ? []
      : ["error", "pauseReason", "conflict", "choiceAction", "progress", "comparison"];
  return { changedMode, patch, clear };
}
export function initialYandexClientStatus(configured: boolean): CloudSyncStatus {
  const mode = defaultCloudClientMode(
    globalThis.location,
    !!globalThis.document?.querySelector?.('script[type="module"][src="/__dev/client.js"]')
  );
  return Object.freeze({
    provider: "yandex-disk",
    enabled: false,
    configured,
    prepared: false,
    preparing: false,
    connected: false,
    automatic: false,
    phase: "disabled",
    pendingChanges: false,
    authorizationStored: false,
    credentialSaveError: false,
    ...yandexClientStatus(mode)
  });
}
export function yandexIdentityOperation(options: {
  host: CloudSyncHost;
  auth: YandexAuthorization;
  operation: AbortController;
  current: () => boolean;
  transport: (authorization: YandexAuthorization) => YandexTransport;
  journal: YandexJournal;
  clientId: string;
  cache: Map<string, YandexRemote>;
  clientMode: CloudClientMode;
  automatic: boolean;
  refresh(settings: YandexSettings): void;
}) {
  const { host, auth, operation } = options,
    session = host.scope("yandex-disk").session;
  const guard = {
    signal: AbortSignal.any([operation.signal, auth.signal]),
    isCurrent: () =>
      options.current() &&
      host.scope("yandex-disk").ready &&
      host.scope("yandex-disk").session === session
  };
  const scopedAuth = { ...auth, signal: guard.signal };
  const revisions = new YandexRevisions(
    options.transport(scopedAuth),
    options.journal,
    scopedAuth,
    options.clientId,
    options.cache
  );
  const checkClientMode = async () => {
    guard.signal.throwIfAborted();
    const settings = await options.journal.settings();
    if (!guard.isCurrent() || settings.clientMode !== options.clientMode)
      throw new YandexError("local-changed");
    guard.signal.throwIfAborted();
    if (!guard.isCurrent()) throw new YandexError("local-changed");
    options.refresh(settings);
    return settings.enabled && (!options.automatic || settings.automatic);
  };
  return { guard, session, scopedAuth, revisions, checkClientMode };
}
export function yandexClientSettingsLock(run: () => Promise<void>): Promise<void> {
  const locks = globalThis.navigator?.locks;
  return locks ? locks.request("mtp:yandex:device:writer", run) : run();
}
interface ModeChange {
  prepare(): Promise<void>;
  current(): boolean;
  busy(): boolean;
  status(): CloudSyncStatus;
  save(mode: CloudClientMode): Promise<void>;
  journal: YandexJournal;
  clientId?: string | undefined;
  accountId(): string | undefined;
  serialize(run: () => Promise<void>): Promise<void>;
}
/** A failed/unknown operation remains recoverable; choosing a client never discards its journal. */
export class YandexClientIdentity {
  changing = false;
  desiredMode: CloudClientMode | undefined;
  private settingsQueue = Promise.resolve();
  save(
    journal: YandexJournal,
    settings: ClientSettings,
    enabled?: boolean,
    automatic?: boolean
  ): Promise<void> {
    this.settingsQueue = saveYandexClientSettings(this.settingsQueue, journal, settings, {
      ...(enabled === undefined ? {} : { enabled }),
      ...(automatic === undefined ? {} : { automatic }),
      ...(this.desiredMode === undefined ? {} : { clientMode: this.desiredMode })
    });
    return this.settingsQueue;
  }
  async change(mode: CloudClientMode, options: ModeChange): Promise<void> {
    if (mode !== "normal" && mode !== "test") throw new YandexError("local-save");
    if (this.changing || options.busy()) throw new YandexError("busy");
    this.changing = true;
    try {
      await options.prepare();
      if (!options.current()) return;
      if (options.busy()) throw new YandexError("busy");
      await options.serialize(async () => {
        if (!options.current()) return;
        const savedMode = (await options.journal.settings()).clientMode;
        if (savedMode === mode && options.status().clientMode === mode) return;
        const accountId = options.accountId();
        if (options.clientId && accountId) {
          const pending = await options.journal.pending(options.clientId, accountId),
            intent = await options.journal.applyIntent(options.clientId, accountId);
          if (pending || intent) throw new YandexError("indeterminate");
        }
        if (!options.current()) return;
        const previous = this.desiredMode;
        this.desiredMode = mode;
        try {
          await options.save(mode);
          if (this.desiredMode === mode) this.desiredMode = undefined;
        } catch (error) {
          if (this.desiredMode === mode) this.desiredMode = previous;
          throw error;
        }
      });
    } finally {
      this.changing = false;
    }
  }
}

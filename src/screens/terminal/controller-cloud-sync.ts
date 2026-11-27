import type { CloudProviderId, CloudSyncProvider } from "../../model/cloud-sync.js";
import type { TerminalController } from "./controller.js";
import {
  createCloudSyncHost,
  cloudHostIntent,
  cloudHostChanged,
  subscribeCloudHostCommit
} from "./controller-cloud-host.js";
import type { CloudSyncHost } from "./controller-cloud-host.js";
import {
  createTerminalGoogleSync,
  installTerminalGoogleSync,
  uninstallTerminalGoogleSync,
  portableStateSignature
} from "./controller-drive.js";
import { createTerminalYandexSync } from "./controller-yandex-sync.js";
import { yandexPublicConfig } from "../../services/cloud-public-config.js";
import { subscribeWorkspaceCamera } from "./controller-camera-sync.js";
import { subscribeWorkspaceAnnotations } from "./workspace-annotations.js";
import { recordCloudOperation } from "./cloud-operation-clock.js";

export const CLOUD_PROVIDERS: readonly CloudProviderId[] = ["google-drive", "yandex-disk"];
interface Registry {
  host: CloudSyncHost;
  providers: Map<CloudProviderId, CloudSyncProvider>;
  stop?: () => void;
  users: number;
  statusStops: Map<CloudProviderId, () => void>;
  callback?: () => void;
}
const registries = new WeakMap<TerminalController, Registry>();
function registry(controller: TerminalController): Registry {
  let value = registries.get(controller);
  if (!value) {
    value = {
      host: createCloudSyncHost(controller),
      providers: new Map(),
      statusStops: new Map(),
      users: 0
    };
    registries.set(controller, value);
  }
  return value;
}
export function terminalCloudSync(
  controller: TerminalController,
  id: CloudProviderId
): CloudSyncProvider {
  const value = registry(controller);
  const existing = value.providers.get(id);
  if (existing) return existing;
  const provider: CloudSyncProvider =
    id === "google-drive"
      ? createTerminalGoogleSync(value.host)
      : createTerminalYandexSync(value.host, yandexPublicConfig());
  value.providers.set(id, provider);
  recordCloudOperation(provider);
  value.statusStops.set(
    id,
    provider.subscribe(() => {
      recordCloudOperation(provider);
      value.callback?.();
    })
  );
  if (id === "google-drive") installTerminalGoogleSync(controller, provider);
  return provider;
}
function observe(value: Registry, action: (provider: CloudSyncProvider) => void): void {
  value.providers.forEach((provider) => {
    try {
      action(provider);
    } catch {
      /* Optional cloud state never interrupts local editing. */
    }
  });
}
export function startTerminalCloudSync(controller: TerminalController): () => void {
  const value = registry(controller);
  CLOUD_PROVIDERS.forEach((id) => terminalCloudSync(controller, id));
  value.users++;
  if (!value.stop) {
    let callbackPrepared = false;
    const prepareCallback = () => {
      if (
        callbackPrepared ||
        typeof location === "undefined" ||
        !location.pathname.endsWith("/yandex-callback.html")
      )
        return;
      const provider = value.providers.get("yandex-disk"),
        status = provider?.getSnapshot();
      if (
        !provider ||
        !status?.enabled ||
        !status.configured ||
        !value.host.scope("yandex-disk").ready
      )
        return;
      callbackPrepared = true;
      void provider.prepare().catch(() => {});
    };
    value.callback = prepareCallback;
    let previous = controller.getSnapshot();
    let signature = portableStateSignature(previous);
    const changed = () => {
      const source = cloudHostChanged(value.host);
      observe(value, (provider) => {
        if (provider.id !== source && provider.getSnapshot().enabled) provider.localChanged();
      });
    };
    const intent = () => {
      cloudHostIntent(value.host);
      observe(value, (provider) => {
        if (provider.getSnapshot().enabled) provider.localIntent();
      });
    };
    const stopCommit = subscribeCloudHostCommit(value.host, (source) => {
      observe(value, (provider) => {
        if (provider.id !== source && provider.getSnapshot().enabled) provider.localChanged();
      });
    });
    const stopCamera = subscribeWorkspaceCamera(controller, (kind) => {
      if (kind === "intent") intent();
      else changed();
    });
    const stopAnnotations = subscribeWorkspaceAnnotations(({ owner, symbol }) => {
      const state = controller.getSnapshot();
      if (state.owner === owner && state.preferences.symbol !== symbol) changed();
    });
    const stopController = controller.subscribe(() => {
      const state = controller.getSnapshot();
      try {
        if (state.profileTransition && !previous.profileTransition) intent();
        if (
          state.preferences !== previous.preferences ||
          state.rows !== previous.rows ||
          state.drawings !== previous.drawings ||
          state.images !== previous.images
        ) {
          const next = portableStateSignature(state);
          if (
            next !== signature ||
            state.images.some((image, index) => image.blob !== previous.images[index]?.blob)
          )
            changed();
          signature = next;
        }
        observe(value, (provider) => provider.profileChanged());
        prepareCallback();
      } finally {
        previous = state;
      }
    });
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      observe(value, (provider) => {
        const status = provider.getSnapshot();
        if (status.enabled && status.automatic && status.phase !== "conflict")
          if (provider.id === "yandex-disk") provider.resume();
          else void provider.sync().catch(() => {});
      });
    };
    const timer = setInterval(wake, 60_000);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    window.addEventListener("offline", wake);
    document.addEventListener("visibilitychange", wake);
    observe(value, (provider) => provider.resume());
    prepareCallback();
    value.stop = () => {
      clearInterval(timer);
      stopController();
      stopCamera();
      stopAnnotations();
      stopCommit();
      value.statusStops.forEach((stop) => stop());
      value.statusStops.clear();
      delete value.callback;
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", wake);
      document.removeEventListener("visibilitychange", wake);
      observe(value, (provider) => provider.dispose());
      const google = value.providers.get("google-drive");
      if (google) uninstallTerminalGoogleSync(controller, google);
    };
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    if (--value.users === 0) {
      value.stop?.();
      delete value.stop;
      value.providers.clear();
    }
  };
}

import { DriveAuth } from "../../services/drive/auth.js";
import { DriveSync } from "../../services/drive/sync.js";
import { DriveTransport } from "../../services/drive/transport.js";
import { DriveCoordinator } from "../../services/drive/coordinator.js";
import { loadDriveRecord, saveDriveRecord } from "../../services/drive/local.js";
import { sanitizeDriveBackup } from "../../services/drive/backup.js";
import type { TerminalController } from "./controller.js";
import type { TerminalState } from "./state.js";
import { cameraPending, flushCamera, subscribeCamera } from "./controller-camera-sync.js";
import { optionalDriveObserver } from "./controller-drive-observer.js";
import { driveWorkspaceBinding } from "../../services/drive/workspace-binding.js";
import { LEGACY_DRIVE_NAMESPACE } from "../../services/drive/types.js";
import { activeWorkspaceChart } from "./workspace-active-chart.js";
import { subscribeWorkspaceAnnotations } from "./workspace-annotations.js";
import { GoogleSlotProvider } from "../../services/drive/device-slot-provider.js";
import type { GoogleSlotHost } from "../../services/drive/device-slot-provider.js";
import type { CloudSyncProvider } from "../../model/cloud-sync.js";

const drives = new WeakMap<TerminalController, DriveCoordinator>();
const retentionProviders = new WeakMap<TerminalController, GoogleSlotProvider>();

export function createTerminalGoogleSync(host: GoogleSlotHost): GoogleSlotProvider {
  return new GoogleSlotProvider(host);
}

export function installTerminalGoogleSync(
  controller: TerminalController,
  provider: CloudSyncProvider
): void {
  if (!(provider instanceof GoogleSlotProvider))
    throw new TypeError("Invalid Google sync provider");
  if (drives.has(controller)) throw new Error("Legacy Google sync provider already created");
  const current = retentionProviders.get(controller);
  if (current && current !== provider) throw new Error("Google sync provider already installed");
  retentionProviders.set(controller, provider);
}

export function uninstallTerminalGoogleSync(
  controller: TerminalController,
  provider: CloudSyncProvider
): void {
  if (retentionProviders.get(controller) === provider) retentionProviders.delete(controller);
}

export function terminalGoogleRetention(
  controller: TerminalController
): GoogleSlotProvider | undefined {
  return retentionProviders.get(controller);
}
export function terminalDrive(controller: TerminalController): DriveCoordinator {
  if (terminalGoogleRetention(controller))
    throw new Error("Google sync retention provider is active");
  let drive = drives.get(controller);
  if (!drive) {
    drive = new DriveCoordinator(
      {
        profile: () => {
          const state = controller.getSnapshot();
          const chart = activeWorkspaceChart(controller).getSnapshot();
          return {
            owner: state.owner,
            session: controller.cloudSessionKey(),
            authenticated: !!controller.workspaceBinding(),
            ...driveWorkspaceBinding(controller.workspaceBinding()),
            transition: !!state.profileTransition,
            blocked: !!(
              state.profileTransition ||
              cameraPending(controller) ||
              state.backupBusy ||
              state.importingBackup ||
              state.importRecoveryRequired ||
              state.loading ||
              chart.loading ||
              chart.preview ||
              chart.activeTool ||
              (chart.dialog && chart.dialog !== "account") ||
              state.preview ||
              state.activeTool ||
              (state.dialog && state.dialog !== "account")
            )
          };
        },
        exportBackup: async () => {
          await flushCamera(controller);
          return controller.exportBackup(false, { captureView: false });
        },
        importBackup: (backup, options) => controller.importBackup(backup, options)
      },
      {
        auth: new DriveAuth(),
        online: () => navigator.onLine,
        sync: (authorization) => new DriveSync(new DriveTransport(authorization)),
        legacySync: (authorization) =>
          new DriveSync(
            new DriveTransport(authorization, { namespace: LEGACY_DRIVE_NAMESPACE }),
            LEGACY_DRIVE_NAMESPACE
          ),
        load: loadDriveRecord,
        save: saveDriveRecord
      }
    );
    drives.set(controller, drive);
  }
  return drive;
}

/** Quote ticks never count as portable edits. Pixel blobs are compared by local identity. */
export function portableStateSignature(state: TerminalState): string {
  const watchlist = sanitizeDriveBackup({
    application: "personal-terminal",
    schemaVersion: 2,
    drawings: [],
    images: [],
    watchlist: state.rows
  }).watchlist;
  return JSON.stringify([
    state.preferences,
    watchlist,
    state.drawings,
    state.images.map((image) => [
      image.id,
      image.syncId,
      image.symbol,
      image.name,
      image.point,
      image.width,
      image.zOrder,
      image.lock,
      image.visible,
      image.blob.size,
      image.blob.type
    ])
  ]);
}

export function startTerminalDrive(controller: TerminalController): () => void {
  if (terminalGoogleRetention(controller)) return () => {};
  const drive = terminalDrive(controller),
    observer = optionalDriveObserver(controller, drive);
  const unsubscribeCamera = subscribeCamera(controller, (kind) => {
    observer.run(() => {
      if (kind === "intent") drive.localIntent();
      else drive.localChanged();
    });
  });
  const unsubscribeAnnotations = subscribeWorkspaceAnnotations(({ owner, symbol }) => {
    const state = controller.getSnapshot();
    if (state.owner === owner && state.preferences.symbol !== symbol)
      observer.run(() => drive.localChanged());
  });
  let previous = controller.getSnapshot(),
    signature: string | undefined;
  observer.run(() => {
    signature = portableStateSignature(previous);
    drive.resume();
  });
  const unsubscribe = controller.subscribe(() => {
    const state = controller.getSnapshot();
    try {
      observer.run(() => {
        drive.profileChanged();
        if (
          state.preferences !== previous.preferences ||
          state.rows !== previous.rows ||
          state.drawings !== previous.drawings ||
          state.images !== previous.images
        ) {
          const next = portableStateSignature(state);
          if (
            signature !== next ||
            state.images.some((image, index) => image.blob !== previous.images[index]?.blob)
          )
            drive.localChanged();
          signature = next;
        }
      });
    } finally {
      previous = state;
    }
  });
  const wake = () => {
    observer.run(() => {
      if (
        document.visibilityState === "visible" &&
        drive.getSnapshot().automatic &&
        drive.getSnapshot().phase !== "conflict"
      )
        void drive.sync();
    });
  };
  const timer = setInterval(wake, 60000);
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
  window.addEventListener("offline", wake);
  document.addEventListener("visibilitychange", wake);
  return () => {
    unsubscribe();
    unsubscribeCamera();
    unsubscribeAnnotations();
    clearInterval(timer);
    window.removeEventListener("focus", wake);
    window.removeEventListener("online", wake);
    window.removeEventListener("offline", wake);
    document.removeEventListener("visibilitychange", wake);
    observer.stop();
  };
}

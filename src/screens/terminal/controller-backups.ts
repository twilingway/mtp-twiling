import * as storage from "../../services/storage-v2.js";
import { assertImportCurrent, type BackupImportOptions } from "../../model/backup-import.js";
import { importTerminalBackup, restoreImportedProfile } from "./controller-import.js";
import type { BackupExportOptions } from "../../model/backup-export.js";
import type {
  ExportStorageObserver,
  FileImportObserver
} from "../../model/backup-transfer-progress.js";

type Bridge = Parameters<typeof importTerminalBackup>[1] & {
  flush: (options?: BackupExportOptions) => Promise<void>;
  isAlive: () => boolean;
  session: Parameters<typeof importTerminalBackup>[1]["session"] & { start?: () => Promise<void> };
};

/** Public transfers are serial per profile; internal flush never waits on this queue. */
export class TerminalBackups {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(private readonly bridge: Bridge) {}
  async settle(): Promise<void> {
    await Promise.allSettled(this.pending.values());
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const { owner } = this.bridge.getState(),
      client = this.bridge.getClient();
    const valid = () =>
      this.bridge.isAlive() &&
      !this.bridge.getState().profileTransition &&
      !this.bridge.getState().workspaceMigrationIncomplete &&
      this.bridge.getState().owner === owner &&
      this.bridge.getClient() === client;
    const task = (this.pending.get(owner) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!valid()) throw new DOMException("Профиль изменился. Повторите перенос.", "AbortError");
        this.bridge.update({ backupBusy: true });
        try {
          const result = await operation();
          if (!valid())
            throw new DOMException("Профиль изменился. Повторите перенос.", "AbortError");
          return result;
        } finally {
          if (this.bridge.isAlive() && this.bridge.getState().owner === owner)
            this.bridge.update({ backupBusy: false, importingBackup: false });
        }
      });
    const settled = task.then(
      () => {},
      () => {}
    );
    this.pending.set(owner, settled);
    void settled.then(() => {
      if (this.pending.get(owner) === settled) this.pending.delete(owner);
    });
    return task;
  }
  export = (
    includeHistory: boolean,
    options?: BackupExportOptions,
    onProgress?: ExportStorageObserver
  ) =>
    this.enqueue(async () => {
      const { owner } = this.bridge.getState();
      onProgress?.("flush");
      await this.bridge.flush(options);
      onProgress?.("collect");
      return storage.createBackup(owner, { includeHistory });
    });
  private importNow = (
    input: unknown,
    options: BackupImportOptions = {},
    onProgress?: FileImportObserver
  ): Promise<void> =>
    importTerminalBackup(
      input,
      {
        ...this.bridge,
        saveView: async () => {
          const { owner } = this.bridge.getState(),
            client = this.bridge.getClient();
          await this.bridge.saveView();
          if (
            this.bridge.isAlive() &&
            this.bridge.getState().owner === owner &&
            this.bridge.getClient() === client
          )
            this.bridge.update({ importingBackup: true });
        }
      },
      options,
      onProgress
    );
  import = (input: unknown, options: BackupImportOptions = {}): Promise<void> =>
    this.enqueue(() => {
      assertImportCurrent(options.valid);
      return this.importNow(input, options);
    });
  importFile = (
    file: Pick<File, "size" | "text">,
    onProgress?: FileImportObserver
  ): Promise<void> =>
    this.enqueue(async () => {
      if (file.size > 256 * 1024 * 1024) throw new Error("Для импорта допустим файл до 256 МБ.");
      const { owner } = this.bridge.getState(),
        client = this.bridge.getClient();
      const checkScope = () => {
        if (
          !this.bridge.isAlive() ||
          this.bridge.getState().owner !== owner ||
          this.bridge.getState().profileTransition ||
          this.bridge.getClient() !== client
        )
          throw new DOMException("Профиль изменился. Повторите перенос.", "AbortError");
      };
      onProgress?.({ stage: "read" });
      const text = await file.text();
      checkScope();
      if (onProgress) {
        onProgress({ stage: "validate" });
        // Let the dialog show the stage before synchronous JSON parsing.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        checkScope();
      }
      const input: unknown = JSON.parse(text);
      await this.importNow(input, undefined, onProgress);
    });
  recover = (preserveStoredCamera?: boolean): Promise<void> => {
    const state = this.bridge.getState();
    if (state.importRecoveryRequired && state.workspaceMigrationIncomplete) {
      return (
        this.bridge.session.start?.() ??
        Promise.reject(new Error("Повторите запуск приложения для восстановления."))
      );
    }
    return this.enqueue(async () => {
      this.bridge.update({ importingBackup: true, importRecoveryRequired: false });
      await restoreImportedProfile(this.bridge, undefined, preserveStoredCamera);
    });
  };
}

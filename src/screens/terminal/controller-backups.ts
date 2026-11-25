import * as storage from "../../services/storage.js";
import { assertImportCurrent, type BackupImportOptions } from "../../model/backup-import.js";
import { importTerminalBackup, restoreImportedProfile } from "./controller-import.js";

type Bridge = Parameters<typeof importTerminalBackup>[1] & {
  flush: () => Promise<void>;
  isAlive: () => boolean;
};

/** Public transfers are serial per profile; internal flush never waits on this queue. */
export class TerminalBackups {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(private readonly bridge: Bridge) {}
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const { owner } = this.bridge.getState(),
      client = this.bridge.getClient();
    const valid = () =>
      this.bridge.isAlive() &&
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
  export = (includeHistory: boolean) =>
    this.enqueue(async () => {
      const { owner } = this.bridge.getState();
      await this.bridge.flush();
      return storage.createBackup(owner, { includeHistory });
    });
  private importNow = (input: unknown, options: BackupImportOptions = {}): Promise<void> =>
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
      options
    );
  import = (input: unknown, options: BackupImportOptions = {}): Promise<void> =>
    this.enqueue(() => {
      assertImportCurrent(options.valid);
      return this.importNow(input, options);
    });
  importFile = (file: Pick<File, "size" | "text">): Promise<void> =>
    this.enqueue(async () => {
      if (file.size > 256 * 1024 * 1024) throw new Error("Для импорта допустим файл до 256 МБ.");
      const { owner } = this.bridge.getState(),
        client = this.bridge.getClient();
      const text = await file.text();
      if (
        !this.bridge.isAlive() ||
        this.bridge.getState().owner !== owner ||
        this.bridge.getClient() !== client
      )
        throw new DOMException("Профиль изменился. Повторите перенос.", "AbortError");
      const input: unknown = JSON.parse(text);
      await this.importNow(input);
    });
  recover = (): Promise<void> =>
    this.enqueue(async () => {
      this.bridge.update({ importingBackup: true, importRecoveryRequired: false });
      await restoreImportedProfile(this.bridge);
    });
}

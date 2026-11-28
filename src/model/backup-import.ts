/** Callbacks are local transfer guards; never part of a serialized backup. */
export interface BackupImportRecovery {
  readonly owner: string;
  readonly operationId: string;
}
export interface BackupImportOptions {
  replacePortable?: boolean;
  valid?: () => boolean;
  onCommitted?: () => void;
  signal?: AbortSignal;
  /** Internal identity committed atomically with the import; never part of a backup. */
  restoreRecovery?: BackupImportRecovery;
}

export function assertImportCurrent(valid?: () => boolean, signal?: AbortSignal): void {
  if (signal?.aborted || (valid && !valid()))
    throw new DOMException("Локальные данные изменились. Повторите синхронизацию.", "AbortError");
}

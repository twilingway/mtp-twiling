/** Callbacks are local transfer guards; never part of a serialized backup. */
export interface BackupImportOptions {
  replacePortable?: boolean;
  valid?: () => boolean;
  onCommitted?: () => void;
  signal?: AbortSignal;
}

export function assertImportCurrent(valid?: () => boolean, signal?: AbortSignal): void {
  if (signal?.aborted || (valid && !valid()))
    throw new DOMException("Локальные данные изменились. Повторите синхронизацию.", "AbortError");
}

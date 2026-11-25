/** Callbacks are local transfer guards; never part of a serialized backup. */
export interface BackupImportOptions {
  replacePortable?: boolean;
  valid?: () => boolean;
  onCommitted?: () => void;
}

export function assertImportCurrent(valid?: () => boolean): void {
  if (valid && !valid())
    throw new DOMException("Локальные данные изменились. Повторите синхронизацию.", "AbortError");
}

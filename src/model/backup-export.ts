import { providerRefFromId, providerRefFromViewKey } from "./market-provider.js";
import type { Backup } from "./types.js";

export interface BackupExportOptions {
  /** Drive exports already persisted user views; manual JSON retains live capture by default. */
  captureView?: boolean;
}

/** Older Drive readers reject this field before replacing a head they cannot fully support. */
export function withRequiredProviders(backup: Backup): Backup {
  if (backup.schemaVersion !== 2 || backup.requiredProviders) return backup;
  const isOkx = (id: unknown) => providerRefFromId(id)?.provider === "okx";
  const layout = backup.layout;
  const containsOkx =
    isOkx(layout?.symbol) ||
    isOkx(layout?.instrumentUid) ||
    layout?.providerRef?.provider === "okx" ||
    Object.keys(layout?.watchlistFlags ?? {}).some((key) =>
      isOkx(key.slice(key.indexOf(":") + 1))
    ) ||
    layout?.watchlistSections?.entries.some(
      (entry) => entry.kind === "instrument" && (isOkx(entry.uid) || isOkx(entry.symbol))
    ) ||
    backup.watchlist?.some((row) => isOkx(row.uid) || isOkx(row.symbol)) ||
    backup.drawings.some(({ symbol }) => isOkx(symbol)) ||
    backup.images.some(({ symbol }) => isOkx(symbol)) ||
    backup.views?.some(({ key }) => providerRefFromViewKey(key)?.provider === "okx") ||
    backup.history?.some(({ uid }) => isOkx(uid));
  return containsOkx ? { ...backup, requiredProviders: ["okx"] } : backup;
}

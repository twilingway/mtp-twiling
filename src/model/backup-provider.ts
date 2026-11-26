import {
  isProviderRef,
  isReservedProviderId,
  providerRefFromId,
  providerRefFromViewKey,
  validProviderIdentity
} from "./market-provider.js";

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function validLayoutProvider(value: Record<string, unknown>): boolean {
  if (value.providerRef !== undefined && !isProviderRef(value.providerRef)) return false;
  return validProviderIdentity({
    providerRef: value.providerRef,
    uid: value.instrumentUid,
    symbol: value.symbol
  });
}
export function validRowProvider(value: Record<string, unknown>): boolean {
  return validProviderIdentity({
    providerRef: value.providerRef,
    uid: value.uid,
    symbol: value.symbol
  });
}
/** A v1 reader/writer cannot preserve provider identity; never admit provider payload into v1. */
export function validBackupProviders(value: Record<string, unknown>): boolean {
  const schema = value.schemaVersion;
  if (schema !== 1 && schema !== 2) return false;
  if (schema === 1 && value.requiredProviders !== undefined) return false;
  const visit = (item: unknown): boolean => {
    if (Array.isArray(item)) return item.every(visit);
    if (object(item)) {
      if (item.providerRef !== undefined && schema !== 2) return false;
      return Object.entries(item).every(([key, child]) => {
        // View keys add interval/engine/range suffixes; UID flag keys add an explicit prefix.
        const flagId = key.startsWith("uid:")
          ? key.slice(4)
          : key.startsWith("legacy:")
            ? key.slice(7)
            : null;
        if (isReservedProviderId(flagId) && (schema !== 2 || !providerRefFromId(flagId)))
          return false;
        if (isReservedProviderId(child)) {
          if (key === "key") return schema === 2 && !!providerRefFromViewKey(child);
          if (key === "uid" || key === "symbol" || key === "instrumentUid")
            return schema === 2 && providerRefFromId(child) !== null;
        }
        return visit(child);
      });
    }
    return true;
  };
  return visit(value);
}

import type { YandexAssociation } from "./journal.js";
import { object, uuidPattern, hashPattern, YandexError } from "./types.js";

export function readYandexAssociation(
  value: unknown,
  accountId: string
): YandexAssociation | undefined {
  if (value === undefined) return undefined;
  const v = object(value);
  if (
    !v ||
    v.version !== 1 ||
    v.accountId !== accountId ||
    !Array.isArray(v.heads) ||
    v.heads.length > 1000 ||
    !v.heads.every((head: unknown) => typeof head === "string" && uuidPattern.test(head)) ||
    new Set(v.heads).size !== v.heads.length ||
    typeof v.digest !== "string" ||
    !hashPattern.test(v.digest) ||
    typeof v.syncedAt !== "string" ||
    !Number.isFinite(Date.parse(v.syncedAt))
  )
    throw new YandexError("local-save");
  return {
    version: 1,
    accountId,
    heads: [...(v.heads as string[])],
    digest: v.digest,
    syncedAt: v.syncedAt
  };
}

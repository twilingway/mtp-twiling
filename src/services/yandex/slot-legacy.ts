import { revisionHeads } from "./bundle.js";
import type { YandexRevision } from "./bundle.js";

/** Missing legacy parents do not prevent reading a complete immutable backup body. */
export function legacyYandexHeads(
  legacy: readonly YandexRevision[],
  slots: readonly YandexRevision[]
) {
  const own = new Set(legacy.map(({ revisionId }) => revisionId)),
    known = new Set([...own, ...slots.map(({ revisionId }) => revisionId)]),
    knownParents = new Set(legacy.flatMap((revision) => revision.parents)),
    heads = legacy.every(({ parents }) => parents.every((id) => own.has(id)))
      ? revisionHeads(legacy)
      : legacy
          .filter(
            ({ revisionId, parents }) =>
              parents.some((id) => !known.has(id)) || !knownParents.has(revisionId)
          )
          .map(({ revisionId }) => revisionId),
    map = new Map([...legacy, ...slots].map((revision) => [revision.revisionId, revision])),
    accepted = new Set<string>(),
    pending = [...heads];
  while (pending.length) {
    const id = pending.pop()!;
    if (accepted.has(id)) continue;
    accepted.add(id);
    pending.push(...(map.get(id)?.parents ?? []));
  }
  return { heads, accepted };
}

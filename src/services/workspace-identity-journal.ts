import { db, get, put, transaction } from "./storage-db.js";
import { requestValue } from "./storage-guest-records.js";
import { isRecord, validateBackup } from "../model/backup-format.js";
import { normalizeLocalProfileSelection } from "./types.js";
import { DEVICE_PHYSICAL_OWNER, mergeDeviceWorkspace } from "../model/workspace-identity.js";
import { DEVICE_OWNER } from "../model/workspace-identity-types.js";
import type {
  DeviceWorkspaceBinding,
  DeviceWorkspaceOptions,
  WorkspaceSource
} from "../model/workspace-identity-types.js";
import {
  discoverWorkspaceOwners,
  ownerName,
  readWorkspaceSource,
  WORKSPACE_STORES
} from "./workspace-identity-sources.js";
import { chooseCloudOwner } from "./workspace-identity-cloud.js";
import {
  stagePresentation,
  applyPresentation,
  validatePresentationEntry,
  presentationOwners,
  preservedUnboundV1
} from "./workspace-identity-presentation.js";
import type { PresentationEntry } from "./workspace-identity-presentation.js";
import { hydrateDevicePresentation } from "./workspace-identity-local.js";

export const DEVICE_WORKSPACE_JOURNAL = "device-workspace-migration:v1";
const overlayPrefix = "device-workspace-local:";
interface Journal {
  id: typeof DEVICE_WORKSPACE_JOURNAL;
  version: 1;
  phase: "committed" | "applied" | "fallback";
  binding: DeviceWorkspaceBinding;
  presentation: PresentationEntry[];
}
export class WorkspaceMigrationError extends Error {
  constructor(
    public readonly code:
      "source-invalid" | "limit-exceeded" | "journal-invalid" | "storage-failed",
    public readonly fallbackOwner: string
  ) {
    super(
      "Не удалось завершить перенос локального рабочего пространства. Исходные данные сохранены."
    );
    this.name = "WorkspaceMigrationError";
  }
}
function check(options: DeviceWorkspaceOptions): void {
  if (options.signal?.aborted || !options.valid())
    throw new DOMException("Подготовка рабочего пространства отменена.", "AbortError");
}
function parseJournal(raw: unknown): Journal | undefined {
  if (raw === undefined) return undefined;
  if (
    !isRecord(raw) ||
    raw.id !== DEVICE_WORKSPACE_JOURNAL ||
    raw.version !== 1 ||
    !["committed", "applied", "fallback"].includes(String(raw.phase)) ||
    Object.keys(raw).some(
      (key) => !["id", "version", "phase", "binding", "presentation"].includes(key)
    ) ||
    !isRecord(raw.binding) ||
    !Array.isArray(raw.presentation)
  )
    throw new WorkspaceMigrationError("journal-invalid", "public");
  const binding = raw.binding;
  if (
    binding.owner !== DEVICE_OWNER ||
    Object.keys(binding).some(
      (key) => !["owner", "primaryOwner", "cloudOwner", "legacyOwners", "conflicts"].includes(key)
    ) ||
    !ownerName(binding.primaryOwner) ||
    !ownerName(binding.cloudOwner) ||
    !Array.isArray(binding.legacyOwners) ||
    !binding.legacyOwners.every(ownerName) ||
    !Array.isArray(binding.conflicts) ||
    binding.conflicts.some(
      (entry: unknown) =>
        !isRecord(entry) ||
        !ownerName(entry.sourceOwner) ||
        !["preferences", "view", "presentation", "object-remap", "cloud-association"].includes(
          String(entry.kind)
        ) ||
        typeof entry.key !== "string" ||
        typeof entry.recoveryRef !== "string"
    )
  )
    throw new WorkspaceMigrationError("journal-invalid", "public");
  for (const entry of raw.presentation) {
    if (!isRecord(entry) || typeof entry.key !== "string" || typeof entry.value !== "string")
      throw new WorkspaceMigrationError("journal-invalid", binding.primaryOwner);
    try {
      validatePresentationEntry({ key: entry.key, value: entry.value });
    } catch {
      throw new WorkspaceMigrationError("journal-invalid", binding.primaryOwner);
    }
  }
  return raw as unknown as Journal;
}
async function finishJournal(journal: Journal): Promise<DeviceWorkspaceBinding> {
  const tx = db.transaction("preferences"),
    pref = tx.objectStore("preferences");
  const [overlays, marker, layout, watchlist, market] = await Promise.all([
    requestValue<unknown[]>(
      pref.getAll(IDBKeyRange.bound(overlayPrefix, `${overlayPrefix}\uffff`))
    ),
    requestValue<unknown>(pref.get("v2-profile-ready:device")),
    requestValue<unknown>(pref.get(`layout:${DEVICE_PHYSICAL_OWNER}`)),
    requestValue<unknown>(pref.get(`watchlist:${DEVICE_PHYSICAL_OWNER}`)),
    requestValue<unknown>(pref.get(`market:${DEVICE_PHYSICAL_OWNER}`))
  ]);
  if (!isRecord(marker) || marker.owner !== DEVICE_PHYSICAL_OWNER || marker.value !== true)
    throw new WorkspaceMigrationError("journal-invalid", journal.binding.primaryOwner);
  try {
    for (const [kind, raw] of [
      ["layout", layout],
      ["watchlist", watchlist],
      ["market", market]
    ] as const)
      if (
        !isRecord(raw) ||
        raw.id !== `${kind}:${DEVICE_PHYSICAL_OWNER}` ||
        raw.owner !== DEVICE_PHYSICAL_OWNER
      )
        throw new Error("Canonical workspace record is missing or belongs to another owner");
    if (
      !isRecord(layout) ||
      !isRecord(layout.value) ||
      !isRecord(watchlist) ||
      !Array.isArray(watchlist.value) ||
      !isRecord(market) ||
      !isRecord(market.value) ||
      !Array.isArray(market.value.rows) ||
      !Number.isFinite(market.value.at)
    )
      throw new Error("Canonical workspace baseline is invalid");
    validateBackup({
      application: "personal-terminal",
      schemaVersion: 2,
      drawings: [],
      images: [],
      layout: normalizeLocalProfileSelection(layout.value),
      watchlist: watchlist.value
    });
    validateBackup({
      application: "personal-terminal",
      schemaVersion: 2,
      drawings: [],
      images: [],
      watchlist: market.value.rows
    });
  } catch {
    throw new WorkspaceMigrationError("journal-invalid", journal.binding.primaryOwner);
  }
  const presentation = new Map(journal.presentation.map(({ key, value }) => [key, value]));
  for (const raw of overlays) {
    if (
      !isRecord(raw) ||
      typeof raw.key !== "string" ||
      typeof raw.value !== "string" ||
      raw.id !== `${overlayPrefix}${raw.key}`
    )
      throw new WorkspaceMigrationError("journal-invalid", journal.binding.primaryOwner);
    validatePresentationEntry({ key: raw.key, value: raw.value });
    presentation.set(raw.key, raw.value);
  }
  const entries = [...presentation].map(([key, value]) => ({ key, value }));
  hydrateDevicePresentation(entries, (key, value) => {
    validatePresentationEntry({ key, value });
    void put("preferences", { id: `${overlayPrefix}${key}`, key, value }).catch(() => {
      globalThis.dispatchEvent?.(new Event("workspace-storage-error"));
    });
  });
  const phase = applyPresentation(entries);
  if (journal.phase !== phase) {
    // Failure to update this completion hint cannot erase the committed, validated fallback.
    await put("preferences", { ...journal, phase }).catch(() => {});
  }
  return structuredClone(journal.binding);
}
/** A ready journal is authoritative. Auth changes never rescan or resurrect legacy data. */
export async function prepareDeviceWorkspace(
  options: DeviceWorkspaceOptions
): Promise<DeviceWorkspaceBinding> {
  check(options);
  let fallbackOwner = ownerName(options.preferredOwner) ? options.preferredOwner : "public";
  try {
    const ready = parseJournal(await get("preferences", DEVICE_WORKSPACE_JOURNAL));
    if (ready) return await finishJournal(ready);
    const discovery = await discoverWorkspaceOwners();
    if (options.preferredOwner && !ownerName(options.preferredOwner))
      throw new WorkspaceMigrationError("source-invalid", "public");
    const owners = new Set(discovery.owners);
    for (const owner of presentationOwners()) owners.add(owner);
    if (options.preferredOwner && options.preferredOwner !== "device")
      owners.add(options.preferredOwner);
    if (
      discovery.keys.some(
        (key) => key === `layout:${DEVICE_PHYSICAL_OWNER}` || key === "v2-profile-ready:device"
      )
    )
      throw new WorkspaceMigrationError("journal-invalid", fallbackOwner);
    const snapshots: WorkspaceSource[] = [];
    for (const owner of owners) {
      check(options);
      const source = await readWorkspaceSource(owner, discovery.keys);
      if (stagePresentation([owner]).entries.length) source.populated = true;
      snapshots.push(source);
    }
    check(options);
    const selected =
      (options.preferredOwner &&
        snapshots.find((source) => source.owner === options.preferredOwner)) ||
      snapshots.find((source) => source.owner === "public" && source.populated) ||
      snapshots.find((source) => source.owner === discovery.remembered && source.populated) ||
      snapshots.find((source) => source.owner === "guest" && source.populated) ||
      snapshots.find((source) => source.populated) ||
      snapshots.find((source) => source.owner === "public")!;
    fallbackOwner = selected.owner;
    const ordered = [
      selected,
      ...snapshots
        .filter((source) => source !== selected)
        .sort((a, b) => a.owner.localeCompare(b.owner))
    ];
    const presentation = stagePresentation(ordered.map((source) => source.owner));
    const merge = mergeDeviceWorkspace(ordered);
    const cloud = await chooseCloudOwner(selected.owner, discovery.keys);
    const unbound = preservedUnboundV1();
    const unboundCount = unbound.preferences + unbound.drawings;
    const binding: DeviceWorkspaceBinding = {
      owner: DEVICE_OWNER,
      primaryOwner: selected.owner,
      cloudOwner: cloud.owner,
      legacyOwners: ordered.map((source) => source.owner),
      conflicts: [
        ...merge.conflicts,
        ...presentation.conflicts,
        ...cloud.conflicts,
        ...(unboundCount
          ? [
              {
                sourceOwner: "legacy-local",
                kind: "preferences" as const,
                key: `preserved-unbound-v1:${unboundCount}`,
                recoveryRef: "workspace-unbound-v1"
              }
            ]
          : [])
      ]
    };
    let committed: Journal = {
      id: DEVICE_WORKSPACE_JOURNAL,
      version: 1,
      phase: "committed",
      binding,
      presentation: presentation.entries
    };
    check(options);
    await transaction(
      [...WORKSPACE_STORES],
      (tx) => {
        check(options);
        const pref = tx.objectStore("preferences"),
          request = pref.get(DEVICE_WORKSPACE_JOURNAL);
        request.onsuccess = () => {
          try {
            const winner = parseJournal(request.result);
            if (winner) {
              committed = winner;
              return;
            }
            check(options);
            for (const write of merge.writes) tx.objectStore(write.store).put(write.value);
            for (const source of ordered)
              pref.put({
                id: `workspace-source:${source.owner}`,
                version: 1,
                owner: source.owner,
                physical: source.physical,
                backup: source.backup,
                images: source.images.map(({ image }) => image.id),
                history: source.history.map((block) => block.id),
                coverage: source.coverage.map((block) => block.id),
                cameras: source.cameras.map((camera) => camera.id)
              });
            pref.put({ id: "v2-profile-ready:device", owner: DEVICE_PHYSICAL_OWNER, value: true });
            if (unboundCount)
              pref.put({
                id: "workspace-unbound-v1",
                version: 1,
                status: "preserved-unbound",
                ...unbound
              });
            pref.put(committed);
            // A final request callback checks cancellation immediately before native commit.
            const fence = pref.get(DEVICE_WORKSPACE_JOURNAL);
            fence.onsuccess = () => {
              if (!options.valid() || options.signal?.aborted) tx.abort();
            };
          } catch {
            tx.abort();
          }
        };
      },
      options.signal
    );
    // Native commit is final; caller's late cancellation only prevents controller adoption.
    return await finishJournal(committed);
  } catch (error) {
    if (error instanceof WorkspaceMigrationError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw error;
    check(options);
    throw new WorkspaceMigrationError(
      error instanceof RangeError
        ? "limit-exceeded"
        : error instanceof DOMException
          ? "storage-failed"
          : "source-invalid",
      fallbackOwner
    );
  }
}

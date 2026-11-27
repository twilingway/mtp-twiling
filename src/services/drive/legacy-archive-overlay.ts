import { sha256 } from "./backup.js";
import {
  decodeRawArchive,
  MAX_RAW_ARCHIVE_BYTES,
  MAX_RAW_ARCHIVE_FILES
} from "./legacy-raw-archive-codec.js";
import type { DecodedRawArchive, RawLegacyFile } from "./legacy-raw-archive-types.js";
import {
  assertLegacyOverlayAgreement,
  assertLegacyOverlayFile,
  legacyPhysicalIdentity,
  legacySnapshotIdentity
} from "./legacy-archive-identity.js";
import { DRIVE_NAMESPACE, DriveError, LEGACY_DRIVE_NAMESPACE } from "./types.js";
import type { DriveFile, DriveKind, DriveStore } from "./types.js";

export type LegacyArchiveInput = Pick<
  DecodedRawArchive,
  "body" | "size" | "sha256" | "indexDigest"
>;
type ArchivedFile = { readonly file: DriveFile; readonly body: Blob };
const MAX_LIST_FILES = 10000;
const invalid = () => new DriveError("remote-invalid", "Invalid legacy archive overlay.");
const limit = () => new DriveError("limit", "Legacy archive overlay exceeds its limits.");
const copyFile = (file: DriveFile): DriveFile => ({
  ...file,
  appProperties: { ...file.appProperties }
});

export interface LegacyArchiveOverlay extends DriveStore {
  /** Only live logical snapshots outside the archived baseline; no automatic version selection. */
  listLateLegacySnapshots(): Promise<DriveFile[]>;
}

/** Read-only recovery view. The caller verifies remote record/workspace/client binding before
 * supplying archives. Re-decode immutable bodies against their receipts; never trust caller index
 * or objects. A record's historical v3 receipt does not need to remain the current v3 head.
 */
export async function createLegacyArchiveOverlay(
  base: DriveStore,
  namespace: RawLegacyFile["namespace"],
  verifiedArchives: readonly LegacyArchiveInput[]
): Promise<LegacyArchiveOverlay> {
  if (namespace !== DRIVE_NAMESPACE && namespace !== LEGACY_DRIVE_NAMESPACE) throw invalid();
  if (!Array.isArray(verifiedArchives) || verifiedArchives.length > MAX_RAW_ARCHIVE_FILES)
    throw limit();
  const inputs = verifiedArchives.map(
    ({ body, size, sha256: hash, indexDigest }: LegacyArchiveInput) => ({
      body,
      size,
      sha256: hash,
      indexDigest
    })
  );
  let totalBytes = 0;
  for (const input of inputs) {
    if (
      !(input.body instanceof Blob) ||
      !Number.isSafeInteger(input.size) ||
      input.size !== input.body.size
    )
      throw invalid();
    totalBytes += input.body.size;
    if (totalBytes > MAX_RAW_ARCHIVE_BYTES) throw limit();
  }
  const archived = new Map<string, ArchivedFile>();
  const baseline = new Set<string>();
  let totalFiles = 0;
  for (const input of inputs) {
    const archive = await decodeRawArchive(input.body, {
      size: input.size,
      sha256: input.sha256,
      indexDigest: input.indexDigest
    });
    totalFiles += archive.objects.length;
    if (totalFiles > MAX_RAW_ARCHIVE_FILES) throw limit();
    for (const { file: raw, body } of archive.objects) {
      if (raw.namespace !== namespace) continue;
      const id =
        "legacy-archive-" +
        (await sha256(
          new Blob([JSON.stringify([raw.namespace, raw.fileId, raw.version, raw.etag, raw.sha256])])
        ));
      const file: DriveFile = {
        id,
        name: raw.fileId,
        version: raw.version,
        size: raw.size,
        appProperties: { ...raw.appProperties }
      };
      assertLegacyOverlayFile(file, namespace, raw.kind);
      if (
        file.appProperties.mtpKey !== raw.key ||
        file.appProperties.mtpHash !== raw.sha256 ||
        body.size !== raw.size
      )
        throw invalid();
      const previous = archived.get(id);
      if (previous && legacyPhysicalIdentity(previous.file) !== legacyPhysicalIdentity(file))
        throw new DriveError("conflict", "Conflicting archived physical file versions.");
      archived.set(id, { file, body });
      if (raw.kind === "snapshot") baseline.add(legacySnapshotIdentity(file));
    }
  }
  assertLegacyOverlayAgreement([...archived.values()].map(({ file }) => file));

  async function listing(kind: DriveKind) {
    const received = await base.list(kind);
    if (!Array.isArray(received) || received.length > MAX_LIST_FILES) throw limit();
    const live = received.map(copyFile);
    const ids = new Map<string, string>();
    for (const file of live) {
      assertLegacyOverlayFile(file, namespace, kind);
      if (archived.has(file.id))
        throw new DriveError("conflict", "Live file collides with an archive virtual identity.");
      const previous = ids.get(file.id);
      const identity = legacyPhysicalIdentity(file);
      if (previous !== undefined && previous !== identity)
        throw new DriveError("conflict", "Conflicting live physical file versions.");
      ids.set(file.id, identity);
    }
    const all = [
      ...live,
      ...[...archived.values()]
        .filter(({ file }) => file.appProperties.mtpKind === kind)
        .map(({ file }) => copyFile(file))
    ];
    if (all.length > MAX_LIST_FILES) throw limit();
    assertLegacyOverlayAgreement(all);
    return { live, all };
  }

  return Object.freeze({
    list: async (kind: DriveKind) => (await listing(kind)).all,
    async read(file: DriveFile, maxBytes: number) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw invalid();
      const stored = archived.get(file.id);
      if (stored) {
        if (legacyPhysicalIdentity(file) !== legacyPhysicalIdentity(stored.file)) throw invalid();
        if (stored.body.size > maxBytes) throw limit();
        return stored.body;
      }
      const kind = file.appProperties.mtpKind;
      if (kind !== "snapshot" && kind !== "blob") throw invalid();
      assertLegacyOverlayFile(file, namespace, kind);
      return base.read(copyFile(file), maxBytes);
    },
    create: () =>
      Promise.reject(new DriveError("permission", "Legacy archive overlay is read-only.")),
    listLateLegacySnapshots: async () =>
      (await listing("snapshot")).live.filter((file) => !baseline.has(legacySnapshotIdentity(file)))
  });
}

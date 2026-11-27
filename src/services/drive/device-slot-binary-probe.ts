import { reference, sha256 } from "./backup.js";
import {
  DeviceSlotCasError,
  encodeDeviceSlotEnvelope,
  strongDeviceSlotTag
} from "./device-slot-cas.js";
import { DeviceSlotHttp, PROBE_NAMESPACE } from "./device-slot-http.js";
import { deviceSlotKey, parseDeviceSlotEnvelope } from "./device-slot-model.js";
import type { DeviceSlotManifest } from "./device-slot-model.js";
import {
  decodeDeviceSlotPackage,
  encodeDeviceSlotPackage,
  prepareDeviceSlotVersion
} from "./device-slot-package.js";
import type { DeviceSlotPackageVersion } from "./device-slot-package.js";
import { replacePackedDeviceSlot } from "./device-slot-store.js";
import type { DriveAuthorization } from "./types.js";

const budgets = new WeakMap<DriveAuthorization, number>();
export const verifiedDeviceSlotUploadBytes = (authorization: DriveAuthorization) =>
  budgets.get(authorization) ?? 0;

async function syntheticVersion(variant: number, bytes: number, signal: AbortSignal) {
  const mimeType = "image/gif";
  const image = new Blob([new Uint8Array(bytes).fill(variant)], { type: mimeType });
  return prepareDeviceSlotVersion(
    {
      payload: new Blob([
        JSON.stringify({
          application: "personal-terminal",
          schemaVersion: 2,
          layout: { symbol: "SBER", rangeDays: variant },
          watchlist: [],
          views: [],
          drawings: [],
          images: [
            {
              id: "synthetic-check",
              symbol: "SBER",
              type: mimeType,
              point: { timestamp: 1000, value: 1 },
              width: 20,
              data: ""
            }
          ]
        })
      ]),
      images: [{ index: 0, body: image, mimeType, reference: await reference(image) }]
    },
    signal
  );
}

/** Only an explicit DEV command may invoke this disposable-file test. */
export async function runDriveSlotBinaryProbe(
  authorization: DriveAuthorization,
  fetcher: typeof fetch,
  signal: AbortSignal,
  imageBytes = 1024 * 1024
) {
  if (!Number.isSafeInteger(imageBytes) || imageBytes < 1 || imageBytes > 2 * 1024 * 1024)
    throw new RangeError("Invalid Drive binary probe size");
  const scope = AbortSignal.any([authorization.signal, signal]);
  scope.throwIfAborted();
  const workspaceId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const key = deviceSlotKey(workspaceId, deviceId);
  const version = async (index: number, previous?: DeviceSlotManifest) => {
    const revision = { deviceId, seq: (previous?.seq ?? 0) + 1, revisionId: crypto.randomUUID() };
    const bytes = await syntheticVersion(index, imageBytes, scope);
    const current: DeviceSlotManifest = {
      ...revision,
      protocol: 3,
      workspaceId,
      legacyArchive: null,
      previousRevisionId: previous?.revisionId ?? null,
      accepted: [revision],
      payload: bytes.reference
    };
    return { current, bytes };
  };
  const first = await version(1);
  const seed = await version(2, first.current);
  const packet = (
    item: { current: DeviceSlotManifest; bytes: DeviceSlotPackageVersion },
    previous: { current: DeviceSlotManifest; bytes: DeviceSlotPackageVersion }
  ) => {
    const envelope = parseDeviceSlotEnvelope({
      protocol: 3,
      current: item.current,
      previous: previous.current
    });
    return { envelope, body: encodeDeviceSlotPackage(envelope, item.bytes, previous.bytes) };
  };
  const initial = packet(seed, first);
  const a = packet(await version(3, seed.current), seed);
  const b = packet(await version(4, seed.current), seed);
  const io = new DeviceSlotHttp(authorization, fetcher, PROBE_NAMESPACE);
  const fileId = await io.reserve(scope);
  await io.create(fileId, key, initial.body, scope);
  const before = await io.read(fileId, scope);
  const baseEtag = strongDeviceSlotTag(before.etag);
  const actual = await decodeDeviceSlotPackage(before.body, scope);
  if (JSON.stringify(actual.envelope) !== JSON.stringify(initial.envelope))
    throw new DeviceSlotCasError("probe");
  const results = await Promise.allSettled(
    [a, b].map(({ envelope, body }) =>
      replacePackedDeviceSlot(io, { fileId, baseEtag, key, envelope }, body, scope)
    )
  );
  scope.throwIfAborted();
  const outcomes = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );
  const winner = outcomes.find((result) => result !== 412);
  if (!winner || !outcomes.includes(412)) throw new DeviceSlotCasError("probe");
  const after = await io.read(fileId, scope);
  const final = await decodeDeviceSlotPackage(after.body, scope);
  const envelopeHash = await sha256(encodeDeviceSlotEnvelope(final.envelope));
  if (
    strongDeviceSlotTag(after.etag) !== winner.etag ||
    envelopeHash !== (await sha256(encodeDeviceSlotEnvelope(winner.package.envelope)))
  )
    throw new DeviceSlotCasError("probe");
  scope.throwIfAborted();
  const maxBytes = Math.min(initial.body.size, a.body.size, b.body.size);
  budgets.set(authorization, maxBytes);
  return { fileId, maxBytes, loserStatus: 412 as const, envelopeHash };
}

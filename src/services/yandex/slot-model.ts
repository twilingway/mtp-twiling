import { validateRevision } from "./bundle.js";
import type { YandexRevision } from "./bundle.js";
import { hashPattern, object, sha256, uuidPattern, YandexError } from "./types.js";
import type { YandexFile, YandexReference } from "./types.js";

export const SLOT_PROTOCOL = 3;
export const MAX_SLOT_SEQUENCE = 0x7fffffff;
export interface SlotClaim {
  deviceId: string;
  seq: number;
  revisionId: string;
}
export interface SlotRetired extends SlotClaim {
  versionHash: string;
}
export interface SlotVersion {
  seq: number;
  revision: YandexRevision;
  bundle: YandexReference;
  priorVersionHash: string | null;
  accepted: readonly SlotClaim[];
  retired: readonly SlotRetired[];
  legacyHeads: readonly string[];
}
export interface SlotPrunedPeer extends SlotRetired {
  accepted: readonly SlotClaim[];
}
export type SlotEnvelope =
  | {
      protocol: 2;
      current: SlotVersion;
      previous: SlotVersion | null;
    }
  | {
      protocol: 3;
      generation: number;
      current: SlotVersion;
      previous: SlotVersion | null;
      prunedPeers: readonly SlotPrunedPeer[];
    };
export const slotGeneration = (envelope: SlotEnvelope): number =>
  envelope.protocol === 3 ? envelope.generation : envelope.current.seq;
export const slotPrunedPeers = (envelope: SlotEnvelope): readonly SlotPrunedPeer[] =>
  envelope.protocol === 3 ? envelope.prunedPeers : [];
export interface SlotPhysical {
  file: YandexFile;
  envelope: SlotEnvelope;
}
export interface SlotInspection {
  files: readonly SlotPhysical[];
  latest: readonly SlotPhysical[];
  uncertain: readonly SlotPhysical[];
  obsolete: readonly SlotPhysical[];
  heads: readonly string[];
}
const bad = (): never => {
  throw new YandexError("remote-invalid");
};
export function slotObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = object(value);
  const prototype: unknown = record ? Object.getPrototypeOf(record) : undefined;
  if (
    !record ||
    (prototype !== Object.prototype && prototype !== null) ||
    Object.keys(record).some((key) => !keys.includes(key))
  )
    return bad();
  return record;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value) || value !== value.toLowerCase())
    return bad();
  return value;
}
function sequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAX_SLOT_SEQUENCE)
    return bad();
  return Number(value);
}
function reference(value: unknown): YandexReference {
  const record = slotObject(value, ["size", "sha256"]);
  if (
    !Number.isSafeInteger(record.size) ||
    Number(record.size) < 12 ||
    Number(record.size) > 256 * 1024 * 1024 ||
    typeof record.sha256 !== "string" ||
    !hashPattern.test(record.sha256)
  )
    return bad();
  return { size: Number(record.size), sha256: record.sha256 };
}
function claim(value: unknown, retired = false): SlotClaim | SlotRetired {
  const record = slotObject(
    value,
    retired ? ["deviceId", "seq", "revisionId", "versionHash"] : ["deviceId", "seq", "revisionId"]
  );
  const result = {
    deviceId: id(record.deviceId),
    seq: sequence(record.seq),
    revisionId: id(record.revisionId)
  };
  if (!retired) return result;
  if (typeof record.versionHash !== "string" || !hashPattern.test(record.versionHash)) return bad();
  return { ...result, versionHash: record.versionHash };
}
export function parseSlotVersion(input: unknown): SlotVersion {
  const value = slotObject(input, [
      "seq",
      "revision",
      "bundle",
      "priorVersionHash",
      "accepted",
      "retired",
      "legacyHeads"
    ]),
    revision = validateRevision(value.revision),
    seq = sequence(value.seq);
  if (
    !Array.isArray(value.accepted) ||
    value.accepted.length > 256 ||
    !Array.isArray(value.retired) ||
    value.retired.length > 512 ||
    !Array.isArray(value.legacyHeads) ||
    value.legacyHeads.length > 1000 ||
    !(
      value.priorVersionHash === null ||
      (typeof value.priorVersionHash === "string" && hashPattern.test(value.priorVersionHash))
    )
  )
    return bad();
  const accepted = value.accepted.map((item) => claim(item)),
    retired = value.retired.map((item) => claim(item, true) as SlotRetired),
    legacyHeads = value.legacyHeads.map(id);
  if (
    new Set(accepted.map((item) => item.deviceId)).size !== accepted.length ||
    new Set(legacyHeads).size !== legacyHeads.length ||
    !accepted.some(
      (item) =>
        item.deviceId === revision.deviceId &&
        item.seq === seq &&
        item.revisionId === revision.revisionId
    ) ||
    (seq === 1) !== (value.priorVersionHash === null)
  )
    return bad();
  return {
    seq,
    revision,
    bundle: reference(value.bundle),
    priorVersionHash: value.priorVersionHash,
    accepted: accepted.sort((a, b) => a.deviceId.localeCompare(b.deviceId)),
    retired: retired.sort((a, b) => a.versionHash.localeCompare(b.versionHash)),
    legacyHeads: legacyHeads.sort()
  };
}
export async function parseSlotEnvelope(input: unknown): Promise<SlotEnvelope> {
  const raw = object(input);
  if (raw?.protocol !== 2 && raw?.protocol !== 3) throw new YandexError("unsupported-format");
  const value = slotObject(
    input,
    raw.protocol === 2
      ? ["protocol", "current", "previous"]
      : ["protocol", "generation", "current", "previous", "prunedPeers"]
  );
  const current = parseSlotVersion(value.current),
    previous = value.previous === null ? null : parseSlotVersion(value.previous);
  if (value.protocol === 2 && (current.seq === 1) !== (previous === null)) return bad();
  if (
    previous &&
    (previous.seq !== current.seq - 1 ||
      previous.revision.deviceId !== current.revision.deviceId ||
      (await slotVersionHash(previous)) !== current.priorVersionHash ||
      !previous.accepted.every((old) => current.accepted.some((next) => coversClaim(next, old))))
  )
    return bad();
  if (value.protocol === 2) return { protocol: 2, current, previous };
  const generation = sequence(value.generation);
  if (
    generation < current.seq ||
    !Array.isArray(value.prunedPeers) ||
    value.prunedPeers.length > 512
  )
    return bad();
  const prunedPeers = value.prunedPeers.map((input): SlotPrunedPeer => {
    const record = slotObject(input, ["deviceId", "seq", "revisionId", "versionHash", "accepted"]);
    const peer = claim(
      {
        deviceId: record.deviceId,
        seq: record.seq,
        revisionId: record.revisionId,
        versionHash: record.versionHash
      },
      true
    ) as SlotRetired;
    if (!Array.isArray(record.accepted) || record.accepted.length > 256) return bad();
    const accepted = record.accepted.map((item) => claim(item));
    if (
      peer.deviceId === current.revision.deviceId ||
      new Set(accepted.map((item) => item.deviceId)).size !== accepted.length ||
      !accepted.some((item) => sameClaim(item, peer)) ||
      !accepted.every((old) => current.accepted.some((next) => coversClaim(next, old)))
    )
      return bad();
    return { ...peer, accepted: accepted.sort((a, b) => a.deviceId.localeCompare(b.deviceId)) };
  });
  if (
    new Set(prunedPeers.map((peer) => JSON.stringify(slotProofKey(peer)))).size !==
    prunedPeers.length
  )
    return bad();
  return {
    protocol: 3,
    generation,
    current,
    previous,
    prunedPeers: prunedPeers.sort((a, b) => slotProofKey(a).localeCompare(slotProofKey(b)))
  };
}
export const sameClaim = (a: SlotClaim, b: SlotClaim): boolean =>
  a.deviceId === b.deviceId && a.seq === b.seq && a.revisionId === b.revisionId;
export const coversClaim = (a: SlotClaim, b: SlotClaim): boolean =>
  a.deviceId === b.deviceId && (a.seq > b.seq || sameClaim(a, b));
export const slotProofKey = (claim: SlotClaim): string =>
  `${claim.deviceId}:${claim.seq}:${claim.revisionId}`;
export const slotVersionHash = (version: SlotVersion): Promise<string> =>
  sha256(new Blob([JSON.stringify(version)]));
export const slotClaim = (version: SlotVersion): SlotClaim => ({
  deviceId: version.revision.deviceId,
  seq: version.seq,
  revisionId: version.revision.revisionId
});
export function slotName(deviceId: string, seq: number, probe?: string): string {
  return `${probe ? `probe_slot_${id(probe)}_` : "slot_"}${id(deviceId)}_${sequence(seq)}.mtp`;
}
export function stageName(operationId: string, probe?: string): string {
  return `${probe ? `probe_stage_${id(probe)}_` : "stage_"}${id(operationId)}.mtp`;
}
export const isSlotName = (name: string): boolean =>
  /^(?:probe_slot_[a-f\d-]{36}_|slot_)[a-f\d-]{36}_[1-9]\d{0,9}\.mtp$/.test(name);
export const isStageName = (name: string): boolean =>
  /^(?:probe_stage_[a-f\d-]{36}_|stage_)[a-f\d-]{36}\.mtp$/.test(name);

/** Unknown lower sequences remain visible: sequence order alone never proves their acceptance. */
export async function inspectSlots(files: readonly SlotPhysical[]): Promise<SlotInspection> {
  if (files.length > 10000) throw new YandexError("limit");
  const latest: SlotPhysical[] = [],
    uncertain: SlotPhysical[] = [],
    obsolete: SlotPhysical[] = [],
    hashes = new Map<SlotVersion, string>();
  for (const { envelope } of files)
    for (const version of [envelope.current, envelope.previous])
      if (version && !hashes.has(version)) hashes.set(version, await slotVersionHash(version));
  const devices = new Set(files.map(({ envelope }) => envelope.current.revision.deviceId));
  if (devices.size > 256) throw new YandexError("limit");
  const currentByDevice = new Map<string, SlotPhysical>();
  for (const item of files) {
    const device = item.envelope.current.revision.deviceId,
      prior = currentByDevice.get(device);
    if (!prior || slotGeneration(prior.envelope) < slotGeneration(item.envelope))
      currentByDevice.set(device, item);
  }
  const resolved = [...currentByDevice.values()].flatMap(
    ({ envelope }) => envelope.current.retired
  );
  for (const device of devices) {
    const group = files
        .filter(({ envelope }) => envelope.current.revision.deviceId === device)
        .sort((a, b) => slotGeneration(b.envelope) - slotGeneration(a.envelope)),
      top = group[0]!;
    if (new Set(group.map(({ envelope }) => slotGeneration(envelope))).size !== group.length)
      throw new YandexError("conflict");
    const logical = new Map<number, string>();
    for (const { envelope } of group) {
      const hash = hashes.get(envelope.current)!;
      if (logical.has(envelope.current.seq) && logical.get(envelope.current.seq) !== hash)
        throw new YandexError("conflict");
      logical.set(envelope.current.seq, hash);
      if (envelope.current.seq > top.envelope.current.seq) throw new YandexError("conflict");
    }
    for (const { envelope } of group.slice(1)) {
      for (const proof of slotPrunedPeers(envelope)) {
        const kept = slotPrunedPeers(top.envelope).find(
          (item) => slotProofKey(item) === slotProofKey(proof)
        );
        if (!kept || JSON.stringify(kept) !== JSON.stringify(proof))
          throw new YandexError("conflict");
      }
      if (
        envelope.protocol === 3 &&
        envelope.current.seq === top.envelope.current.seq &&
        !envelope.previous &&
        top.envelope.previous
      )
        throw new YandexError("conflict");
    }
    latest.push(top);
    const known = new Map<number, string>();
    for (const version of [top.envelope.current, top.envelope.previous])
      if (version) {
        known.set(version.seq, hashes.get(version)!);
        if (version.priorVersionHash) known.set(version.seq - 1, version.priorVersionHash);
      }
    for (const item of group.slice(1)) {
      const version = item.envelope.current,
        hash = hashes.get(version)!,
        retired = resolved.some(
          (entry) =>
            entry.deviceId === device &&
            entry.seq === version.seq &&
            entry.revisionId === version.revision.revisionId &&
            entry.versionHash === hash
        );
      if (known.get(version.seq) !== hash && !retired) {
        uncertain.push(item);
        continue;
      }
      // The latest envelope already carries its previous version's complete body.
      // Keeping that previous container would also retain a third, older payload.
      obsolete.push(item);
      const prior = item.envelope.previous;
      if (prior) {
        known.set(prior.seq, hashes.get(prior)!);
        if (prior.priorVersionHash) known.set(prior.seq - 1, prior.priorVersionHash);
      }
    }
  }
  const proofs = new Map<string, SlotPrunedPeer>();
  for (const { envelope } of latest)
    for (const proof of slotPrunedPeers(envelope)) {
      const key = slotProofKey(proof),
        prior = proofs.get(key);
      if (prior && JSON.stringify(prior) !== JSON.stringify(proof))
        throw new YandexError("conflict");
      proofs.set(key, proof);
    }
  const byDevice = new Map(latest.map((item) => [item.envelope.current.revision.deviceId, item])),
    dominated = new Set<string>(),
    dependencies = new Map<string, string[]>();
  for (const {
    envelope: { current }
  } of latest)
    for (const entry of current.accepted) {
      if (entry.deviceId === current.revision.deviceId) continue;
      const peer = byDevice.get(entry.deviceId)?.envelope.current;
      if (!peer) {
        const proof = proofs.get(slotProofKey(entry));
        if (
          !proof ||
          !proof.accepted.every((old) => current.accepted.some((next) => coversClaim(next, old)))
        )
          throw new YandexError("conflict");
        const edges = dependencies.get(current.revision.revisionId) ?? [];
        edges.push(proof.revisionId);
        dependencies.set(current.revision.revisionId, edges);
        continue;
      }
      if (
        peer.seq < entry.seq ||
        (peer.seq === entry.seq && peer.revision.revisionId !== entry.revisionId)
      )
        throw new YandexError("conflict");
      if (peer.seq === entry.seq) {
        if (
          !peer.accepted.every((claim) =>
            current.accepted.some(
              (accepted) =>
                accepted.deviceId === claim.deviceId &&
                (accepted.seq > claim.seq ||
                  (accepted.seq === claim.seq && accepted.revisionId === claim.revisionId))
            )
          )
        )
          throw new YandexError("remote-invalid");
        dominated.add(peer.revision.revisionId);
        const edges = dependencies.get(current.revision.revisionId) ?? [];
        edges.push(peer.revision.revisionId);
        dependencies.set(current.revision.revisionId, edges);
      }
    }
  for (const proof of proofs.values()) {
    const edges = dependencies.get(proof.revisionId) ?? [];
    for (const claim of proof.accepted) {
      if (claim.deviceId === proof.deviceId) continue;
      const peer = byDevice.get(claim.deviceId)?.envelope.current;
      const missing = proofs.get(slotProofKey(claim));
      if (!peer && !missing) throw new YandexError("conflict");
      if (
        peer &&
        (peer.seq < claim.seq ||
          (peer.seq === claim.seq && peer.revision.revisionId !== claim.revisionId))
      )
        throw new YandexError("conflict");
      if (peer?.seq === claim.seq || !peer) edges.push(claim.revisionId);
    }
    dependencies.set(proof.revisionId, edges);
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new YandexError("remote-invalid");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of dependencies.get(id) ?? []) visit(child);
    visiting.delete(id);
    visited.add(id);
  };
  for (const { envelope } of latest) visit(envelope.current.revision.revisionId);
  for (const proof of proofs.values()) visit(proof.revisionId);
  return {
    files,
    latest,
    uncertain,
    obsolete,
    heads: [
      ...latest.filter(({ envelope }) => !dominated.has(envelope.current.revision.revisionId)),
      ...uncertain
    ]
      .map(({ envelope }) => envelope.current.revision.revisionId)
      .sort()
  };
}

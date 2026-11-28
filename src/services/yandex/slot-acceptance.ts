import { hashPattern, object, uuidPattern, YandexError } from "./types.js";
import type { YandexReference } from "./types.js";
import type { SlotEnvelope, SlotRetired } from "./slot-model.js";

export type SlotAcceptanceProof =
  | { kind: "legacy"; revisionId: string; bundle: YandexReference }
  | ({ kind: "slot" } & SlotRetired);
const invalid = (): never => {
  throw new YandexError("remote-invalid");
};
const id = (value: unknown): string =>
  typeof value === "string" && uuidPattern.test(value) && value === value.toLowerCase()
    ? value
    : invalid();
export const acceptanceProofKey = (proof: SlotAcceptanceProof): string =>
  proof.kind === "legacy"
    ? `legacy:${proof.revisionId}`
    : `slot:${proof.deviceId}:${proof.seq}:${proof.revisionId}`;
export function parseSlotAcceptanceProofs(value: unknown): readonly SlotAcceptanceProof[] {
  if (!Array.isArray(value) || value.length > 10000) return invalid();
  const proofs = value.map((input): SlotAcceptanceProof => {
    const record = object(input);
    if (!record) return invalid();
    if (record.kind === "legacy") {
      const bundle = object(record.bundle);
      if (
        Object.keys(record).some((key) => !["kind", "revisionId", "bundle"].includes(key)) ||
        !bundle ||
        Object.keys(bundle).some((key) => !["size", "sha256"].includes(key)) ||
        !Number.isSafeInteger(bundle.size) ||
        Number(bundle.size) < 12 ||
        Number(bundle.size) > 256 * 1024 * 1024 ||
        typeof bundle.sha256 !== "string" ||
        !hashPattern.test(bundle.sha256)
      )
        return invalid();
      return {
        kind: "legacy",
        revisionId: id(record.revisionId),
        bundle: { size: Number(bundle.size), sha256: bundle.sha256 }
      };
    }
    if (
      record.kind !== "slot" ||
      Object.keys(record).some(
        (key) => !["kind", "deviceId", "seq", "revisionId", "versionHash"].includes(key)
      ) ||
      !Number.isSafeInteger(record.seq) ||
      Number(record.seq) < 1 ||
      Number(record.seq) > 0x7fffffff ||
      typeof record.versionHash !== "string" ||
      !hashPattern.test(record.versionHash)
    )
      return invalid();
    return {
      kind: "slot",
      deviceId: id(record.deviceId),
      seq: Number(record.seq),
      revisionId: id(record.revisionId),
      versionHash: record.versionHash
    };
  });
  if (new Set(proofs.map(acceptanceProofKey)).size !== proofs.length) return invalid();
  return proofs.toSorted((a, b) => acceptanceProofKey(a).localeCompare(acceptanceProofKey(b)));
}
export const slotAcceptanceProofs = (envelope: SlotEnvelope): readonly SlotAcceptanceProof[] =>
  envelope.protocol === 3 ? (envelope.acceptanceProofs ?? []) : [];
export function mergeSlotAcceptanceProofs(
  proofs: readonly SlotAcceptanceProof[]
): readonly SlotAcceptanceProof[] {
  const merged = new Map<string, SlotAcceptanceProof>();
  for (const proof of proofs) {
    const key = acceptanceProofKey(proof),
      previous = merged.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(proof))
      throw new YandexError("conflict");
    merged.set(key, proof);
  }
  return parseSlotAcceptanceProofs([...merged.values()]);
}
export const slotAcceptanceFields = (envelope: SlotEnvelope) =>
  envelope.protocol === 3 && envelope.acceptanceProofs
    ? { acceptanceProofs: envelope.acceptanceProofs }
    : {};

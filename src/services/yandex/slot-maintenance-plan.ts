import { decodeSlot, encodeSlot } from "./slot-codec.js";
import {
  inspectSlots,
  isSlotName,
  parseSlotEnvelope,
  slotGeneration,
  slotName,
  slotVersionHash,
  stageName
} from "./slot-model.js";
import type { SlotPhysical } from "./slot-model.js";
import { selectSlotMaintenance } from "./slot-maintenance-selection.js";
import { slotFingerprint } from "./slot-store.js";
import type { YandexSlotStore } from "./slot-store.js";
import { assertCurrent, object, sha256, uuidPattern, YandexError } from "./types.js";
import type { YandexAuthorization, YandexFile, YandexReference } from "./types.js";

export interface YandexManualDeletePlan {
  version: 1;
  operationId: string;
  accountId: string;
  credentialGeneration: string;
  remoteId: string;
  kind: "previous" | "retired-peer";
  beforeFiles: readonly YandexFile[];
  beforeSlots: readonly SlotPhysical[];
  expectedHeads: readonly string[];
  protectedCurrents: readonly { deviceId: string; revisionId: string; versionHash: string }[];
  replacements: readonly {
    stage: string;
    destination: string;
    body: Blob;
    reference: YandexReference;
  }[];
  candidates: readonly YandexFile[];
}
const bad = (): never => {
  throw new YandexError("remote-invalid");
};
export async function createSlotMaintenancePlan(
  store: YandexSlotStore,
  files: readonly YandexFile[],
  remoteId: string,
  heads: readonly string[],
  auth: YandexAuthorization,
  valid: () => boolean
): Promise<YandexManualDeletePlan> {
  const snapshot = store.snapshot;
  if (!snapshot) throw new YandexError("not-ready");
  const selected = await selectSlotMaintenance(snapshot, remoteId),
    operationId = crypto.randomUUID();
  const replacements: YandexManualDeletePlan["replacements"][number][] = [];
  for (const { original, envelope } of selected.replacements) {
    const decoded = await store.body(original.file, valid);
    if (JSON.stringify(decoded.envelope) !== JSON.stringify(original.envelope))
      throw new YandexError("conflict");
    const encoded = await encodeSlot(
      envelope,
      decoded.current,
      envelope.previous ? decoded.previous : null
    );
    replacements.push({
      stage: stageName(operationId),
      destination: slotName(envelope.current.revision.deviceId, slotGeneration(envelope)),
      ...encoded
    });
  }
  const protectedCurrents = await Promise.all(
    snapshot.latest
      .filter(
        (item) =>
          !selected.candidates.includes(item) ||
          selected.replacements.some((r) => r.original === item)
      )
      .map(async ({ envelope }) => ({
        deviceId: envelope.current.revision.deviceId,
        revisionId: envelope.current.revision.revisionId,
        versionHash: await slotVersionHash(envelope.current)
      }))
  );
  assertCurrent(auth.signal, valid);
  const plan: YandexManualDeletePlan = {
    version: 1,
    operationId,
    accountId: auth.accountId,
    credentialGeneration: auth.credentialGeneration,
    remoteId,
    kind: selected.kind,
    beforeFiles: structuredClone(files),
    beforeSlots: structuredClone(snapshot.files),
    expectedHeads: [...heads],
    protectedCurrents,
    replacements,
    candidates: selected.candidates.map((item) => item.file)
  };
  return validateYandexManualDeletePlan(plan);
}
/** Validate local structure and internal consistency only. Persisted envelopes are untrusted.
 * executeSlotMaintenance binds live originals to real bytes and derives the protected graph
 * before any mutation, including on cold partial retries.
 */
export async function validateYandexManualDeletePlan(
  value: unknown
): Promise<YandexManualDeletePlan> {
  try {
    return await validatePlan(value);
  } catch {
    return bad();
  }
}
async function validatePlan(value: unknown): Promise<YandexManualDeletePlan> {
  const raw = object(value);
  if (
    !raw ||
    raw.version !== 1 ||
    typeof raw.operationId !== "string" ||
    !uuidPattern.test(raw.operationId) ||
    typeof raw.remoteId !== "string" ||
    !uuidPattern.test(raw.remoteId) ||
    typeof raw.accountId !== "string" ||
    !raw.accountId ||
    typeof raw.credentialGeneration !== "string" ||
    !raw.credentialGeneration ||
    !Array.isArray(raw.beforeFiles) ||
    raw.beforeFiles.length > 10000 ||
    !Array.isArray(raw.beforeSlots) ||
    raw.beforeSlots.length > 10000 ||
    !Array.isArray(raw.candidates) ||
    raw.candidates.length > 10000 ||
    !Array.isArray(raw.replacements) ||
    raw.replacements.length !== 1 ||
    !Array.isArray(raw.expectedHeads) ||
    raw.expectedHeads.length > 1000 ||
    !Array.isArray(raw.protectedCurrents) ||
    raw.protectedCurrents.length > 256
  )
    return bad();
  const beforeFiles: YandexFile[] = [];
  for (const f of raw.beforeFiles as unknown[]) {
    const file = object(f);
    if (
      !file ||
      typeof file.name !== "string" ||
      typeof file.path !== "string" ||
      typeof file.md5 !== "string" ||
      !/^[a-f\d]{32}$/.test(file.md5) ||
      !Number.isSafeInteger(file.size) ||
      Number(file.size) < 12 ||
      typeof file.modified !== "string"
    )
      return bad();
    beforeFiles.push({
      name: file.name,
      path: file.path,
      md5: file.md5,
      size: Number(file.size),
      modified: file.modified
    });
  }
  if (new Set(beforeFiles.map((f) => f.name)).size !== beforeFiles.length) return bad();
  const beforeSlots: SlotPhysical[] = [];
  for (const item of raw.beforeSlots as unknown[]) {
    const slot = object(item);
    if (!slot) return bad();
    const envelope = await parseSlotEnvelope(slot.envelope),
      file = beforeFiles.find((f) => f.name === object(slot.file)?.name);
    if (
      !file ||
      slotFingerprint([file]) !== slotFingerprint([slot.file as YandexFile]) ||
      slotName(envelope.current.revision.deviceId, slotGeneration(envelope)) !== file.name
    )
      return bad();
    beforeSlots.push({ file, envelope });
  }
  if (
    beforeSlots.length !==
      beforeFiles.filter((file) => isSlotName(file.name) && !file.name.startsWith("probe_"))
        .length ||
    new Set(beforeSlots.map((item) => item.file.name)).size !== beforeSlots.length ||
    raw.expectedHeads.some((id) => typeof id !== "string" || !uuidPattern.test(id)) ||
    new Set(raw.expectedHeads).size !== raw.expectedHeads.length
  )
    return bad();
  const snapshot = await inspectSlots(beforeSlots),
    selected = await selectSlotMaintenance(snapshot, raw.remoteId);
  if (
    raw.kind !== selected.kind ||
    raw.replacements.length !== selected.replacements.length ||
    slotFingerprint(raw.candidates) !==
      slotFingerprint(selected.candidates.map((item) => item.file))
  )
    return bad();
  const expectedProtected = await Promise.all(
    snapshot.latest
      .filter(
        (item) =>
          !selected.candidates.includes(item) ||
          selected.replacements.some((r) => r.original === item)
      )
      .map(async ({ envelope }) => ({
        deviceId: envelope.current.revision.deviceId,
        revisionId: envelope.current.revision.revisionId,
        versionHash: await slotVersionHash(envelope.current)
      }))
  );
  if (JSON.stringify(raw.protectedCurrents) !== JSON.stringify(expectedProtected)) return bad();
  for (let i = 0; i < selected.replacements.length; i++) {
    const replacement = object(raw.replacements[i]),
      selection = selected.replacements[i]!;
    if (
      !replacement ||
      !(replacement.body instanceof Blob) ||
      replacement.stage !== stageName(raw.operationId) ||
      replacement.destination !==
        slotName(selection.envelope.current.revision.deviceId, slotGeneration(selection.envelope))
    )
      return bad();
    const reference = object(replacement.reference);
    if (
      !reference ||
      reference.size !== replacement.body.size ||
      reference.sha256 !== (await sha256(replacement.body))
    )
      return bad();
    const decoded = await decodeSlot(replacement.body),
      expected = await parseSlotEnvelope(selection.envelope);
    if (JSON.stringify(decoded.envelope) !== JSON.stringify(expected)) return bad();
  }
  return structuredClone(value) as YandexManualDeletePlan;
}

import { decodeSlot, decodeSlotHeader, yandexHeaderSize, MAX_SLOT_BYTES } from "./slot-codec.js";
import { slotFingerprint } from "./slot-store.js";
import type { YandexSlotStore } from "./slot-store.js";
import { slotVersionHash } from "./slot-model.js";
import { selectSlotMaintenance } from "./slot-maintenance-selection.js";
import { validateYandexManualDeletePlan } from "./slot-maintenance-plan.js";
import type { YandexManualDeletePlan } from "./slot-maintenance-plan.js";
import { assertCurrent, sha256, YandexError } from "./types.js";
import type { YandexAuthorization, YandexFile } from "./types.js";

/** Every allowed intermediate state is derived from one persisted immutable intent. */
export async function executeSlotMaintenance(
  store: YandexSlotStore,
  input: YandexManualDeletePlan,
  auth: YandexAuthorization,
  valid: () => boolean,
  inspect: () => Promise<{ heads: readonly string[] }>,
  beforeEffect: () => Promise<unknown>
): Promise<void> {
  const plan = await validateYandexManualDeletePlan(input),
    transport = store.transport;
  let protectedPins: YandexManualDeletePlan["protectedCurrents"] | undefined;
  const sortedPins = (pins: YandexManualDeletePlan["protectedCurrents"]) =>
    JSON.stringify([...pins].sort((a, b) => a.deviceId.localeCompare(b.deviceId)));
  const guard = (): void => {
    assertCurrent(auth.signal, valid);
    if (
      plan.accountId !== auth.accountId ||
      plan.credentialGeneration !== auth.credentialGeneration
    )
      throw new YandexError("local-changed");
  };
  const listing = async (): Promise<YandexFile[]> => {
    guard();
    const files = (await transport.list()).filter((f) => !f.name.startsWith("probe_"));
    guard();
    return files;
  };
  async function expectedState(requireReplacements: boolean): Promise<YandexFile[]> {
    const files = await listing(),
      byName = new Map(files.map((file) => [file.name, file]));
    const replacements = new Map(plan.replacements.map((item) => [item.destination, item]));
    const stages = new Map(plan.replacements.map((item) => [item.stage, item]));
    const candidates = new Set(plan.candidates.map((file) => file.name));
    for (const file of files) {
      const replacement = replacements.get(file.name),
        stage = stages.get(file.name);
      if (replacement || stage) {
        const reference = (replacement ?? stage)!.reference;
        await store.verified(file, reference, valid);
      } else {
        const original = plan.beforeFiles.find((old) => old.name === file.name);
        if (!original || slotFingerprint([original]) !== slotFingerprint([file]))
          throw new YandexError("conflict");
        const pinned = plan.beforeSlots.find((item) => item.file.name === file.name);
        if (pinned) {
          // A persisted envelope is a claim, never evidence about bytes at a real MD5/path.
          // Bind every live original to fresh bytes before even the capability probe can mutate.
          const actual = candidates.has(file.name)
            ? (await decodeSlot(await transport.read(file, MAX_SLOT_BYTES))).envelope
            : await decodeSlotHeader(
                await transport.readPrefix(
                  file,
                  await yandexHeaderSize(await transport.readPrefix(file, 12))
                ),
                file.size
              );
          guard();
          if (JSON.stringify(actual) !== JSON.stringify(pinned.envelope))
            throw new YandexError("conflict");
        }
      }
    }
    const allReplacements = plan.replacements.every((item) => byName.has(item.destination));
    for (const original of plan.beforeFiles)
      if (!byName.has(original.name)) {
        if (!candidates.has(original.name) || !allReplacements) throw new YandexError("conflict");
      }
    if (requireReplacements && !allReplacements) throw new YandexError("conflict");
    return files;
  }
  async function verifySurvivors(): Promise<void> {
    const inspected = await inspect();
    guard();
    if (
      JSON.stringify([...inspected.heads].sort()) !== JSON.stringify([...plan.expectedHeads].sort())
    )
      throw new YandexError("conflict");
    const snapshot = store.snapshot;
    if (!snapshot || snapshot.uncertain.length) throw new YandexError("conflict");
    if (!protectedPins) {
      let retiredDevice: string | undefined;
      const liveTarget = snapshot.latest.find(
        ({ envelope }) => envelope.current.revision.revisionId === plan.remoteId
      );
      if (plan.kind === "retired-peer" && liveTarget) {
        // Eligibility and the excluded peer come from the actual current graph, including
        // its real accepted vectors, rather than the persisted deletion set.
        const selected = await selectSlotMaintenance(snapshot, plan.remoteId);
        if (selected.kind !== "retired-peer") throw new YandexError("conflict");
        retiredDevice = liveTarget.envelope.current.revision.deviceId;
      }
      protectedPins = await Promise.all(
        snapshot.latest
          .filter(({ envelope }) => envelope.current.revision.deviceId !== retiredDevice)
          .map(async ({ envelope }) => ({
            deviceId: envelope.current.revision.deviceId,
            revisionId: envelope.current.revision.revisionId,
            versionHash: await slotVersionHash(envelope.current)
          }))
      );
      if (sortedPins(protectedPins) !== sortedPins(plan.protectedCurrents))
        throw new YandexError("conflict");
    }
    for (const protectedCurrent of protectedPins) {
      const carrier = snapshot.latest.find(
        ({ envelope }) => envelope.current.revision.deviceId === protectedCurrent.deviceId
      );
      if (
        !carrier ||
        carrier.envelope.current.revision.revisionId !== protectedCurrent.revisionId ||
        (await slotVersionHash(carrier.envelope.current)) !== protectedCurrent.versionHash
      )
        throw new YandexError("conflict");
      // Always read fresh bytes: cached payload success cannot prove a surviving current now.
      const decoded = await decodeSlot(await transport.read(carrier.file, MAX_SLOT_BYTES));
      guard();
      if ((await slotVersionHash(decoded.envelope.current)) !== protectedCurrent.versionHash)
        throw new YandexError("conflict");
    }
  }
  guard();
  await expectedState(false);
  await verifySurvivors();
  // Includes the empirical session gate and coordinator's durable intent/local-state checks.
  await beforeEffect();
  guard();
  await expectedState(false);
  for (const replacement of plan.replacements) {
    let files = await expectedState(false);
    if (!files.some((file) => file.name === replacement.destination)) {
      await beforeEffect();
      guard();
      await expectedState(false);
      await transport.putImmutable(
        replacement.stage,
        replacement.body,
        replacement.reference,
        valid
      );
      await beforeEffect();
      guard();
      await expectedState(false);
      await transport.moveImmutable(
        replacement.stage,
        replacement.destination,
        replacement.reference,
        valid
      );
    }
    files = await expectedState(true);
    const committed = files.find((file) => file.name === replacement.destination);
    if (!committed) throw new YandexError("indeterminate");
    const decoded = await decodeSlot(await transport.read(committed, MAX_SLOT_BYTES));
    guard();
    if (
      (await sha256(replacement.body)) !== replacement.reference.sha256 ||
      JSON.stringify(decoded.envelope) !==
        JSON.stringify((await decodeSlot(replacement.body)).envelope)
    )
      throw new YandexError("conflict");
  }
  // Immutable v3 readback and its retirement proofs are durable before the first payload DELETE.
  await verifySurvivors();
  for (const candidate of plan.candidates) {
    let files = await expectedState(true);
    if (!files.some((file) => file.name === candidate.name)) continue;
    await beforeEffect();
    guard();
    await verifySurvivors();
    files = await expectedState(true);
    const exact = await transport.metadata(candidate.name);
    guard();
    if (!exact || slotFingerprint([exact]) !== slotFingerprint([candidate]))
      throw new YandexError("conflict");
    if (slotFingerprint(files) !== slotFingerprint(await listing()))
      throw new YandexError("conflict");
    guard();
    await transport.removeExact(candidate, valid);
    await expectedState(true);
    await verifySurvivors();
  }
  for (const replacement of plan.replacements) {
    const files = await expectedState(true),
      staged = files.find((file) => file.name === replacement.stage);
    if (staged) {
      await beforeEffect();
      guard();
      await store.verified(staged, replacement.reference, valid);
      if (slotFingerprint(files) !== slotFingerprint(await listing()))
        throw new YandexError("conflict");
      await transport.removeExact(staged, valid);
    }
  }
  await expectedState(true);
  await verifySurvivors();
  if (
    store.snapshot?.files.some(({ envelope }) =>
      [envelope.current, envelope.previous].some(
        (version) => version?.revision.revisionId === plan.remoteId
      )
    )
  )
    throw new YandexError("conflict");
  guard();
}

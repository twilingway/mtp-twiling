import type { CloudRemoteDeletion } from "../../model/cloud-sync.js";
import {
  coversClaim,
  slotClaim,
  slotGeneration,
  slotPrunedPeers,
  slotVersionHash
} from "./slot-model.js";
import type { SlotEnvelope, SlotInspection, SlotPhysical, SlotPrunedPeer } from "./slot-model.js";
import { YandexError } from "./types.js";
import { slotAcceptanceFields } from "./slot-acceptance.js";

export interface SlotMaintenanceSelection {
  kind: "previous" | "retired-peer";
  candidates: readonly SlotPhysical[];
  replacements: readonly { original: SlotPhysical; envelope: SlotEnvelope }[];
}
/** This is the only authority deciding which exact physical payloads may disappear. */
export async function selectSlotMaintenance(
  snapshot: SlotInspection,
  remoteId: string
): Promise<SlotMaintenanceSelection> {
  if (snapshot.uncertain.length) throw new YandexError("conflict");
  const current = snapshot.latest.find(
    ({ envelope }) => envelope.current.revision.revisionId === remoteId
  );
  if (!current) {
    const carriers = snapshot.latest.filter(
      ({ envelope }) => envelope.previous?.revision.revisionId === remoteId
    );
    if (!carriers.length) throw new YandexError("permission");
    const devices = new Set(carriers.map(({ envelope }) => envelope.current.revision.deviceId));
    // Removing a carrier also removes its ancestry bridge. Retire the already-proven older
    // containers together, otherwise a disconnected ancient payload would become a false fork.
    const candidates = snapshot.files
      .filter(({ envelope }) => devices.has(envelope.current.revision.deviceId))
      .sort((a, b) => slotGeneration(a.envelope) - slotGeneration(b.envelope));
    return {
      kind: "previous",
      candidates,
      replacements: carriers.map((original) => ({
        original,
        envelope: {
          protocol: 3,
          generation: slotGeneration(original.envelope) + 1,
          current: original.envelope.current,
          previous: null,
          prunedPeers: slotPrunedPeers(original.envelope),
          ...slotAcceptanceFields(original.envelope)
        }
      }))
    };
  }
  if (snapshot.heads.includes(remoteId)) throw new YandexError("permission");
  const peer = current.envelope.current,
    survivor = snapshot.latest.find(
      ({ envelope }) =>
        envelope.current.revision.deviceId !== peer.revision.deviceId &&
        envelope.current.accepted.some(
          (claim) =>
            claim.deviceId === peer.revision.deviceId &&
            claim.seq === peer.seq &&
            claim.revisionId === peer.revision.revisionId
        ) &&
        peer.accepted.every((old) =>
          envelope.current.accepted.some((next) => coversClaim(next, old))
        )
    );
  if (!survivor) throw new YandexError("permission");
  const proof: SlotPrunedPeer = {
      ...slotClaim(peer),
      versionHash: await slotVersionHash(peer),
      accepted: peer.accepted
    },
    proofs = new Map(
      [...slotPrunedPeers(survivor.envelope), ...slotPrunedPeers(current.envelope), proof].map(
        (item) => [`${item.deviceId}:${item.seq}:${item.revisionId}`, item]
      )
    );
  return {
    kind: "retired-peer",
    candidates: [
      ...snapshot.files
        .filter(({ envelope }) => envelope.current.revision.deviceId === peer.revision.deviceId)
        .sort((a, b) => slotGeneration(a.envelope) - slotGeneration(b.envelope)),
      survivor
    ],
    replacements: [
      {
        original: survivor,
        envelope: {
          protocol: 3,
          generation: slotGeneration(survivor.envelope) + 1,
          current: survivor.envelope.current,
          previous: survivor.envelope.previous,
          prunedPeers: [...proofs.values()],
          ...slotAcceptanceFields(survivor.envelope)
        }
      }
    ]
  };
}
export async function slotDeleteCapabilities(
  snapshot: SlotInspection
): Promise<Record<string, CloudRemoteDeletion>> {
  const result: Record<string, CloudRemoteDeletion> = {};
  for (const { envelope } of [...snapshot.latest, ...snapshot.uncertain])
    for (const version of [envelope.current, envelope.previous])
      if (version) {
        const id = version.revision.revisionId;
        if (result[id]) continue;
        const current = snapshot.latest.some(
          (item) => item.envelope.current.revision.revisionId === id
        );
        result[id] = {
          kind: current ? "current" : "previous",
          allowed: false,
          reason: snapshot.uncertain.length ? "conflict" : "current"
        };
        try {
          const selected = await selectSlotMaintenance(snapshot, id);
          const versions =
            selected.kind === "previous"
              ? 1
              : new Set(
                  snapshot.files
                    .filter(
                      (item) =>
                        item.envelope.current.revision.deviceId === version.revision.deviceId
                    )
                    .flatMap(({ envelope }) => [envelope.current, envelope.previous])
                    .filter((item) => item !== null)
                    .map((item) => item.revision.revisionId)
                ).size;
          result[id] = { kind: selected.kind, allowed: true, versions };
        } catch {
          /* A protected or unresolved revision is still shown, with deletion disabled. */
        }
      }
  return result;
}

import { abortableSleep, YandexTransport } from "./transport.js";
import type { YandexTransportOptions } from "./transport.js";
import { assertCurrent, sha256, yandexErrorCode, YandexError } from "./types.js";
import type { YandexAuthorization } from "./types.js";
import { slotName, stageName } from "./slot-model.js";

export interface YandexRetentionProof {
  readonly completed: true;
  readonly destinationExclusionVerified: true;
  readonly conditionalDeleteVerified: true;
  readonly binaryReadbackVerified: true;
  readonly cleanupVerified: true;
}
const proofs = new Map<string, Promise<YandexRetentionProof>>();
/** Empirical capability gate for this authorization session, never an assertion of server CAS. */
export function ensureYandexRetentionProof(
  transport: YandexTransport,
  auth: YandexAuthorization,
  valid: () => boolean
): Promise<YandexRetentionProof> {
  const key = auth.connectionId;
  const prior = proofs.get(key);
  if (prior)
    return prior.then((result) => {
      assertCurrent(auth.signal, valid);
      return result;
    });
  const running = prove(transport, auth, valid).catch((error: unknown) => {
    proofs.delete(key);
    throw error;
  });
  if (proofs.size > 64) proofs.delete(proofs.keys().next().value!);
  proofs.set(key, running);
  return running;
}
export function runYandexRetentionProbe(
  auth: YandexAuthorization,
  options: YandexTransportOptions = {},
  valid: () => boolean = () => true
): Promise<YandexRetentionProof> {
  return ensureYandexRetentionProof(new YandexTransport(auth, options), auth, valid);
}
async function prove(
  transport: YandexTransport,
  auth: YandexAuthorization,
  valid: () => boolean
): Promise<YandexRetentionProof> {
  const run = crypto.randomUUID(),
    device = crypto.randomUUID(),
    destination = slotName(device, 1, run),
    names = [stageName(crypto.randomUUID(), run), stageName(crypto.randomUUID(), run)],
    bodies = [
      new Blob([new Uint8Array([0, 1, 128, 255])]),
      new Blob([new Uint8Array([255, 128, 1, 0])])
    ],
    refs = await Promise.all(
      bodies.map(async (body) => ({ size: body.size, sha256: await sha256(body) }))
    );
  try {
    for (let i = 0; i < names.length; i++)
      await transport.putImmutable(names[i]!, bodies[i]!, refs[i]!, valid);
    const outcomes: (number | undefined)[] = [];
    const race = await Promise.allSettled(
        names.map((name, i) =>
          transport.moveImmutable(
            name,
            destination,
            refs[i]!,
            valid,
            (status) => (outcomes[i] = status)
          )
        )
      ),
      winners = race.flatMap((result, i) => (result.status === "fulfilled" ? [i] : []));
    if (
      winners.length !== 1 ||
      outcomes.filter((status) => status === 201 || status === 202).length !== 1 ||
      outcomes.filter((status) => status === 409 || status === 423).length !== 1 ||
      race.some(
        (result) => result.status === "rejected" && yandexErrorCode(result.reason) !== "conflict"
      )
    )
      throw new YandexError("permission");
    const file = await transport.metadata(destination);
    if (
      !file ||
      (await sha256(await transport.read(file, file.size))) !== refs[winners[0]!]!.sha256
    )
      throw new YandexError("remote-invalid");
    const loser = winners[0] === 0 ? 1 : 0;
    if (outcomes[loser] === 423) {
      // A transient destination lock is not proof of exclusion. Demand a later exact-path 409.
      let excluded = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        let status: number | undefined;
        try {
          await transport.moveImmutable(
            names[loser]!,
            destination,
            refs[loser]!,
            valid,
            (value) => {
              status = value;
            }
          );
          throw new YandexError("permission");
        } catch (error) {
          if (yandexErrorCode(error) !== "conflict") throw error;
        }
        if (status === 409) {
          excluded = true;
          break;
        }
        if (status !== 423) throw new YandexError("permission");
        if (attempt < 2) await abortableSleep(100 * (attempt + 1), auth.signal);
      }
      const unchanged = await transport.metadata(destination);
      if (
        !excluded ||
        !unchanged ||
        unchanged.md5 !== file.md5 ||
        (await sha256(await transport.read(unchanged, unchanged.size))) !==
          refs[winners[0]!]!.sha256
      )
        throw new YandexError("permission");
    }
    let refused = false;
    try {
      await transport.removeExact(
        { ...file, md5: file.md5 === "0".repeat(32) ? "1".repeat(32) : "0".repeat(32) },
        valid
      );
    } catch (error) {
      if (yandexErrorCode(error) === "conflict") refused = true;
      else throw error;
    }
    const retained = await transport.metadata(destination);
    if (
      !refused ||
      !retained ||
      retained.md5 !== file.md5 ||
      (await sha256(await transport.read(retained, retained.size))) !== refs[winners[0]!]!.sha256
    )
      throw new YandexError("permission");
  } finally {
    // Only this random synthetic namespace is ever eligible for probe cleanup.
    for (const name of [...names, destination]) {
      assertCurrent(auth.signal, valid);
      const file = await transport.metadata(name);
      if (file) await transport.removeExact(file, valid);
    }
  }
  return Object.freeze({
    completed: true,
    destinationExclusionVerified: true,
    conditionalDeleteVerified: true,
    binaryReadbackVerified: true,
    cleanupVerified: true
  });
}

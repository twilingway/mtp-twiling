import { decodeBundle, encodeBundle } from "./bundle.js";
import { sha256, YandexError } from "./types.js";
import { YandexTransport } from "./transport.js";
import type { YandexAuthorization } from "./types.js";
import type { YandexTransportOptions } from "./transport.js";

export interface YandexProbeResult {
  readonly completed: true;
  readonly uploadReadbackVerified: true;
  readonly binaryRoundtripVerified: true;
  readonly cleanup: "removed" | "retained";
  readonly objectName: string;
}
/** Explicit diagnostic only. Captures no workspace data, URLs, account IDs or credentials. */
export async function runYandexSyntheticProbe(
  authorization: YandexAuthorization,
  options: YandexTransportOptions = {},
  cleanup = false
): Promise<YandexProbeResult> {
  const transport = new YandexTransport(authorization, options),
    operationId = crypto.randomUUID(),
    payload = new Blob([JSON.stringify({ probe: "mtp-yandex-v1", operationId })], {
      type: "application/json"
    }),
    image = new Blob([new Uint8Array([0, 1, 127, 128, 255])], { type: "image/png" }),
    reference = { sha256: await sha256(image), size: image.size },
    bundle = await encodeBundle(
      { payload, images: [{ index: 0, body: image, reference, mimeType: "image/png" }] },
      {
        revisionId: operationId,
        deviceId: crypto.randomUUID(),
        parents: [],
        createdAt: new Date().toISOString(),
        digest: await sha256(payload)
      }
    ),
    name = `probe_${operationId}.mtp`;
  const item = await transport.putImmutable(name, bundle.body, bundle.reference),
    decoded = await decodeBundle(await transport.read(item, bundle.body.size));
  if (
    decoded.revision.revisionId !== operationId ||
    (await sha256(decoded.prepared.images[0]!.body)) !== reference.sha256
  )
    throw new YandexError("remote-invalid");
  if (cleanup) await transport.removeProbe(item);
  return Object.freeze({
    completed: true,
    uploadReadbackVerified: true,
    binaryRoundtripVerified: true,
    cleanup: cleanup ? "removed" : "retained",
    objectName: name
  });
}

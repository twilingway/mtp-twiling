import { assertCurrent, sha256, YandexError } from "./types.js";
import type { YandexFile, YandexReference } from "./types.js";
import type { YandexTransport } from "./transport.js";
import { decodeSlot, decodeSlotHeader, MAX_SLOT_BYTES, yandexHeaderSize } from "./slot-codec.js";
import { inspectSlots, isSlotName, slotName } from "./slot-model.js";
import type { SlotInspection, SlotPhysical, SlotVersion } from "./slot-model.js";

export const slotFingerprint = (files: readonly YandexFile[]): string =>
  JSON.stringify(
    [...files]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, md5, size, modified }) => [name, md5, size, modified])
  );
export interface SlotRemoteMetadata {
  seq: number;
  accepted: SlotVersion["accepted"];
}
export class YandexSlotStore {
  private readonly headers = new Map<string, SlotPhysical>();
  private readonly bodies = new Map<string, Awaited<ReturnType<typeof decodeSlot>>>();
  private bytes = 0;
  snapshot: SlotInspection | undefined;
  constructor(
    readonly transport: YandexTransport,
    private readonly signal: AbortSignal
  ) {}
  async inspect(files: readonly YandexFile[], valid: () => boolean): Promise<SlotInspection> {
    const slots: SlotPhysical[] = [];
    let headerBytes = 0;
    for (const file of files.filter(
      (item) => isSlotName(item.name) && !item.name.startsWith("probe_")
    )) {
      assertCurrent(this.signal, valid);
      const key = slotFingerprint([file]);
      let item = this.headers.get(key);
      if (!item) {
        const size = await yandexHeaderSize(await this.transport.readPrefix(file, 12));
        headerBytes += size;
        if (headerBytes > 32 * 1024 * 1024) throw new YandexError("limit");
        const envelope = await decodeSlotHeader(
          await this.transport.readPrefix(file, size),
          file.size
        );
        if (slotName(envelope.current.revision.deviceId, envelope.current.seq) !== file.name)
          throw new YandexError("remote-invalid");
        item = { file, envelope };
        this.headers.set(key, item);
      }
      slots.push(item);
    }
    assertCurrent(this.signal, valid);
    const snapshot = await inspectSlots(slots);
    assertCurrent(this.signal, valid);
    this.snapshot = snapshot;
    return snapshot;
  }
  async body(
    file: YandexFile,
    valid: () => boolean
  ): Promise<Awaited<ReturnType<typeof decodeSlot>>> {
    const key = slotFingerprint([file]);
    let body = this.bodies.get(key);
    if (!body) {
      this.bytes += file.size;
      if (this.bytes > MAX_SLOT_BYTES * 2) throw new YandexError("limit");
      body = await decodeSlot(await this.transport.read(file, MAX_SLOT_BYTES));
      this.bodies.set(key, body);
    }
    assertCurrent(this.signal, valid);
    return body;
  }
  async verified(
    file: YandexFile,
    reference: YandexReference,
    valid: () => boolean
  ): Promise<void> {
    if (
      file.size !== reference.size ||
      (await sha256(await this.transport.read(file, reference.size))) !== reference.sha256
    )
      throw new YandexError("conflict");
    assertCurrent(this.signal, valid);
  }
}
export function slotRemotes(snapshot: SlotInspection) {
  const unique = new Map<
    string,
    { file: YandexFile; revision: SlotVersion["revision"]; slot: SlotRemoteMetadata }
  >();
  for (const { file, envelope } of [...snapshot.latest, ...snapshot.uncertain])
    for (const version of [envelope.current, envelope.previous])
      if (version) {
        const prior = unique.get(version.revision.revisionId);
        if (prior && JSON.stringify(prior.revision) !== JSON.stringify(version.revision))
          throw new YandexError("conflict");
        if (!prior)
          unique.set(version.revision.revisionId, {
            file,
            revision: version.revision,
            slot: { seq: version.seq, accepted: version.accepted }
          });
      }
  return [...unique.values()];
}

import {
  hydrateDeviceSlotUploadBytes,
  runDriveSlotBinaryProbe
} from "./device-slot-binary-probe.js";
import { DRIVE_CLIENT_ID, DriveError } from "./types.js";
import type { DriveAuthorization } from "./types.js";
import { cleanupCapabilityProbes } from "./write-capability-cleanup.js";
import { capabilityAccountKey } from "./write-capability-identity.js";
import {
  addProbe,
  addProof,
  CAPABILITY_MAX_BYTES,
  CAPABILITY_REVISION,
  capabilityStorage,
  ownsCapabilityProbe,
  usableProof
} from "./write-capability-storage.js";
import type { CapabilityProof, CapabilityStorage } from "./write-capability-storage.js";

export interface WriteCapabilityStatus {
  phase: "checking" | "ready" | "cleanup-pending";
  verifiedBytes: number;
  requiredBytes: number;
  cleanupPending: number;
}
interface Options {
  authorization: DriveAuthorization;
  fetcher: typeof fetch;
  signal: AbortSignal;
  check(): void | Promise<void>;
  publish(status: WriteCapabilityStatus): void;
  storage?: CapabilityStorage;
  now?: () => number;
  accountKey?: typeof capabilityAccountKey;
  probe?: typeof runDriveSlotBinaryProbe;
}
export class DriveWriteCapability {
  private readonly storage: CapabilityStorage;
  private readonly now: () => number;
  private flight: Promise<CapabilityProof> | undefined;
  private probeResult: Awaited<ReturnType<typeof runDriveSlotBinaryProbe>> | undefined;
  constructor(private readonly options: Options) {
    this.storage = options.storage ?? capabilityStorage;
    this.now = options.now ?? Date.now;
  }
  private credential() {
    const id = this.options.authorization.credentialId;
    if (!id) throw new DriveError("auth-required", "Нужен повторный вход в Google.");
    return id;
  }
  private async check() {
    this.options.signal.throwIfAborted();
    this.options.authorization.signal.throwIfAborted();
    await this.options.check();
    this.options.signal.throwIfAborted();
    this.options.authorization.signal.throwIfAborted();
  }
  async restore(): Promise<void> {
    await this.check();
    const credentialId = this.credential();
    const data = await this.storage.read();
    await this.check();
    const proof = data.proofs
      .filter((item) => usableProof(item, credentialId, null, this.now()))
      .sort((a, b) => b.maxBytes - a.maxBytes)[0];
    if (proof)
      this.present(
        proof,
        0,
        data.journal.filter((item) => ownsCapabilityProbe(item, credentialId, null)).length
      );
  }
  private present(proof: CapabilityProof, requiredBytes: number, cleanupPending: number) {
    hydrateDeviceSlotUploadBytes(this.options.authorization, proof.maxBytes);
    this.options.publish({
      phase: cleanupPending ? "cleanup-pending" : "ready",
      verifiedBytes: proof.maxBytes,
      requiredBytes,
      cleanupPending
    });
  }
  async diagnose(imageBytes = 1024 * 1024) {
    await this.ensure(0, imageBytes, true);
    if (!this.probeResult) throw new DriveError("not-ready", "Проверка Google Диска не завершена.");
    return this.probeResult;
  }
  async ensure(
    requiredBytes: number,
    imageBytes?: number,
    force = false
  ): Promise<CapabilityProof> {
    if (
      !Number.isSafeInteger(requiredBytes) ||
      requiredBytes < 0 ||
      requiredBytes > CAPABILITY_MAX_BYTES
    )
      throw new DriveError(
        "limit",
        "Размер версии превышает поддерживаемую проверку загрузки Google Диска."
      );
    if (
      imageBytes !== undefined &&
      (!Number.isSafeInteger(imageBytes) || imageBytes < 1 || imageBytes > 2 * 1024 * 1024)
    )
      throw new RangeError("Invalid Drive binary probe size");
    await this.check();
    if (this.flight) {
      const proof = await this.flight;
      await this.check();
      if (!force && proof.maxBytes >= requiredBytes) return proof;
    }
    const job = this.ensureLocked(requiredBytes, imageBytes, force);
    this.flight = job;
    try {
      return await job;
    } finally {
      if (this.flight === job) this.flight = undefined;
    }
  }
  private async ensureLocked(
    requiredBytes: number,
    imageBytes: number | undefined,
    force: boolean
  ): Promise<CapabilityProof> {
    const { authorization: auth, fetcher, signal } = this.options;
    const credentialId = this.credential();
    const accountKey = await (this.options.accountKey ?? capabilityAccountKey)(
      auth,
      fetcher,
      signal
    );
    await this.check();
    const action = async () => {
      await this.check();
      const data = await this.storage.read();
      await this.check();
      let proof = force
        ? undefined
        : data.proofs
            .filter(
              (item) =>
                usableProof(item, credentialId, accountKey, this.now()) &&
                item.maxBytes >= requiredBytes &&
                (imageBytes === undefined || item.maxBytes >= 2 * imageBytes)
            )
            .sort((a, b) => b.maxBytes - a.maxBytes)[0];
      let cleanupPending = data.journal.filter((item) =>
        ownsCapabilityProbe(item, credentialId, accountKey)
      ).length;
      if (!proof) {
        this.options.publish({
          phase: "checking",
          verifiedBytes: 0,
          requiredBytes,
          cleanupPending
        });
        const imageSize =
          imageBytes ?? (requiredBytes <= 2 * 1024 * 1024 + 1999 ? 1024 * 1024 : 2 * 1024 * 1024);
        try {
          const result = await (this.options.probe ?? runDriveSlotBinaryProbe)(
            auth,
            fetcher,
            signal,
            imageSize,
            {
              reserved: async (id, key) => {
                await this.check();
                await this.storage.change(
                  (latest) =>
                    addProbe(latest, {
                      id,
                      key,
                      credentialId,
                      accountKey,
                      clientId: DRIVE_CLIENT_ID,
                      revision: CAPABILITY_REVISION,
                      namespace: "mtp-drive-cas-probe",
                      kind: "device-slot",
                      dispatched: false,
                      createdAt: this.now()
                    }),
                  signal
                );
              },
              dispatch: async (id) => {
                await this.check();
                await this.storage.change((latest) => {
                  const entry = latest.journal.find(
                    (item) => item.id === id && item.credentialId === credentialId
                  );
                  if (!entry)
                    throw new DriveError("local-save", "Не сохранён журнал проверочного файла.");
                  entry.dispatched = true;
                }, signal);
              }
            }
          );
          await this.check();
          this.probeResult = result;
          proof = {
            credentialId,
            accountKey,
            clientId: DRIVE_CLIENT_ID,
            revision: CAPABILITY_REVISION,
            protocol: 3,
            codec: 1,
            maxBytes: result.maxBytes,
            verifiedAt: this.now()
          };
          await this.storage.change((latest) => addProof(latest, proof!), signal);
        } finally {
          // A cancelled A job never retries cleanup through B authorization.
          if (!signal.aborted && !auth.signal.aborted) {
            await this.check();
            cleanupPending = await cleanupCapabilityProbes(
              auth,
              fetcher,
              this.storage,
              credentialId,
              accountKey,
              signal
            ).catch(() => cleanupPending + 1);
          }
        }
      } else {
        // The fresh about identity is required before an alias can be bound to this generation.
        if (
          proof.credentialId !== credentialId ||
          (proof.accountKey === null && accountKey !== null)
        ) {
          proof = { ...proof, credentialId, accountKey };
          await this.check();
          await this.storage.change((latest) => addProof(latest, proof!), signal);
        }
        cleanupPending = await cleanupCapabilityProbes(
          auth,
          fetcher,
          this.storage,
          credentialId,
          accountKey,
          signal
        ).catch(() => cleanupPending);
      }
      await this.check();
      if (!proof || proof.maxBytes < requiredBytes)
        throw new DriveError("limit", "Размер версии превышает проверенный размер загрузки.");
      this.present(proof, requiredBytes, cleanupPending);
      return proof;
    };
    const locks = globalThis.navigator?.locks;
    if (locks)
      return locks.request(
        `mtp-drive-capability:${CAPABILITY_REVISION}:${accountKey ?? credentialId}`,
        { mode: "exclusive", signal: AbortSignal.any([signal, auth.signal]) },
        action
      );
    if (typeof window !== "undefined")
      throw new DriveError(
        "not-ready",
        "Для синхронизации нужен браузер с поддержкой блокировок вкладок."
      );
    return action();
  }
}

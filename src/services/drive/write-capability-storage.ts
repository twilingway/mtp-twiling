import { isRecord } from "../../model/backup-format.js";
import { get, transaction } from "../storage-db.js";
import { DRIVE_CLIENT_ID, DriveError } from "./types.js";

export const CAPABILITY_REVISION = "drive-v2-put-sha256-v1";
export const CAPABILITY_TTL_MS = 24 * 60 * 60 * 1000;
export const CAPABILITY_MAX_BYTES = 2 * 2 * 1024 * 1024 + 1999;
const ID = "private:google-write-capability:v1";
const MAX_RECORDS = 16;
export interface CapabilityProof {
  credentialId: string;
  accountKey: string | null;
  clientId: typeof DRIVE_CLIENT_ID;
  revision: typeof CAPABILITY_REVISION;
  protocol: 3;
  codec: 1;
  maxBytes: number;
  verifiedAt: number;
}
export interface ProbeJournal {
  id: string;
  key: string;
  credentialId: string;
  accountKey: string | null;
  clientId: typeof DRIVE_CLIENT_ID;
  revision: typeof CAPABILITY_REVISION;
  namespace: "mtp-drive-cas-probe";
  kind: "device-slot";
  dispatched: boolean;
  createdAt: number;
}
export interface CapabilityData {
  proofs: CapabilityProof[];
  journal: ProbeJournal[];
}
export interface CapabilityStorage {
  read(): Promise<CapabilityData>;
  change(edit: (data: CapabilityData) => void, signal: AbortSignal): Promise<void>;
}
const invalid = () => new DriveError("local-save", "Локальная проверка Google Диска повреждена.");
const text = (value: unknown) => typeof value === "string" && /^[\w-]{1,200}$/.test(value);
const account = (value: unknown) =>
  value === null || (typeof value === "string" && /^[a-f\d]{64}$/.test(value));
function parse(input: unknown): CapabilityData {
  if (input === undefined) return { proofs: [], journal: [] };
  if (!isRecord(input) || !isRecord(input.value)) throw invalid();
  if (input.value.schemaVersion !== 1)
    throw new DriveError("unsupported-format", "Неизвестная локальная проверка Google Диска.");
  const { proofs, journal } = input.value;
  if (
    !Array.isArray(proofs) ||
    !Array.isArray(journal) ||
    proofs.length > MAX_RECORDS ||
    journal.length > MAX_RECORDS
  )
    throw invalid();
  const common = (item: unknown) =>
    isRecord(item) &&
    text(item.credentialId) &&
    account(item.accountKey) &&
    item.clientId === DRIVE_CLIENT_ID &&
    item.revision === CAPABILITY_REVISION;
  // A transport/codec revision invalidates old proof, rather than preventing a fresh probe.
  const compatible = proofs.filter(
    (item: unknown) =>
      isRecord(item) &&
      item.clientId === DRIVE_CLIENT_ID &&
      item.revision === CAPABILITY_REVISION &&
      item.protocol === 3 &&
      item.codec === 1
  );
  if (
    compatible.some(
      (item: unknown) =>
        !common(item) ||
        !isRecord(item) ||
        item.protocol !== 3 ||
        item.codec !== 1 ||
        !Number.isSafeInteger(item.maxBytes) ||
        Number(item.maxBytes) <= 0 ||
        Number(item.maxBytes) > CAPABILITY_MAX_BYTES ||
        !Number.isSafeInteger(item.verifiedAt) ||
        Number(item.verifiedAt) < 0
    )
  )
    throw invalid();
  if (
    journal.some(
      (item: unknown) =>
        !common(item) ||
        !isRecord(item) ||
        !text(item.id) ||
        typeof item.key !== "string" ||
        !/^[0-9a-f-]{36}_[0-9a-f-]{36}$/.test(item.key) ||
        item.namespace !== "mtp-drive-cas-probe" ||
        item.kind !== "device-slot" ||
        typeof item.dispatched !== "boolean" ||
        !Number.isSafeInteger(item.createdAt) ||
        Number(item.createdAt) < 0
    )
  )
    throw invalid();
  if (new Set(journal.map((item: ProbeJournal) => item.id)).size !== journal.length)
    throw invalid();
  return { proofs: compatible as CapabilityProof[], journal: journal as ProbeJournal[] };
}
export const capabilityStorage: CapabilityStorage = {
  async read() {
    return parse(await get("preferences", ID));
  },
  async change(edit, signal) {
    let failure: unknown;
    await transaction(
      ["preferences"],
      (tx) => {
        const store = tx.objectStore("preferences");
        const request = store.get(ID);
        request.onsuccess = () => {
          try {
            signal.throwIfAborted();
            const data = parse(request.result);
            edit(data);
            const value = { schemaVersion: 1, ...data };
            parse({ value });
            store.put({ id: ID, value });
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
      },
      signal
    ).catch((error: unknown) => {
      throw failure instanceof Error ? failure : error;
    });
  }
};
export function usableProof(
  proof: CapabilityProof,
  credentialId: string,
  accountKey: string | null,
  now: number
): boolean {
  return (
    proof.clientId === DRIVE_CLIENT_ID &&
    proof.revision === CAPABILITY_REVISION &&
    proof.protocol === 3 &&
    proof.codec === 1 &&
    (!accountKey || !proof.accountKey || proof.accountKey === accountKey) &&
    proof.verifiedAt <= now &&
    now - proof.verifiedAt < CAPABILITY_TTL_MS &&
    (proof.credentialId === credentialId || (!!accountKey && proof.accountKey === accountKey))
  );
}
export const ownsCapabilityProbe = (
  item: ProbeJournal,
  credentialId: string,
  accountKey: string | null
): boolean =>
  accountKey && item.accountKey
    ? accountKey === item.accountKey
    : item.credentialId === credentialId;
export function addProof(data: CapabilityData, proof: CapabilityProof) {
  data.proofs = data.proofs.filter(
    (item) =>
      item.credentialId !== proof.credentialId &&
      proof.verifiedAt - item.verifiedAt < CAPABILITY_TTL_MS
  );
  data.proofs.push(proof);
  data.proofs = data.proofs.slice(-MAX_RECORDS);
}
export function addProbe(data: CapabilityData, probe: ProbeJournal) {
  if (data.journal.length >= MAX_RECORDS || data.journal.some((item) => item.id === probe.id))
    throw new DriveError("quota", "Сначала завершите очистку проверочных файлов Google Диска.");
  data.journal.push(probe);
}

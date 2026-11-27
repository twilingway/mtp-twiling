import { MAX_TOTAL_BYTES, shaPattern, uuidPattern } from "./backup.js";
import { DriveError, type ContentReference } from "./types.js";

export const DEVICE_SLOT_PROTOCOL = 3;
export const DEVICE_SLOT_NAMESPACE = "mtp-drive-v3";
export const DEVICE_SLOT_TEST_DEVICE_ID = "00000000-0000-4000-8000-000000000001";
export const MAX_DEVICE_SLOTS = 256;
export const MAX_DEVICE_SLOT_SEQUENCE = 0x7fffffff;
const MAX_MANIFEST_IDENTITY_CHARS = MAX_DEVICE_SLOTS * 128 + 512;

export interface DeviceSlotScope {
  readonly workspaceId: string;
  readonly legacyArchive: string | null;
}
export interface DeviceRevision {
  readonly deviceId: string;
  readonly seq: number;
  readonly revisionId: string;
}
export interface DeviceSlotManifest extends DeviceSlotScope, DeviceRevision {
  readonly protocol: typeof DEVICE_SLOT_PROTOCOL;
  readonly previousRevisionId: string | null;
  readonly accepted: readonly DeviceRevision[];
  readonly payload: Readonly<ContentReference>;
}
export interface DeviceSlotEnvelope {
  readonly protocol: typeof DEVICE_SLOT_PROTOCOL;
  readonly current: DeviceSlotManifest;
  readonly previous: DeviceSlotManifest | null;
}
export interface DeviceSlotFile {
  readonly fileId: string;
  /** SHA-256 of the envelope bytes, verified before the transport exposes the file. */
  readonly envelopeHash: string;
  readonly envelope: DeviceSlotEnvelope;
}
export interface DeviceSlotObservation extends DeviceRevision {
  readonly fileId: string;
  readonly envelopeHash: string;
  readonly currentManifestIdentity: string;
}
export interface DeviceSlotCheckpoint extends DeviceSlotScope {
  readonly observed: readonly DeviceSlotObservation[];
}

const inspected = Symbol("validated device slots");
export interface DeviceSlotInspection extends DeviceSlotScope {
  readonly [inspected]: true;
  readonly files: readonly DeviceSlotFile[];
  readonly heads: readonly DeviceRevision[];
  readonly checkpoint: DeviceSlotCheckpoint;
}
interface DeviceSlotDraft {
  readonly deviceId: string;
  readonly revisionId: string;
  readonly payload: Readonly<ContentReference>;
  readonly expected: DeviceSlotObservation | null;
}
export type DeviceSlotWriteRequest = DeviceSlotDraft &
  (
    | { readonly mode: "publish"; readonly basedOn: readonly DeviceRevision[] }
    | {
        readonly mode: "resolve";
        readonly confirmedHeads: readonly DeviceRevision[];
        readonly chosen: "local" | DeviceRevision;
      }
  );
export type DeviceSlotWritePlan = {
  readonly key: string;
  readonly envelope: DeviceSlotEnvelope;
} & (
  | { readonly kind: "create" }
  | { readonly kind: "replace"; readonly expected: DeviceSlotObservation }
);

export type DeviceSlotIssue =
  | "invalid"
  | "format"
  | "scope"
  | "legacy"
  | "duplicate"
  | "fork"
  | "missing"
  | "rollback"
  | "causality"
  | "stale-device"
  | "stale-heads"
  | "resolve"
  | "limit";
export class DeviceSlotError extends DriveError {
  constructor(public readonly issue: DeviceSlotIssue) {
    super(
      issue === "format"
        ? "unsupported-format"
        : issue === "limit"
          ? "limit"
          : issue === "invalid" || issue === "causality"
            ? "remote-invalid"
            : "conflict",
      `Google Drive device slot: ${issue}`
    );
    this.name = "DeviceSlotError";
  }
}

function fail(issue: DeviceSlotIssue): never {
  throw new DeviceSlotError(issue);
}
function field(object: object, name: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  if (!descriptor || !("value" in descriptor)) return fail("invalid");
  return descriptor.value;
}
function readObject(input: unknown, keys: readonly string[]): { get: (name: string) => unknown } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("invalid");
  const names = Reflect.ownKeys(input);
  if (names.some((key) => typeof key !== "string" || !keys.includes(key))) return fail("format");
  if (names.length !== keys.length) return fail("invalid");
  return { get: (name) => field(input, name) };
}
function list<T>(input: unknown, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(input)) return fail("invalid");
  if (input.length > MAX_DEVICE_SLOTS) return fail("limit");
  return Array.from({ length: input.length }, (_, index) => parse(field(input, index)));
}
function id(value: unknown): string {
  if (typeof value !== "string" || value !== value.toLowerCase() || !uuidPattern.test(value))
    return fail("invalid");
  return value;
}
function physicalId(value: unknown): string {
  if (typeof value !== "string" || !/^[\w-]{1,200}$/.test(value)) return fail("invalid");
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !shaPattern.test(value)) return fail("invalid");
  return value;
}
function sequence(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_DEVICE_SLOT_SEQUENCE
  )
    return fail("invalid");
  return value;
}
function payloadReference(value: unknown): Readonly<ContentReference> {
  const { get } = readObject(value, ["sha256", "size"]);
  const sha256 = hash(get("sha256"));
  const size = get("size");
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1) return fail("invalid");
  if (size > MAX_TOTAL_BYTES) return fail("limit");
  return Object.freeze({ sha256, size });
}
const revisionKeys = ["deviceId", "seq", "revisionId"];
const scopeKeys = ["workspaceId", "legacyArchive"];
const observationKeys = [...revisionKeys, "fileId", "envelopeHash", "currentManifestIdentity"];
function readRevision({ get }: ReturnType<typeof readObject>): DeviceRevision {
  return Object.freeze({
    deviceId: id(get("deviceId")),
    seq: sequence(get("seq")),
    revisionId: id(get("revisionId"))
  });
}
function readObserved(input: unknown): DeviceSlotObservation {
  const value = readObject(input, observationKeys);
  const currentManifestIdentity = value.get("currentManifestIdentity");
  if (
    typeof currentManifestIdentity !== "string" ||
    !currentManifestIdentity.length ||
    currentManifestIdentity.length > MAX_MANIFEST_IDENTITY_CHARS
  )
    return fail("invalid");
  return Object.freeze({
    ...readRevision(value),
    fileId: physicalId(value.get("fileId")),
    envelopeHash: hash(value.get("envelopeHash")),
    currentManifestIdentity
  });
}
function readScope({ get }: ReturnType<typeof readObject>): DeviceSlotScope {
  const legacy = get("legacyArchive");
  return {
    workspaceId: id(get("workspaceId")),
    legacyArchive: legacy === null ? null : hash(legacy)
  };
}
function assertScope(actual: DeviceSlotScope, expected: DeviceSlotScope): void {
  if (actual.workspaceId !== expected.workspaceId) fail("scope");
  if (actual.legacyArchive !== expected.legacyArchive) fail("legacy");
}
function ordered<T extends DeviceRevision>(items: T[]): T[] {
  return items.sort((a, b) => (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0));
}
function uniqueDevices<T extends DeviceRevision>(values: readonly T[]): Map<string, T> {
  const devices = new Map(values.map((value) => [value.deviceId, value]));
  if (devices.size !== values.length) fail("duplicate");
  return devices;
}
function vector(input: unknown): readonly DeviceRevision[] {
  const entries = list(input, (value) => readRevision(readObject(value, revisionKeys)));
  uniqueDevices(entries);
  return Object.freeze(ordered(entries));
}
function same(left: DeviceRevision | undefined, right: DeviceRevision): boolean {
  return (
    left?.deviceId === right.deviceId &&
    left.seq === right.seq &&
    left.revisionId === right.revisionId
  );
}
function includes(vector: ReadonlyMap<string, DeviceRevision>, target: DeviceRevision): boolean {
  const revision = vector.get(target.deviceId);
  return !!revision && (revision.seq > target.seq || same(revision, target));
}

export function deviceSlotKey(workspaceId: string, deviceId: string): string {
  return `${id(workspaceId)}_${id(deviceId)}`;
}

/** Parse metadata only. The transport verifies and validates the portable content separately. */
export function parseDeviceSlotManifest(input: unknown): DeviceSlotManifest {
  const value = readObject(input, [
    "protocol",
    ...scopeKeys,
    ...revisionKeys,
    "previousRevisionId",
    "accepted",
    "payload"
  ]);
  if (value.get("protocol") !== DEVICE_SLOT_PROTOCOL) return fail("format");
  const revision = readRevision(value);
  const prior = value.get("previousRevisionId");
  const previousRevisionId = prior === null ? null : id(prior);
  const accepted = vector(value.get("accepted"));
  if (
    (revision.seq === 1) !== (previousRevisionId === null) ||
    previousRevisionId === revision.revisionId ||
    !same(
      accepted.find((entry) => entry.deviceId === revision.deviceId),
      revision
    )
  )
    return fail("causality");
  return Object.freeze({
    protocol: DEVICE_SLOT_PROTOCOL,
    ...readScope(value),
    ...revision,
    previousRevisionId,
    accepted,
    payload: payloadReference(value.get("payload"))
  });
}

export function parseDeviceSlotEnvelope(input: unknown): DeviceSlotEnvelope {
  const { get } = readObject(input, ["protocol", "current", "previous"]);
  if (get("protocol") !== DEVICE_SLOT_PROTOCOL) return fail("format");
  const current = parseDeviceSlotManifest(get("current"));
  const prior = get("previous");
  const previous = prior === null ? null : parseDeviceSlotManifest(prior);
  if ((current.seq === 1) !== (previous === null)) return fail("causality");
  if (previous) {
    assertScope(previous, current);
    const accepted = uniqueDevices(current.accepted);
    if (
      previous.deviceId !== current.deviceId ||
      previous.seq !== current.seq - 1 ||
      previous.revisionId !== current.previousRevisionId ||
      !previous.accepted.every((entry) => includes(accepted, entry))
    )
      return fail("causality");
  }
  return Object.freeze({ protocol: DEVICE_SLOT_PROTOCOL, current, previous });
}

/** Check all independent claims, including the last durable checkout and immediate predecessors. */
function revisionRegistry() {
  const bySequence = new Map<string, string>();
  const byId = new Map<string, string>();
  return ({ deviceId, seq, revisionId }: DeviceRevision) => {
    const key = `${deviceId}/${seq}`;
    const oldId = bySequence.get(key);
    const oldKey = byId.get(revisionId);
    if ((oldId !== undefined && oldId !== revisionId) || (oldKey !== undefined && oldKey !== key))
      fail("fork");
    bySequence.set(key, revisionId);
    byId.set(revisionId, key);
  };
}
function revisionOf({ deviceId, seq, revisionId }: DeviceRevision): DeviceRevision {
  return Object.freeze({ deviceId, seq, revisionId });
}
/** Only serialize parsed manifests, whose fields and revision vectors are ordered canonically. */
function manifestIdentity(manifest: DeviceSlotManifest): string {
  return JSON.stringify(manifest);
}
function observation({ fileId, envelopeHash, envelope }: DeviceSlotFile): DeviceSlotObservation {
  return Object.freeze({
    fileId,
    envelopeHash,
    currentManifestIdentity: manifestIdentity(envelope.current),
    ...revisionOf(envelope.current)
  });
}
function sameObservation(left: DeviceSlotObservation | undefined, right: DeviceSlotObservation) {
  return (
    !!left &&
    same(left, right) &&
    left.fileId === right.fileId &&
    left.envelopeHash === right.envelopeHash &&
    left.currentManifestIdentity === right.currentManifestIdentity
  );
}
function readCheckpoint(input: DeviceSlotCheckpoint, expected: DeviceSlotScope) {
  const checkpoint = readObject(input, [...scopeKeys, "observed"]);
  assertScope(readScope(checkpoint), expected);
  const observed = list(checkpoint.get("observed"), readObserved);
  uniqueDevices(observed);
  if (new Set(observed.map((value) => value.fileId)).size !== observed.length) fail("duplicate");
  return observed;
}

export function parseDeviceSlotCheckpoint(value: unknown): DeviceSlotCheckpoint {
  const object = readObject(value, [...scopeKeys, "observed"]);
  const scope = readScope(object);
  const observed = list(object.get("observed"), readObserved);
  uniqueDevices(observed);
  if (new Set(observed.map((entry) => entry.fileId)).size !== observed.length) fail("duplicate");
  return Object.freeze({ ...scope, observed: Object.freeze(ordered(observed)) });
}

export function inspectDeviceSlots(
  input: unknown,
  scope: DeviceSlotScope,
  checkpoint?: DeviceSlotCheckpoint
): DeviceSlotInspection {
  const expected = readScope(readObject(scope, scopeKeys));
  const files = list(input, (value) => {
    const { get } = readObject(value, ["fileId", "envelopeHash", "envelope"]);
    const envelope = parseDeviceSlotEnvelope(get("envelope"));
    assertScope(envelope.current, expected);
    return Object.freeze({
      fileId: physicalId(get("fileId")),
      envelopeHash: hash(get("envelopeHash")),
      envelope
    });
  });
  const manifests = uniqueDevices(files.map(({ envelope }) => envelope.current));
  const observed = ordered(files.map(observation));
  if (new Set(observed.map((value) => value.fileId)).size !== observed.length) fail("duplicate");
  const register = revisionRegistry();
  const observedByDevice = uniqueDevices(observed);
  const previousByDevice = new Map(
    files.map(({ envelope }) => [envelope.current.deviceId, envelope.previous])
  );
  for (const previous of checkpoint ? readCheckpoint(checkpoint, expected) : []) {
    register(previous);
    const current = observedByDevice.get(previous.deviceId);
    if (!current) return fail("missing");
    if (current.fileId !== previous.fileId) return fail("fork");
    if (current.seq < previous.seq) return fail("rollback");
    if (current.seq === previous.seq && !sameObservation(current, previous)) return fail("fork");
    if (current.seq === previous.seq + 1) {
      const retained = previousByDevice.get(previous.deviceId);
      if (!retained || manifestIdentity(retained) !== previous.currentManifestIdentity)
        return fail("fork");
    }
  }
  const versions = files.flatMap(({ envelope: { current, previous } }) =>
    previous ? [current, previous] : [current]
  );
  for (const manifest of versions) {
    register(manifest);
    if (manifest.previousRevisionId)
      register({
        deviceId: manifest.deviceId,
        seq: manifest.seq - 1,
        revisionId: manifest.previousRevisionId
      });
    for (const claim of manifest.accepted) {
      register(claim);
      const current = manifests.get(claim.deviceId);
      if (!current) return fail("missing");
      if (current.seq < claim.seq) return fail("rollback");
    }
  }

  const retained = new Map(versions.map((version) => [version.revisionId, version]));
  const visited = new Map<DeviceSlotManifest, "visiting" | "validated">();
  const dominated = new Set<string>();
  function visit(manifest: DeviceSlotManifest): void {
    const state = visited.get(manifest);
    if (state === "visiting") return fail("causality");
    if (state === "validated") return;
    visited.set(manifest, "visiting");
    const previous = manifest.previousRevisionId && retained.get(manifest.previousRevisionId);
    if (previous) visit(previous);
    const vector = uniqueDevices(manifest.accepted);
    for (const claim of manifest.accepted) {
      if (claim.deviceId === manifest.deviceId) continue;
      const source = retained.get(claim.revisionId);
      if (!source) continue;
      if (!source.accepted.every((entry) => includes(vector, entry))) return fail("causality");
      visit(source);
      if (
        manifests.get(manifest.deviceId) === manifest &&
        manifests.get(source.deviceId) === source
      )
        dominated.add(source.deviceId);
    }
    visited.set(manifest, "validated");
  }
  versions.forEach(visit);
  const heads = observed.filter((value) => !dominated.has(value.deviceId)).map(revisionOf);
  return Object.freeze({
    [inspected]: true as const,
    ...expected,
    files: Object.freeze(files),
    heads: Object.freeze(heads),
    checkpoint: Object.freeze({ ...expected, observed: Object.freeze(observed) })
  });
}

function assertHeadSet(expected: readonly DeviceRevision[], actual: readonly DeviceRevision[]) {
  const pins = uniqueDevices(vector(expected));
  if (
    pins.size !== actual.length ||
    !actual.every((value) => same(pins.get(value.deviceId), value))
  )
    fail("stale-heads");
}

/** This plan requires the transport to recheck the scope and use a conditional file write. */
export function planDeviceSlotWrite(
  snapshot: DeviceSlotInspection,
  request: DeviceSlotWriteRequest
): DeviceSlotWritePlan {
  if (snapshot[inspected] !== true) return fail("invalid");
  const deviceId = id(request.deviceId);
  const revisionId = id(request.revisionId);
  const payload = payloadReference(request.payload);
  const ownFile = snapshot.files.find(({ envelope }) => envelope.current.deviceId === deviceId);
  const own = snapshot.checkpoint.observed.find((value) => value.deviceId === deviceId);
  const pin = request.expected === null ? null : readObserved(request.expected);
  if (pin ? !sameObservation(own, pin) : !!own) return fail("stale-device");
  const seq = (own?.seq ?? 0) + 1;
  if (seq > MAX_DEVICE_SLOT_SEQUENCE || (!own && snapshot.files.length >= MAX_DEVICE_SLOTS))
    return fail("limit");

  if (request.mode === "publish") {
    if (snapshot.heads.length > 1) return fail("resolve");
    assertHeadSet(request.basedOn, snapshot.heads);
  } else {
    assertHeadSet(request.confirmedHeads, snapshot.heads);
    if (!snapshot.heads.length) return fail("resolve");
    if (request.chosen !== "local") {
      const choice = readRevision(readObject(request.chosen, revisionKeys));
      const selected = snapshot.files.find(({ envelope }) => same(envelope.current, choice))
        ?.envelope.current;
      if (
        !selected ||
        !snapshot.heads.some((head) => same(head, choice)) ||
        selected.payload.sha256 !== payload.sha256 ||
        selected.payload.size !== payload.size
      )
        return fail("resolve");
    }
  }

  const accepted = snapshot.checkpoint.observed
    .filter((entry) => entry.deviceId !== deviceId)
    .map(revisionOf);
  accepted.push({ deviceId, seq, revisionId });
  const current = {
    protocol: DEVICE_SLOT_PROTOCOL,
    workspaceId: snapshot.workspaceId,
    legacyArchive: snapshot.legacyArchive,
    deviceId,
    seq,
    revisionId,
    previousRevisionId: own?.revisionId ?? null,
    accepted,
    payload
  };
  const envelope = parseDeviceSlotEnvelope({
    protocol: DEVICE_SLOT_PROTOCOL,
    current,
    previous: ownFile?.envelope.current ?? null
  });
  if (
    snapshot.files.some(({ envelope: existing }) =>
      [existing.current, existing.previous].some(
        (version) =>
          version?.previousRevisionId === revisionId ||
          version?.accepted.some((entry) => entry.revisionId === revisionId)
      )
    )
  )
    return fail("fork");
  const key = deviceSlotKey(snapshot.workspaceId, deviceId);
  return Object.freeze(
    own ? { kind: "replace", key, envelope, expected: own } : { kind: "create", key, envelope }
  );
}

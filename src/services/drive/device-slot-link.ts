import type { GoogleSlotScope } from "./device-slot-context.js";
import type {
  DeviceSlotRecord,
  loadDeviceSlotRecord,
  saveDeviceSlotRecord
} from "./device-slot-local.js";
import { DriveError } from "./types.js";
import type { DriveAuthorization } from "./types.js";
import {
  GOOGLE_SLOT_ACTIVE_OWNER,
  GOOGLE_SLOT_EXPLICIT_OWNER,
  googleSlotStorageOwner
} from "./workspace-binding.js";

interface Access {
  load: typeof loadDeviceSlotRecord;
  save: typeof saveDeviceSlotRecord;
}
export interface GoogleSlotTarget {
  readonly owner: string;
  readonly record: DeviceSlotRecord;
  readonly pointer: DeviceSlotRecord | undefined;
  readonly enabled: boolean | undefined;
}

export const matchesGoogleSlotCredential = (
  scope: GoogleSlotScope,
  record: DeviceSlotRecord,
  authorization: DriveAuthorization
) =>
  !scope.associationConflict ||
  (!!record.explicitGoogleCredential &&
    record.explicitGoogleCredential === authorization.credentialId);

export async function loadGoogleSlotTarget(
  scope: GoogleSlotScope,
  access: Access
): Promise<GoogleSlotTarget> {
  const pointer = scope.associationConflict
    ? await access.load(GOOGLE_SLOT_ACTIVE_OWNER)
    : undefined;
  const owner = pointer?.activeGoogleSlotOwner ?? googleSlotStorageOwner(scope);
  const record = await access.load(owner);
  if (pointer?.activeGoogleSlotOwner && !record.explicitGoogleCredential)
    throw new DriveError("remote-invalid", "Локальная привязка аккаунта Google повреждена.");
  return { owner, record, pointer, enabled: pointer?.enabled ?? record.enabled };
}

interface ConnectionAccess extends Access {
  auth: { restore(owner: string): Promise<DriveAuthorization | undefined> };
  hasHistory(owner: string): Promise<boolean>;
}

export async function restoreGoogleSlotTarget(
  scope: GoogleSlotScope,
  access: ConnectionAccess,
  isCurrent: () => boolean
) {
  const target = await loadGoogleSlotTarget(scope, access);
  if (!isCurrent()) return;
  if (target.enabled === false) return { target, enabled: false };
  const { owner, record } = target;
  const authorization =
    !scope.associationConflict || record.explicitGoogleCredential
      ? await access.auth.restore(owner)
      : undefined;
  if (!isCurrent()) return;
  const enabled =
    target.enabled === true ||
    (!scope.associationConflict && (!!authorization || (await access.hasHistory(owner))));
  if (isCurrent())
    return {
      target,
      enabled,
      authorization:
        authorization && matchesGoogleSlotCredential(scope, record, authorization)
          ? authorization
          : undefined
    };
}

/** Build a new isolated account record before switching the durable pointer. */
async function activateExplicitGoogleSlot(
  prior: GoogleSlotTarget,
  owner: string,
  credentialId: string,
  access: Access,
  signal: AbortSignal
): Promise<GoogleSlotTarget> {
  if (!prior.pointer || prior.enabled !== true)
    throw new DriveError("auth-required", "Включите Google Диск перед подключением.");
  const empty = await access.load(owner);
  if (empty.generation !== 0) throw new DriveError("conflict", "Привязка Google уже существует.");
  signal.throwIfAborted();
  const record = await access.save(
    owner,
    empty,
    {
      explicitGoogleCredential: credentialId,
      automatic: prior.record.automatic,
      mode: prior.record.mode
    },
    signal
  );
  signal.throwIfAborted();
  const pointer = await access.save(
    GOOGLE_SLOT_ACTIVE_OWNER,
    prior.pointer,
    {
      activeGoogleSlotOwner: owner,
      enabled: true
    },
    signal
  );
  return { owner, record, pointer, enabled: pointer.enabled ?? prior.enabled };
}

interface ConnectAccess extends Access {
  auth: { connectFromUserGesture(owner: string): Promise<DriveAuthorization> };
}

export async function connectGoogleSlotTarget(
  scope: GoogleSlotScope,
  access: ConnectAccess,
  lifecycle: AbortSignal,
  isCurrent: () => boolean
): Promise<{ authorization: DriveAuthorization; target?: GoogleSlotTarget } | undefined> {
  if (!scope.associationConflict)
    return { authorization: await access.auth.connectFromUserGesture(scope.cloudOwner) };
  const owner = `${GOOGLE_SLOT_EXPLICIT_OWNER}:${crypto.randomUUID()}`;
  const [authorization, prior] = await Promise.all([
    access.auth.connectFromUserGesture(owner),
    loadGoogleSlotTarget(scope, access)
  ]);
  const signal = AbortSignal.any([lifecycle, authorization.signal]);
  if (!isCurrent() || signal.aborted) return;
  if (!authorization.credentialId)
    throw new DriveError("auth-required", "Нужен повторный вход в Google.");
  const target = await activateExplicitGoogleSlot(
    prior,
    owner,
    authorization.credentialId,
    access,
    signal
  );
  return { authorization, target };
}

export async function updateGoogleSlotTarget(
  target: GoogleSlotTarget,
  patch: Partial<DeviceSlotRecord>,
  access: Access,
  signal: AbortSignal
): Promise<GoogleSlotTarget> {
  if (target.pointer && patch.enabled !== undefined) {
    const pointer = await access.save(
      GOOGLE_SLOT_ACTIVE_OWNER,
      target.pointer,
      { enabled: patch.enabled },
      signal
    );
    return { ...target, pointer, enabled: pointer.enabled };
  }
  const record = await access.save(target.owner, target.record, patch, signal);
  return { ...target, record, enabled: target.pointer?.enabled ?? record.enabled };
}

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

function pointerLock<T>(mode: LockMode, signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const locks = globalThis.navigator?.locks;
  if (locks) return locks.request(GOOGLE_SLOT_ACTIVE_OWNER, { mode, signal }, action);
  if (mode === "shared" && typeof window !== "undefined")
    return Promise.reject(
      new DriveError(
        "not-ready",
        "Откройте приложение в защищённом браузере для синхронизации Google."
      )
    );
  return action();
}

/** A job can finish only while the same account pointer and enable generation remain active. */
export function googleSlotFence(
  target: GoogleSlotTarget,
  access: Pick<Access, "load">,
  signal: AbortSignal,
  isCurrent: () => boolean,
  onStale: (enabled: boolean) => void
) {
  const expected = target.pointer;
  const assertJob = () => {
    signal.throwIfAborted();
    if (!isCurrent()) throw new DOMException("Google sync operation ended.", "AbortError");
  };
  const check = async () => {
    assertJob();
    if (!expected) return;
    const actual = await access.load(GOOGLE_SLOT_ACTIVE_OWNER);
    assertJob();
    if (
      actual.generation !== expected.generation ||
      actual.activeGoogleSlotOwner !== expected.activeGoogleSlotOwner ||
      actual.enabled === false
    ) {
      onStale(actual.enabled !== false);
      assertJob();
      throw new DOMException("The active Google account changed.", "AbortError");
    }
  };
  const effect = async <T>(action: () => T | Promise<T>): Promise<T> => {
    if (!expected) {
      assertJob();
      return action();
    }
    return pointerLock("shared", signal, async () => {
      await check();
      return action();
    });
  };
  const guardFetch =
    (fetcher: typeof fetch): typeof fetch =>
    async (input, init) => {
      if (!expected || !["POST", "PATCH", "PUT"].includes(init?.method ?? "GET"))
        return fetcher(input, init);
      // The lock covers dispatch only. A later disable need not wait for Google to answer.
      const { response } = await effect(() => ({ response: fetcher(input, init) }));
      return response;
    };
  return { check, effect, guardFetch };
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
  const previous = prior.pointer;
  const pointer = await pointerLock("exclusive", signal, () =>
    access.save(
      GOOGLE_SLOT_ACTIVE_OWNER,
      previous,
      { activeGoogleSlotOwner: owner, enabled: true },
      signal
    )
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
    const { pointer: previous } = target;
    const pointer = await pointerLock("exclusive", signal, () =>
      access.save(GOOGLE_SLOT_ACTIVE_OWNER, previous, { enabled: patch.enabled }, signal)
    );
    return { ...target, pointer, enabled: pointer.enabled };
  }
  const record = await access.save(target.owner, target.record, patch, signal);
  return { ...target, record, enabled: target.pointer?.enabled ?? record.enabled };
}

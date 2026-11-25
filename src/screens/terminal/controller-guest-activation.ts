import type { SessionBridge } from "./controller-bridge.js";

/** Before installation a transfer cancels adoption; afterwards it only retires the old warning. */
export function guestActivationFence(
  bridge: SessionBridge,
  owner: () => string,
  current: () => boolean,
  abort: AbortController,
  enabled: boolean
) {
  const initial = bridge.getState();
  let interrupted = false,
    warningCancelled = false,
    prepared = false,
    committing = false,
    revision = initial.chartRevision,
    initialImport = !!initial.importingBackup,
    initialRecovery = !!initial.importRecoveryRequired;
  const observe = () => {
    if (!current()) {
      interrupted = true;
      warningCancelled = true;
      abort.abort();
      return;
    }
    if (!enabled) return;
    const state = bridge.getState();
    if (!state.importingBackup) initialImport = false;
    if (!state.importRecoveryRequired) initialRecovery = false;
    if (committing) revision = state.chartRevision;
    const boundary =
      (!initialImport && state.importingBackup) ||
      (!initialRecovery && state.importRecoveryRequired) ||
      (!committing && state.chartRevision !== revision) ||
      (state.owner !== initial.owner && state.owner !== owner());
    if (boundary) {
      warningCancelled = true;
      if (!prepared) {
        interrupted = true;
        abort.abort();
      }
    }
  };
  const dispose = enabled ? (bridge.subscribe?.(observe) ?? (() => {})) : () => {};
  return {
    canAdopt: !initial.importingBackup && !initial.importRecoveryRequired,
    valid: () => {
      observe();
      return !interrupted && current();
    },
    beforeProfileCommit: () => {
      committing = true;
    },
    afterProfileCommit: () => {
      revision = bridge.getState().chartRevision;
      committing = false;
      prepared = true;
    },
    warningAllowed: () => {
      observe();
      return !interrupted && !warningCancelled && current();
    },
    dispose
  };
}

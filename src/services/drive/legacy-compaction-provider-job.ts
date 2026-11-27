import type { GoogleSlotScope } from "./device-slot-context.js";
import type { GoogleSlotTarget } from "./device-slot-link.js";
import type { GoogleSlotDependencies } from "./device-slot-operation.js";
import type { GoogleStatus } from "./device-slot-status.js";
import type { GoogleLegacyJob } from "./legacy-compaction-google.js";
import type { DriveAuthorization } from "./types.js";

interface Options {
  dependencies: GoogleSlotDependencies;
  signal: AbortSignal;
  scope(): GoogleSlotScope;
  authorization(): DriveAuthorization | undefined;
  target(): GoogleSlotTarget | undefined;
  state(): GoogleStatus;
  epoch(): number;
  current(epoch: number): boolean;
  operation(): object | undefined;
  claim(operation: object | undefined): void;
  timer(): ReturnType<typeof setTimeout> | undefined;
  clearTimer(): void;
  intentRevision(): number;
  reset(enabled?: boolean): void;
  update(patch: Partial<GoogleStatus>): void;
  schedule(): void;
}

/** Maintenance shares account exclusion with sync while preserving only existing/deferred intent. */
export function takeGoogleLegacyJob(options: Options): GoogleLegacyJob | undefined {
  const authorization = options.authorization(),
    scope = options.scope();
  if (
    !authorization ||
    !options.target() ||
    !options.state().enabled ||
    options.operation() ||
    !scope.ready ||
    scope.blocked
  )
    return;
  const epoch = options.epoch(),
    job = {};
  const automaticPending = options.timer() !== undefined,
    intentRevision = options.intentRevision();
  if (automaticPending) options.clearTimer();
  options.claim(job);
  const signal = AbortSignal.any([options.signal, authorization.signal]);
  const current = () =>
    !signal.aborted &&
    options.current(epoch) &&
    options.authorization() === authorization &&
    options.operation() === job &&
    options.state().enabled;
  return {
    authorization,
    scope,
    dependencies: options.dependencies,
    signal,
    current,
    reset: (enabled) => options.reset(enabled),
    update: (patch) => {
      if (current()) options.update(patch);
    },
    status: () => options.state(),
    finish: () => {
      if (options.operation() !== job) return;
      options.claim(undefined);
      if (automaticPending || intentRevision !== options.intentRevision()) options.schedule();
    }
  };
}

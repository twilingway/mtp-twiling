import { pinSelectedInstrument, selectedMarketRow } from "../../model/selected-instrument.js";
import { retainNativeChartType } from "../../model/native-chart-type.js";
import { viewKey } from "./controller-bridge.js";
import { importWritable } from "./controller-transfer-guard.js";
import type { TerminalPreferences, TerminalState } from "./state.js";

export function mergeRoutingPreferences(state: TerminalState, patch: Partial<TerminalPreferences>) {
  const next = { ...state.preferences, ...patch };
  if (patch.chartSettings)
    next.chartSettings = retainNativeChartType(
      state.preferences.chartSettings,
      patch.chartSettings
    );
  if ("symbol" in patch && !("instrumentUid" in patch)) delete next.instrumentUid;
  const pinned = pinSelectedInstrument(state.rows, next),
    selected = selectedMarketRow(state.rows, pinned);
  if (selected?.providerRef) pinned.providerRef = selected.providerRef;
  else delete pinned.providerRef;
  return pinned;
}

interface ScopeBridge {
  getSnapshot(): TerminalState;
  sessionKey(): unknown;
  subscribe(listener: () => void): () => void;
}
export function preferenceRoutingScope(
  bridge: ScopeBridge,
  alive: () => boolean,
  valid: () => boolean
) {
  const initial = bridge.getSnapshot(),
    owner = initial.owner,
    client = bridge.sessionKey(),
    revision = initial.chartRevision,
    key = viewKey(initial.preferences),
    uid = selectedMarketRow(initial.rows, initial.preferences)?.uid;
  let cancelled = false,
    accepted = false;
  const current = () => {
    const state = bridge.getSnapshot();
    return (
      !cancelled &&
      alive() &&
      bridge.sessionKey() === client &&
      importWritable(state, owner) &&
      state.chartRevision === revision &&
      (accepted ||
        (viewKey(state.preferences) === key &&
          selectedMarketRow(state.rows, state.preferences)?.uid === uid &&
          valid()))
    );
  };
  const dispose = bridge.subscribe(() => {
    if (!current()) cancelled = true;
  });
  return {
    current,
    accept: () => {
      accepted = true;
    },
    dispose
  };
}
type Scope = ReturnType<typeof preferenceRoutingScope>;
interface DepthGuard {
  active: boolean;
  valid(): boolean;
  dispose(): void;
}
interface Intent {
  patch: Partial<TerminalPreferences>;
  forceReload: boolean;
  scope: Scope;
  depth?: DepthGuard;
  resolve(): void;
  reject(error: unknown): void;
}
/** Only precommit work is serialized. Completed intents may still await their own network load. */
export class PreferenceRouting {
  private readonly pending: Intent[] = [];
  private version = 0;
  private running = false;
  private generation = 0;
  commit(): number {
    return ++this.generation;
  }
  isCommitted(generation: number): boolean {
    return generation === this.generation;
  }
  async enqueue(
    patch: Partial<TerminalPreferences>,
    forceReload: boolean,
    scope: Scope,
    process: () => Promise<void>
  ): Promise<void> {
    try {
      if (!scope.current()) {
        scope.dispose();
        return Promise.resolve();
      }
    } catch (error) {
      scope.dispose();
      throw error;
    }
    const result = new Promise<void>((resolve, reject) => {
      this.pending.push({ patch: { ...patch }, forceReload, scope, resolve, reject });
      this.version++;
    });
    if (!this.running) void this.drain(process);
    return result;
  }
  batch(depthGuard: (patch: Partial<TerminalPreferences>) => DepthGuard) {
    for (const intent of [...this.pending]) {
      if (!intent.scope.current()) this.finish([intent]);
      else {
        intent.depth ??= depthGuard(intent.patch);
        if (!intent.depth.valid()) this.finish([intent]);
      }
    }
    const intents = [...this.pending];
    if (!intents.length) return null;
    const version = this.version,
      patch: Partial<TerminalPreferences> = {};
    for (const intent of intents) {
      if ("symbol" in intent.patch && !("instrumentUid" in intent.patch))
        delete patch.instrumentUid;
      Object.assign(patch, intent.patch);
    }
    return {
      patch,
      forceReload: intents.some((intent) => intent.forceReload),
      current: () =>
        version === this.version &&
        intents.every((intent) => intent.scope.current() && intent.depth?.valid()),
      accept: () => intents.forEach((intent) => intent.scope.accept()),
      ownersCurrent: () => intents.every((intent) => intent.scope.current()),
      cancelDepth: (rangeDays: number) => {
        const rejected = intents.filter(
          (intent) =>
            intent.depth?.active ||
            (intent.patch.rangeDays !== undefined && intent.patch.rangeDays !== rangeDays)
        );
        this.finish(rejected);
        return rejected.length > 0;
      },
      finish: (loading?: Promise<void>) => this.finish(intents, loading),
      fail: (error: unknown) => this.rejectIntents(intents, error)
    };
  }
  private finish(intents: readonly Intent[], loading = Promise.resolve()): void {
    for (const intent of intents) {
      const index = this.pending.indexOf(intent);
      if (index >= 0) this.pending.splice(index, 1);
    }
    void loading.then(
      () => {
        for (const intent of intents) {
          intent.scope.dispose();
          intent.depth?.dispose();
          intent.resolve();
        }
      },
      (error: unknown) => {
        for (const intent of intents) {
          intent.scope.dispose();
          intent.depth?.dispose();
          intent.reject(error);
        }
      }
    );
  }
  private rejectIntents(intents: readonly Intent[], error: unknown): void {
    for (const intent of intents) {
      const index = this.pending.indexOf(intent);
      if (index >= 0) this.pending.splice(index, 1);
      intent.scope.dispose();
      intent.depth?.dispose();
      intent.reject(error);
    }
  }
  private async drain(process: () => Promise<void>): Promise<void> {
    this.running = true;
    try {
      while (this.pending.length) await process();
    } catch (error) {
      this.rejectIntents([...this.pending], error);
    } finally {
      this.running = false;
    }
  }
}

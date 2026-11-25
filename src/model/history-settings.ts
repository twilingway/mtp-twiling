import type { Timeframe } from "./types.js";
import type { HistoryStats, HistoryGroup } from "../services/storage-history.js";

export interface HistorySelection {
  uid: string;
  timeframe: string;
}
export function selectedHistory(
  stats: HistoryStats | null,
  selection: HistorySelection
): HistoryStats | null {
  if (!stats || !selection.uid || !selection.timeframe) return null;
  const groups = stats.groups.filter(
    (group) =>
      (selection.uid === "all" || group.uid === selection.uid) &&
      (selection.timeframe === "all" || group.timeframe === selection.timeframe)
  );
  return groups.reduce<HistoryStats>(
    (sum, group) => ({
      bytes: sum.bytes + group.bytes,
      bars: sum.bars + group.bars,
      blocks: sum.blocks + group.blocks,
      groups: [...sum.groups, group]
    }),
    { bytes: 0, bars: 0, blocks: 0, groups: [] }
  );
}
export interface HistorySettingsStats {
  candles: HistoryStats;
  browser: { usage?: number | undefined; quota?: number | undefined };
}
interface Identity {
  owner: string;
  session: unknown;
}
export interface HistorySettingsState {
  owner: string;
  phase: "loading" | "ready" | "clearing" | "error";
  stats: HistorySettingsStats | null;
  selection: HistorySelection;
  confirmation: HistoryStats | null;
  error?: "load" | "clear" | "changed" | undefined;
}
interface Bridge {
  identity(): Identity;
  blocked(): boolean;
  stats(): Promise<HistorySettingsStats>;
  clear(uid: string | null, timeframe: Timeframe | null): Promise<void>;
}
export class HistorySettingsModel {
  private identity: Identity;
  private epoch = 0;
  private state: HistorySettingsState;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly bridge: Bridge) {
    this.identity = bridge.identity();
    this.state = {
      owner: this.identity.owner,
      phase: "loading",
      stats: null,
      selection: { uid: "", timeframe: "" },
      confirmation: null
    };
  }
  getSnapshot = (): HistorySettingsState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<HistorySettingsState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private current(epoch: number): boolean {
    const identity = this.bridge.identity();
    return (
      epoch === this.epoch &&
      identity.owner === this.identity.owner &&
      identity.session === this.identity.session
    );
  }
  async refresh(): Promise<void> {
    const identity = this.bridge.identity();
    if (identity.owner !== this.identity.owner || identity.session !== this.identity.session) {
      this.identity = identity;
      this.update({
        owner: identity.owner,
        stats: null,
        selection: { uid: "", timeframe: "" },
        confirmation: null
      });
    }
    const epoch = ++this.epoch;
    this.update({ phase: "loading", error: undefined, confirmation: null });
    try {
      const stats = await this.bridge.stats();
      if (this.current(epoch)) this.update({ phase: "ready", stats });
    } catch {
      if (this.current(epoch)) this.update({ phase: "error", stats: null, error: "load" });
    }
  }
  select(uid: string, timeframe: string): void {
    this.update({ selection: { uid, timeframe }, confirmation: null, error: undefined });
  }
  requestClear(): void {
    if (!this.current(this.epoch) || this.bridge.blocked() || this.state.phase !== "ready") return;
    const summary = selectedHistory(this.state.stats?.candles ?? null, this.state.selection);
    if (summary?.groups.length) this.update({ confirmation: summary });
  }
  cancelClear(): void {
    this.update({ confirmation: null });
  }
  async confirmClear(): Promise<void> {
    if (!this.state.confirmation || this.state.phase !== "ready" || this.bridge.blocked()) return;
    const epoch = this.epoch;
    if (!this.current(epoch)) {
      this.update({ confirmation: null, error: "changed" });
      return;
    }
    const { uid, timeframe } = this.state.selection;
    const group: HistoryGroup | undefined = this.state.confirmation.groups[0];
    if (!group) return;
    const nativeTimeframe = timeframe === "all" ? null : group.timeframe;
    this.update({ phase: "clearing", error: undefined });
    try {
      await this.bridge.clear(uid === "all" ? null : uid, nativeTimeframe);
      if (this.current(epoch)) await this.refresh();
    } catch {
      if (this.current(epoch)) this.update({ phase: "error", error: "clear", confirmation: null });
    }
  }
}

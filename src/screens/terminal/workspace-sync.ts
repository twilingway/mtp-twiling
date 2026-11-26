import type { Timeframe } from "../../model/types.js";

export interface WorkspaceSyncFlags {
  instrument: boolean;
  timeframe: boolean;
  crosshair: boolean;
  time: boolean;
  dateRange: boolean;
}

export const DEFAULT_WORKSPACE_SYNC_FLAGS: Readonly<WorkspaceSyncFlags> = Object.freeze({
  instrument: false,
  timeframe: false,
  crosshair: false,
  time: false,
  dateRange: false
});

/** Calendar timestamps in UTC milliseconds, independent of panel interval and time zone. */
export interface WorkspaceViewport {
  from: number;
  to: number;
}

export type WorkspaceViewportIntent =
  { kind: "time"; to: number } | (WorkspaceViewport & { kind: "dateRange" });

export interface WorkspaceSyncIntent {
  readonly signal: AbortSignal;
  /** Check again immediately before changing local state after an asynchronous step. */
  isCurrent(): boolean;
}

export interface WorkspaceSyncEndpoint {
  readInstrument(): string | null;
  readTimeframe(): Timeframe | null;
  readViewport(): WorkspaceViewport | null;
  setInstrument(uid: string, intent: WorkspaceSyncIntent): void | Promise<void>;
  setTimeframe(timeframe: Timeframe, intent: WorkspaceSyncIntent): void | Promise<void>;
  setCrosshair(timestamp: number | null): void;
  setViewport(viewport: WorkspaceViewportIntent): void;
}

type Route = { kind: "instrument"; value: string } | { kind: "timeframe"; value: Timeframe };
type RouteKind = Route["kind"];
type PendingRoute = { route: Route; abort: AbortController; queued: boolean };
type Registration = {
  slot: number;
  endpoint: WorkspaceSyncEndpoint;
  pending: Map<RouteKind, PendingRoute>;
  running: boolean;
  applying: boolean;
  linkedCrosshair: number | null;
};

const routeKinds = ["instrument", "timeframe"] as const;

function deliver<T>(target: Registration, command: () => T): T | undefined {
  target.applying = true;
  try {
    return command();
  } catch {
    // An unavailable chart cannot prevent commands reaching its peers.
    return undefined;
  } finally {
    target.applying = false;
  }
}

/** Route user intents between live registrations. Endpoints must not repost applied commands. */
export class WorkspaceSync {
  private flags = DEFAULT_WORKSPACE_SYNC_FLAGS;
  private activeSlot: number | null = null;
  private readonly slots = new Map<number, Registration>();
  private readonly latest = new Map<RouteKind, Route>();
  private crosshairSource: number | null = null;
  private crosshairTimestamp: number | null = null;

  register(slot: number, endpoint: WorkspaceSyncEndpoint): () => void {
    const previous = this.slots.get(slot);
    if (previous) this.unregister(previous);
    const target: Registration = {
      slot,
      endpoint,
      pending: new Map(),
      running: false,
      applying: false,
      linkedCrosshair: null
    };
    this.slots.set(slot, target);
    for (const kind of routeKinds) {
      if (!this.flags[kind]) continue;
      const route = this.latest.get(kind);
      if (slot === this.activeSlot && !route) this.seed(kind, slot);
      else if (slot !== this.activeSlot && route) this.queue(target, route);
    }
    if (this.flags.crosshair) this.setCrosshair(target, this.crosshairTimestamp);
    return () => this.unregister(target);
  }

  configure(flags: Readonly<WorkspaceSyncFlags>, activeSlot: number): void {
    const previous = this.flags;
    this.flags = { ...flags };
    this.activeSlot = activeSlot;
    for (const kind of routeKinds) {
      if (!flags[kind]) {
        this.latest.delete(kind);
        if (previous[kind]) for (const target of this.slots.values()) this.cancel(target, kind);
      } else if (!previous[kind]) this.seed(kind, activeSlot);
    }
    if (previous.crosshair && !flags.crosshair) this.clearCrosshair();
  }

  /** End a profile scope; connected wrappers can be configured for the next scope. */
  reset(): void {
    this.flags = DEFAULT_WORKSPACE_SYNC_FLAGS;
    this.activeSlot = null;
    this.latest.clear();
    for (const target of this.slots.values())
      for (const kind of routeKinds) this.cancel(target, kind);
    this.clearCrosshair();
  }

  publishInstrument(slot: number, uid?: string | null): void {
    const source = this.slots.get(slot);
    if (!this.flags.instrument || !source || source.applying) return;
    const value = uid === undefined ? source.endpoint.readInstrument() : uid;
    if (value) this.sendRoute(source, { kind: "instrument", value });
  }

  publishTimeframe(slot: number, timeframe?: Timeframe | null): void {
    const source = this.slots.get(slot);
    if (!this.flags.timeframe || !source || source.applying) return;
    const value = timeframe === undefined ? source.endpoint.readTimeframe() : timeframe;
    if (value) this.sendRoute(source, { kind: "timeframe", value });
  }

  publishCrosshair(slot: number, timestamp: number | null): void {
    const source = this.slots.get(slot);
    if (!this.flags.crosshair || !source || source.applying) return;
    if (timestamp === null) {
      if (this.crosshairSource === slot) this.clearCrosshair();
      return;
    }
    if (!Number.isFinite(timestamp)) return;
    this.crosshairSource = slot;
    this.crosshairTimestamp = timestamp;
    // Its own native interaction now owns the source's crosshair.
    this.setCrosshair(source, null);
    for (const target of this.slots.values())
      if (target !== source) this.setCrosshair(target, timestamp);
  }

  publishViewport(slot: number, viewport?: WorkspaceViewport | null): void {
    const source = this.slots.get(slot);
    if ((!this.flags.time && !this.flags.dateRange) || !source || source.applying) return;
    const view = viewport === undefined ? source.endpoint.readViewport() : viewport;
    if (!view || !Number.isFinite(view.to)) return;
    if (this.flags.dateRange && (!Number.isFinite(view.from) || view.from >= view.to)) return;
    const command: WorkspaceViewportIntent = this.flags.dateRange
      ? { kind: "dateRange", from: view.from, to: view.to }
      : { kind: "time", to: view.to };
    for (const target of this.slots.values())
      if (target !== source) deliver(target, () => target.endpoint.setViewport({ ...command }));
  }

  private unregister(target: Registration): void {
    if (this.slots.get(target.slot) !== target) return;
    this.slots.delete(target.slot);
    for (const kind of routeKinds) this.cancel(target, kind);
    this.setCrosshair(target, null);
    if (this.crosshairSource === target.slot) this.clearCrosshair();
  }

  private setCrosshair(target: Registration, timestamp: number | null): void {
    if (target.linkedCrosshair === timestamp) return;
    target.linkedCrosshair = timestamp;
    deliver(target, () => target.endpoint.setCrosshair(timestamp));
  }

  private clearCrosshair(): void {
    this.crosshairSource = null;
    this.crosshairTimestamp = null;
    for (const target of this.slots.values()) this.setCrosshair(target, null);
  }

  private seed(kind: RouteKind, slot: number): void {
    if (kind === "instrument") this.publishInstrument(slot);
    else this.publishTimeframe(slot);
  }

  private sendRoute(source: Registration, route: Route): void {
    this.latest.set(route.kind, route);
    this.cancel(source, route.kind);
    for (const target of this.slots.values()) if (target !== source) this.queue(target, route);
  }

  private cancel(target: Registration, kind: RouteKind): void {
    const prior = target.pending.get(kind);
    target.pending.delete(kind);
    prior?.abort.abort();
  }

  private queue(target: Registration, route: Route): void {
    this.cancel(target, route.kind);
    target.pending.set(route.kind, { route, abort: new AbortController(), queued: true });
    if (!target.running) void this.drain(target);
  }

  private async drain(target: Registration): Promise<void> {
    target.running = true;
    try {
      while (this.slots.get(target.slot) === target) {
        // A pending instrument determines which timeframes the target can apply.
        const pending = routeKinds
          .map((kind) => target.pending.get(kind))
          .find((item) => item?.queued);
        if (!pending) break;
        pending.queued = false;
        const { route, abort } = pending;
        const intent: WorkspaceSyncIntent = {
          signal: abort.signal,
          isCurrent: () =>
            !abort.signal.aborted &&
            this.flags[route.kind] &&
            this.slots.get(target.slot) === target &&
            target.pending.get(route.kind) === pending
        };
        try {
          await deliver(target, () => {
            if (!intent.isCurrent()) return;
            if (route.kind === "instrument") {
              if (target.endpoint.readInstrument() !== route.value)
                return target.endpoint.setInstrument(route.value, intent);
            } else if (target.endpoint.readTimeframe() !== route.value)
              return target.endpoint.setTimeframe(route.value, intent);
          });
        } catch {
          // A later intent may target a supported instrument or timeframe.
        } finally {
          if (target.pending.get(route.kind) === pending) target.pending.delete(route.kind);
        }
      }
    } finally {
      target.running = false;
    }
  }
}

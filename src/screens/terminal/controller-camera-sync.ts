import { marketAvailable } from "./market-readiness.js";
import type { ChartAdapter, ChartOptions } from "../../charts/adapter.js";
import type { ChartView } from "../../model/types.js";
import type { TerminalController } from "./controller.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { viewKey } from "./controller-bridge.js";
import { t } from "../../i18n/messages.js";

type Change = "intent" | "change";
interface CameraState {
  listeners: Set<(kind: Change) => void>;
  writes: Promise<void>;
  sequence: number;
  writeRevision: number;
  pending?: { scope: symbol; sequence: number; current: () => boolean } | undefined;
}
const cameras = new WeakMap<object, CameraState>();
const workspaceCameras = new Set<WeakRef<TerminalController>>();
const registeredCameras = new WeakSet<TerminalController>();
const cameraControllers = new WeakMap<object, TerminalController>();
const workspaceListeners = new Set<{
  root: TerminalController;
  listener: (kind: Change) => void;
}>();
function registerCamera(controller: TerminalController): void {
  if (registeredCameras.has(controller)) return;
  registeredCameras.add(controller);
  cameraControllers.set(controller, controller);
  workspaceCameras.add(new WeakRef(controller));
}
function sameWorkspace(root: TerminalController, source: TerminalController): boolean {
  return (
    root.getSnapshot().owner === source.getSnapshot().owner &&
    root.sessionKey() === source.sessionKey()
  );
}
function emitCamera(controller: object, kind: Change): void {
  cameraState(controller).listeners.forEach((listener) => listener(kind));
  emitWorkspaceCamera(controller, kind);
}
function emitWorkspaceCamera(controller: object, kind: Change): void {
  const source = cameraControllers.get(controller);
  if (source)
    workspaceListeners.forEach(({ root, listener }) => {
      if (sameWorkspace(root, source)) listener(kind);
    });
}
export function subscribeWorkspaceCamera(
  root: TerminalController,
  listener: (kind: Change) => void
): () => void {
  registerCamera(root);
  const entry = { root, listener };
  workspaceListeners.add(entry);
  return () => {
    workspaceListeners.delete(entry);
  };
}
export function workspaceCameraPending(root: TerminalController): boolean {
  for (const reference of workspaceCameras) {
    const candidate = reference.deref();
    if (candidate && sameWorkspace(root, candidate) && cameraPending(candidate)) return true;
  }
  return false;
}
export async function flushWorkspaceCamera(root: TerminalController): Promise<void> {
  const writes: Promise<void>[] = [];
  for (const reference of workspaceCameras) {
    const candidate = reference.deref();
    if (candidate && sameWorkspace(root, candidate)) writes.push(flushCamera(candidate));
  }
  await Promise.all(writes);
}

/** Capture every visible slot synchronously before a market transition can retire its canvas. */
export function captureWorkspaceCameraViews(controller: TerminalController): Promise<void> {
  registerCamera(controller);
  const owner = controller.getSnapshot().owner;
  const writes: Promise<void>[] = [];
  for (const reference of workspaceCameras) {
    const candidate = reference.deref();
    if (!candidate) {
      workspaceCameras.delete(reference);
      continue;
    }
    if (
      candidate.getSnapshot().owner !== owner ||
      candidate.sessionKey() !== controller.sessionKey()
    )
      continue;
    writes.push(candidate.saveView(), flushCamera(candidate));
  }
  return Promise.all(writes).then(() => {});
}
function cameraState(controller: object): CameraState {
  let state = cameras.get(controller);
  if (!state) {
    state = { listeners: new Set(), writes: Promise.resolve(), sequence: 0, writeRevision: 0 };
    cameras.set(controller, state);
  }
  return state;
}
/** A live capture supersedes queued snapshots; only its successful write may release its epoch. */
export function fenceCameraWrites(controller: object): () => void {
  const state = cameraState(controller),
    revision = ++state.writeRevision,
    pending = state.pending,
    source = cameraControllers.get(controller),
    snapshot = source?.getSnapshot(),
    owner = snapshot?.owner,
    client = source?.sessionKey(),
    cloudSession = source?.cloudSessionKey(),
    document = snapshot && selectedMarketRow(snapshot.rows, snapshot.preferences),
    key = snapshot && viewKey(snapshot.preferences),
    chartRevision = snapshot?.chartRevision;
  let completed = false;
  return () => {
    if (completed) return;
    completed = true;
    if (state.writeRevision !== revision || !pending || state.sequence !== pending.sequence) return;
    const retained = state.pending === pending;
    if (retained) state.pending = undefined;
    if (retained && pending.current()) {
      emitCamera(controller, "change");
      return;
    }
    const current = source?.getSnapshot(),
      selected = current && selectedMarketRow(current.rows, current.preferences);
    // A bank transition can retire callbacks while this exact camera write commits.
    if (
      source &&
      client &&
      cloudSession &&
      current?.profileTransition &&
      !state.pending &&
      !current.importingBackup &&
      !current.importRecoveryRequired &&
      !current.workspaceMigrationIncomplete &&
      current.owner === owner &&
      source.sessionKey() === client &&
      source.cloudSessionKey() === cloudSession &&
      current.chartRevision === chartRevision &&
      viewKey(current.preferences) === key &&
      selected?.uid === document?.uid &&
      selected?.symbol === document?.symbol
    )
      emitWorkspaceCamera(controller, "change");
  };
}
export function cameraPending(controller: TerminalController): boolean {
  const state = cameraState(controller);
  if (state.pending && !state.pending.current()) state.pending = undefined;
  return !!state.pending;
}
export function flushCamera(controller: TerminalController): Promise<void> {
  return cameraState(controller).writes;
}
export function subscribeCamera(
  controller: TerminalController,
  listener: (kind: Change) => void
): () => void {
  registerCamera(controller);
  const state = cameraState(controller);
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}
export function cameraCurrent(
  controller: TerminalController,
  chart: ChartAdapter | null
): chart is ChartAdapter {
  const state = controller.getSnapshot(),
    source = chart?.source;
  return !!(
    chart &&
    chart === controller.chart &&
    source &&
    marketAvailable(state) &&
    !state.profileTransition &&
    !state.loading &&
    !state.importingBackup &&
    !state.importRecoveryRequired &&
    state.historyViewReady !== false &&
    !chart.retired &&
    chart.persistView !== false &&
    source.owner === state.owner &&
    source.uid === selectedMarketRow(state.rows, state.preferences)?.uid &&
    source.viewKey === viewKey(state.preferences)
  );
}
export function cameraCallbacks(
  controller: TerminalController,
  chart: () => ChartAdapter | null,
  alive: () => boolean,
  save: (owner: string, key: string, view: ChartView) => Promise<void>
): Pick<ChartOptions, "onCameraIntent" | "onCameraChange" | "onCameraIdle"> {
  registerCamera(controller);
  const session = controller.sessionKey(),
    revision = controller.getSnapshot().chartRevision,
    state = cameraState(controller),
    valid = () =>
      alive() &&
      controller.sessionKey() === session &&
      controller.getSnapshot().chartRevision === revision &&
      cameraCurrent(controller, chart()),
    emit = (kind: Change) => emitCamera(controller, kind);
  let failed = false;
  const scope = Symbol("camera");
  return {
    onCameraIntent: () => {
      if (valid()) {
        state.pending = { scope, sequence: ++state.sequence, current: valid };
        emit("intent");
      }
    },
    onCameraIdle: (reason) => {
      if (reason === "unavailable" && valid()) {
        if (!failed)
          controller.notify(
            t(
              "Не удалось сохранить вид. Синхронизация приостановлена; измените вид для повторной попытки."
            )
          );
        failed = true;
      }
      if (state.pending?.scope === scope && (!failed || reason === "cancelled"))
        state.pending = undefined;
    },
    onCameraChange: (view) => {
      if (!valid()) return;
      const captured = chart();
      const sequence = state.pending?.sequence,
        revision = ++state.writeRevision;
      const snapshot = {
        ...view,
        ...(view.camera ? { camera: { ...view.camera } } : {}),
        ...(view.anchor ? { anchor: { ...view.anchor } } : {})
      };
      const owner = controller.getSnapshot().owner,
        key = viewKey(controller.getSnapshot().preferences);
      state.writes = state.writes.then(async () => {
        if (!valid() || chart() !== captured || state.writeRevision !== revision) return;
        try {
          await save(owner, key, snapshot);
          if (valid() && state.writeRevision === revision) {
            failed = false;
            if (state.pending?.scope === scope && state.pending.sequence === sequence)
              state.pending = undefined;
            emit("change");
          }
        } catch {
          if (valid() && state.writeRevision === revision && !failed) {
            failed = true;
            controller.notify(
              t(
                "Не удалось сохранить вид. Синхронизация приостановлена; измените вид для повторной попытки."
              )
            );
          }
        }
      });
    }
  };
}
export function userCameraAction(
  controller: TerminalController,
  chart: ChartAdapter,
  action: () => void
): void {
  if (!cameraCurrent(controller, chart)) return;
  chart.beginViewInteraction?.(true);
  try {
    action();
  } finally {
    chart.endViewInteraction?.();
  }
}

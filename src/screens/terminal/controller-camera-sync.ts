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
  pending?: { scope: symbol; sequence: number; current: () => boolean } | undefined;
}
const cameras = new WeakMap<TerminalController, CameraState>();
function cameraState(controller: TerminalController): CameraState {
  let state = cameras.get(controller);
  if (!state) {
    state = { listeners: new Set(), writes: Promise.resolve(), sequence: 0 };
    cameras.set(controller, state);
  }
  return state;
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
  const session = controller.sessionKey(),
    revision = controller.getSnapshot().chartRevision,
    state = cameraState(controller),
    valid = () =>
      alive() &&
      controller.sessionKey() === session &&
      controller.getSnapshot().chartRevision === revision &&
      cameraCurrent(controller, chart()),
    emit = (kind: Change) => state.listeners.forEach((listener) => listener(kind));
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
      const sequence = state.pending?.sequence;
      const snapshot = {
        ...view,
        ...(view.camera ? { camera: { ...view.camera } } : {}),
        ...(view.anchor ? { anchor: { ...view.anchor } } : {})
      };
      const owner = controller.getSnapshot().owner,
        key = viewKey(controller.getSnapshot().preferences);
      state.writes = state.writes.then(async () => {
        if (!valid() || chart() !== captured) return;
        try {
          await save(owner, key, snapshot);
          if (valid()) {
            failed = false;
            if (state.pending?.scope === scope && state.pending.sequence === sequence)
              state.pending = undefined;
            emit("change");
          }
        } catch {
          if (valid() && !failed) {
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

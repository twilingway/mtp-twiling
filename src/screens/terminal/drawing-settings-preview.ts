import type { Drawing } from "../../model/types.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { TerminalState } from "./state.js";
import { importWritable } from "./controller-transfer-guard.js";
import { validSettingsDrawing } from "./drawings/drawing-settings-model.js";

function scope(state: TerminalState) {
  return {
    owner: state.owner,
    symbol: state.preferences.symbol,
    instrumentUid: state.preferences.instrumentUid ?? null,
    uid: selectedMarketRow(state.rows, state.preferences)?.uid ?? null,
    engine: state.preferences.engine,
    timeframe: state.preferences.timeframe,
    revision: state.chartRevision,
    authenticated: state.authenticated,
    id: state.selectedObject
  };
}
export interface DrawingSettingsPreview {
  token: string;
  scope: ReturnType<typeof scope>;
  original: Drawing;
  drawing: Drawing;
}
export function validDrawingSettingsPreview(
  state: TerminalState,
  value: DrawingSettingsPreview
): boolean {
  const current = scope(state);
  return (
    importWritable(state) &&
    (state.dialog === "drawing-settings" || state.dialog === "annotation-editor") &&
    Object.keys(current).every(
      (key) => current[key as keyof typeof current] === value.scope[key as keyof typeof current]
    ) &&
    state.drawings.find((drawing) => drawing.id === value.scope.id) === value.original
  );
}
/** The only selector allowed to expose a modal draft. Portable paths always use state.drawings. */
export function drawingRenderList(state: TerminalState): Drawing[] {
  const value = state.drawingSettingsPreview;
  return value && validDrawingSettingsPreview(state, value)
    ? state.drawings.map((drawing) => (drawing === value.original ? value.drawing : drawing))
    : state.drawings;
}
export function drawingPreviewState(state: TerminalState): TerminalState {
  return state.drawingSettingsPreview &&
    !validDrawingSettingsPreview(state, state.drawingSettingsPreview)
    ? { ...state, drawingSettingsPreview: null }
    : state;
}
interface Bridge {
  getState(): TerminalState;
  update(patch: Partial<TerminalState>): void;
  cancelGesture(): void;
  change(patch: Pick<TerminalState, "drawings">): Promise<void>;
  isAlive(): boolean;
}
export class TerminalDrawingPreview {
  constructor(private readonly bridge: Bridge) {}
  setDialog = (
    dialog: TerminalState["dialog"],
    initialAccountSection?: TerminalState["initialAccountSection"]
  ): void => {
    if (dialog === "drawing-settings" || dialog === "annotation-editor")
      this.bridge.cancelGesture();
    this.bridge.update({
      dialog,
      contextMenu: null,
      initialAccountSection: dialog === "account" ? initialAccountSection : undefined
    });
  };
  begin = (id: string): string | null => {
    this.bridge.cancelGesture();
    const state = this.bridge.getState();
    const original = state.drawings.find((drawing) => drawing.id === id);
    if (
      !this.bridge.isAlive() ||
      !importWritable(state) ||
      !original ||
      (state.dialog !== "drawing-settings" && state.dialog !== "annotation-editor") ||
      state.selectedObject !== id
    )
      return null;
    const token = crypto.randomUUID();
    this.bridge.update({
      drawingSettingsPreview: {
        token,
        scope: scope(state),
        original,
        drawing: structuredClone(original)
      }
    });
    return token;
  };
  private active(token: string): DrawingSettingsPreview | null {
    const state = this.bridge.getState(),
      value = state.drawingSettingsPreview;
    return this.bridge.isAlive() &&
      value?.token === token &&
      validDrawingSettingsPreview(state, value)
      ? value
      : null;
  }
  preview = (token: string, drawing: Drawing): boolean => {
    const active = this.active(token);
    if (
      !active ||
      drawing.id !== active.original.id ||
      drawing.name !== active.original.name ||
      !validSettingsDrawing(drawing)
    )
      return false;
    this.bridge.update({
      drawingSettingsPreview: { ...active, drawing: structuredClone(drawing) }
    });
    return true;
  };
  cancel = (token?: string): void => {
    const active = this.bridge.getState().drawingSettingsPreview;
    if (active && (token === undefined || token === active.token))
      this.bridge.update({ drawingSettingsPreview: null });
  };
  commit = async (token: string, drawing: Drawing): Promise<boolean> => {
    const active = this.active(token);
    if (
      !active ||
      drawing.id !== active.original.id ||
      drawing.name !== active.original.name ||
      !validSettingsDrawing(drawing)
    )
      return false;
    // A gesture opened externally after begin must be retired before change, then scope rechecked.
    this.bridge.cancelGesture();
    if (!this.active(token)) return false;
    const candidate = structuredClone(drawing);
    await this.bridge.change({
      drawings: this.bridge
        .getState()
        .drawings.map((item) => (item === active.original ? candidate : item))
    });
    return this.bridge.isAlive() && this.bridge.getState().drawings.includes(candidate);
  };
}
export function createDrawingPreview(
  bridge: Pick<Bridge, "getState" | "update">,
  editing: Pick<Bridge, "cancelGesture" | "change">,
  isAlive: () => boolean
) {
  return new TerminalDrawingPreview({
    ...bridge,
    isAlive,
    cancelGesture: () => editing.cancelGesture(),
    change: (patch) => editing.change(patch)
  });
}

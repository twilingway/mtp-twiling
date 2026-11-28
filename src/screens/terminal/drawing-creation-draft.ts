import type { Drawing } from "../../model/types.js";
import { isDrawing } from "../../model/backup-format.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { importWritable } from "./controller-transfer-guard.js";
import { validSettingsDrawing } from "./drawings/drawing-settings-model.js";
import type { TerminalState } from "./state.js";

export function drawingCreationContext(state: TerminalState): string {
  return JSON.stringify([
    state.owner,
    state.authenticated,
    state.preferences.symbol,
    state.preferences.instrumentUid,
    selectedMarketRow(state.rows, state.preferences)?.uid,
    state.preferences.timeframe,
    state.preferences.engine,
    state.chartRevision
  ]);
}
function scope(state: TerminalState): string {
  return JSON.stringify([drawingCreationContext(state), state.activeTool]);
}
export interface DrawingCreationDraft {
  token: string;
  scope: string;
  drawing: Drawing;
}
export function validCreationDraft(state: TerminalState, draft: DrawingCreationDraft): boolean {
  return (
    importWritable(state) &&
    (state.dialog === "drawing-settings" || state.dialog === "annotation-editor") &&
    scope(state) === draft.scope &&
    !state.drawings.some((item) => item.id === draft.drawing.id)
  );
}
export function drawingCreationState(state: TerminalState): TerminalState {
  return state.drawingCreationDraft && !validCreationDraft(state, state.drawingCreationDraft)
    ? {
        ...state,
        drawingCreationDraft: null,
        preview: null,
        ...((state.dialog === "drawing-settings" || state.dialog === "annotation-editor") && {
          dialog: null
        })
      }
    : state;
}
interface Bridge {
  getState(): TerminalState;
  update(patch: Partial<TerminalState>): void;
  addDrawing(drawing: Drawing): Promise<void>;
  isAlive(): boolean;
}
/** A new annotation enters the document through Save or an explicit toolbar tool change. */
export class TerminalDrawingCreation {
  private committing = new Map<string, { context: string; promise: Promise<boolean> }>();
  constructor(private readonly bridge: Bridge) {}
  begin = (drawing: Drawing): string | null => {
    const state = this.bridge.getState();
    if (!this.bridge.isAlive() || !importWritable(state) || !isDrawing(drawing)) return null;
    const token = crypto.randomUUID();
    this.bridge.update({
      dialog: drawing.name === "table" ? "drawing-settings" : "annotation-editor",
      contextMenu: null,
      selectedObject: null,
      preview: structuredClone(drawing),
      drawingCreationDraft: {
        token,
        scope: scope(state),
        drawing: structuredClone(drawing)
      }
    });
    return token;
  };
  private active(token: string): DrawingCreationDraft | null {
    const state = this.bridge.getState(),
      draft = state.drawingCreationDraft;
    return this.bridge.isAlive() && draft?.token === token && validCreationDraft(state, draft)
      ? draft
      : null;
  }
  preview = (token: string, drawing: Drawing): boolean => {
    const draft = this.active(token);
    if (
      !draft ||
      draft.drawing.id !== drawing.id ||
      draft.drawing.name !== drawing.name ||
      !isDrawing(drawing)
    )
      return false;
    const candidate = structuredClone(drawing);
    this.bridge.update({
      drawingCreationDraft: { ...draft, drawing: candidate },
      preview: candidate
    });
    return true;
  };
  cancel = (token?: string): void => {
    const draft = this.bridge.getState().drawingCreationDraft;
    if (draft && (token === undefined || draft.token === token))
      this.bridge.update({ drawingCreationDraft: null, preview: null, dialog: null });
  };
  pendingCommit = (): Promise<boolean> | null => {
    const state = this.bridge.getState();
    if (!this.bridge.isAlive() || !importWritable(state)) return null;
    const context = drawingCreationContext(state);
    return (
      [...this.committing.values()].find((pending) => pending.context === context)?.promise ?? null
    );
  };
  commit = (token: string, drawing: Drawing): Promise<boolean> => {
    const pending = this.committing.get(token);
    if (pending) return pending.promise;
    const draft = this.active(token);
    if (!draft || !validSettingsDrawing(drawing) || !this.preview(token, drawing))
      return Promise.resolve(false);
    const candidate = structuredClone(drawing);
    // Register before addDrawing can synchronously replace the draft with its optimistic object.
    const promise = Promise.resolve().then(async () => {
      try {
        if (!this.active(token)) return false;
        await this.bridge.addDrawing(candidate);
        const saved =
          this.bridge.isAlive() &&
          this.bridge.getState().drawings.some((item) => item.id === candidate.id);
        if (saved) this.cancel(token);
        return saved;
      } finally {
        this.committing.delete(token);
      }
    });
    this.committing.set(token, {
      context: drawingCreationContext(this.bridge.getState()),
      promise
    });
    return promise;
  };
}

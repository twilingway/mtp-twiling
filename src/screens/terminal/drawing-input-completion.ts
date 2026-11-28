import type { TerminalController } from "./controller.js";
import { importWritable } from "./controller-transfer-guard.js";

const inputs = new WeakMap<TerminalController, () => boolean>();

/** The shell's selected editor owns Enter; chart surfaces never compete for document keys. */
export function registerDrawingCompletion(controller: TerminalController, finish: () => boolean) {
  inputs.set(controller, finish);
  return () => {
    if (inputs.get(controller) === finish) inputs.delete(controller);
  };
}

export function finishEditorDrawing(editor: TerminalController): boolean {
  const state = editor.getSnapshot();
  if (state.dialog || state.loading || !importWritable(state)) return false;
  return inputs.get(editor)?.() ?? false;
}

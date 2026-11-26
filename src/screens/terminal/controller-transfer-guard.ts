import type { TerminalState } from "./state.js";

/** Export/pull stays interactive. Only committed import/restoration owns portable mutations. */
export function importWritable(
  state: Pick<
    TerminalState,
    "owner" | "importingBackup" | "importRecoveryRequired" | "profileTransition" | "annotationReady"
  >,
  owner = state.owner
): boolean {
  return (
    state.owner === owner &&
    state.annotationReady !== false &&
    !state.importingBackup &&
    !state.importRecoveryRequired &&
    !state.profileTransition
  );
}

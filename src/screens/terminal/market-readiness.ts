import type { TerminalState } from "./state.js";
/** Authentication describes only the bank; public markets have their own readiness. */
export function marketAvailable(
  state: Pick<TerminalState, "authenticated" | "marketReady">
): boolean {
  return state.marketReady ?? state.authenticated;
}

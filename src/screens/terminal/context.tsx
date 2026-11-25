import { createContext, useContext, useSyncExternalStore } from "react";
import type { TerminalController } from "./controller.js";
export const TerminalContext = createContext<TerminalController | null>(null);
export function useTerminal() {
  const controller = useContext(TerminalContext);
  if (!controller) throw new Error("Terminal provider is missing");
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  return { controller, state };
}

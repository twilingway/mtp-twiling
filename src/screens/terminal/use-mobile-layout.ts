import { useSyncExternalStore } from "react";

const media = () => window.matchMedia("(max-width: 800px)");
const subscribe = (listener: () => void) => {
  const query = media();
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};
const snapshot = () => media().matches;

export function useMobileLayout(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

import type { ContextMenu } from "../state.js";

interface DismissBridge {
  current(): { contextMenu: ContextMenu | null; selectedObject: string | null };
  contains(target: Node): boolean;
  dismiss(): void;
}

/** Consume the dismissing gesture before chart capture handlers and native SDK input. */
export function bindMobileObjectMenuDismiss(document: Document, bridge: DismissBridge) {
  let shield: { primary: number; pointers: Set<number> } | null = null;
  const ownsMenu = () => {
    const { contextMenu: menu, selectedObject } = bridge.current();
    return (
      menu !== null &&
      (menu.target.kind === "drawing" || menu.target.kind === "image") &&
      menu.target.id === selectedObject
    );
  };
  const consume = (event: Event) => {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  };
  const pointer = (event: PointerEvent) => {
    if (event.type === "pointerdown") {
      if (shield?.pointers.size && event.isPrimary === false) {
        shield.pointers.add(event.pointerId);
        consume(event);
        return;
      }
      // A new independent gesture ends any stale compatibility-click shield.
      shield = null;
      if (!ownsMenu() || !(event.target instanceof Node) || bridge.contains(event.target)) return;
      shield = { primary: event.pointerId, pointers: new Set([event.pointerId]) };
      consume(event);
      bridge.dismiss();
      return;
    }
    if (!shield?.pointers.has(event.pointerId)) return;
    consume(event);
    if (event.type === "pointerup" || event.type === "pointercancel")
      shield.pointers.delete(event.pointerId);
  };
  const compatibility = (event: MouseEvent) => {
    if (!shield) return;
    // Keyboard/programmatic activation belongs to a separate interaction.
    if (
      event.type === "click" &&
      event.detail === 0 &&
      (!("pointerId" in event) || event.pointerId !== shield.primary)
    )
      return;
    consume(event);
    if (event.type === "click") shield = null;
  };
  const touch = (event: TouchEvent) => {
    if (shield) consume(event);
  };
  const key = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || !ownsMenu()) return;
    // Close this menu before document bubble shortcuts can clear selection or focus intent.
    consume(event);
    bridge.dismiss();
  };
  const pointerEvents = ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const;
  const mouseEvents = ["mousedown", "mouseup", "click", "contextmenu"] as const;
  const touchEvents = ["touchstart", "touchmove", "touchend", "touchcancel"] as const;
  for (const type of pointerEvents) document.addEventListener(type, pointer, true);
  for (const type of mouseEvents) document.addEventListener(type, compatibility, true);
  for (const type of touchEvents)
    document.addEventListener(type, touch, { capture: true, passive: false });
  document.addEventListener("keydown", key, true);
  return () => {
    for (const type of pointerEvents) document.removeEventListener(type, pointer, true);
    for (const type of mouseEvents) document.removeEventListener(type, compatibility, true);
    for (const type of touchEvents) document.removeEventListener(type, touch, true);
    document.removeEventListener("keydown", key, true);
    shield = null;
  };
}

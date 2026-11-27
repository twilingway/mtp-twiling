import { useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

/** Keep toolbar menus outside the scrolling strip, including native fullscreen. */
export function ToolbarPopover({
  anchor,
  open,
  onClose,
  keepMounted = false,
  children
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  keepMounted?: boolean;
  children: ReactNode;
}) {
  const [host] = useState(() =>
    typeof document === "undefined" ? null : document.createElement("div")
  );
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>();
  const dismiss = useEffectEvent(onClose);
  useLayoutEffect(() => {
    if (!host) return;
    host.className = "toolbar-portal-host";
    const attach = () => (document.fullscreenElement ?? document.body).append(host);
    attach();
    document.addEventListener("fullscreenchange", attach);
    return () => {
      document.removeEventListener("fullscreenchange", attach);
      host.remove();
    };
  }, [host]);
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = anchor.current;
    const panel = root.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? document.documentElement.clientWidth;
    const height = viewport?.height ?? document.documentElement.clientHeight;
    const bounds = panel.getBoundingClientRect();
    const below = top + height - rect.bottom - 14;
    const above = rect.top - top - 14;
    const down = below >= Math.min(bounds.height, 220) || below >= above;
    const maxHeight = Math.max(0, down ? below : above);
    setPosition({
      left: Math.max(left + 8, Math.min(rect.left, left + width - bounds.width - 8)),
      top: down
        ? rect.bottom + 6
        : Math.max(top + 8, rect.top - Math.min(bounds.height, maxHeight) - 6),
      maxHeight,
      visibility: "visible"
    });
    const scroll = trigger.closest(".toolbar-scroll");
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !panel.contains(event.target) &&
        !trigger.contains(event.target)
      )
        dismiss();
    };
    panel
      .querySelector<HTMLElement>(
        'button:not(:disabled):not([tabindex="-1"]), select:not(:disabled), input:not(:disabled)'
      )
      ?.focus({ preventScroll: true });
    scroll?.addEventListener("scroll", dismiss, { passive: true });
    window.addEventListener("resize", dismiss);
    viewport?.addEventListener("resize", dismiss);
    document.addEventListener("pointerdown", outside);
    return () => {
      scroll?.removeEventListener("scroll", dismiss);
      window.removeEventListener("resize", dismiss);
      viewport?.removeEventListener("resize", dismiss);
      document.removeEventListener("pointerdown", outside);
    };
  }, [anchor, open]);
  if (!host || (!open && !keepMounted)) return null;
  return createPortal(
    <div
      ref={root}
      className="toolbar-popover"
      hidden={!open}
      style={position ?? { visibility: "hidden" }}
    >
      {children}
    </div>,
    host
  );
}

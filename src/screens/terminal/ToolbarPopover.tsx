import { useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

/** Keep toolbar menus outside the scrolling strip, including native fullscreen. */
export function ToolbarPopover({
  anchor,
  open,
  onClose,
  keepMounted = false,
  resizeBehavior = "dismiss",
  children
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  keepMounted?: boolean;
  resizeBehavior?: "dismiss" | "reposition";
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
    const viewport = window.visualViewport;
    const updatePosition = () => {
      const rect = trigger.getBoundingClientRect();
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? document.documentElement.clientWidth;
      const height = viewport?.height ?? document.documentElement.clientHeight;
      const bounds = panel.getBoundingClientRect();
      const belowTop = Math.max(top + 8, rect.bottom + 6);
      const aboveBottom = Math.min(top + height - 8, rect.top - 6);
      const below = top + height - 8 - belowTop;
      const above = aboveBottom - top - 8;
      const down = below >= Math.min(bounds.height, 220) || below >= above;
      const maxHeight = Math.max(0, down ? below : above);
      setPosition({
        left: Math.max(left + 8, Math.min(rect.left, left + width - bounds.width - 8)),
        top: down ? belowTop : Math.max(top + 8, aboveBottom - Math.min(bounds.height, maxHeight)),
        maxHeight,
        visibility: "visible",
        "--toolbar-popover-height": `${maxHeight}px`
      } as CSSProperties);
    };
    updatePosition();
    let frame: number | undefined;
    const reposition = () => {
      if (frame !== undefined) return;
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        updatePosition();
      });
    };
    const resize = resizeBehavior === "reposition" ? reposition : dismiss;
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
    window.addEventListener("resize", resize);
    viewport?.addEventListener("resize", resize);
    if (resizeBehavior === "reposition") viewport?.addEventListener("scroll", reposition);
    document.addEventListener("pointerdown", outside);
    return () => {
      scroll?.removeEventListener("scroll", dismiss);
      window.removeEventListener("resize", resize);
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", reposition);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside);
    };
  }, [anchor, open, resizeBehavior]);
  useLayoutEffect(() => {
    if (!open || resizeBehavior !== "reposition" || !position) return;
    const panel = root.current;
    const focused = document.activeElement;
    if (!panel || !focused || !panel.contains(focused)) return;
    const bounds = panel.getBoundingClientRect();
    const target = focused.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = Math.max(bounds.top, viewport?.offsetTop ?? 0) + 4;
    const bottom =
      Math.min(
        bounds.bottom,
        (viewport?.offsetTop ?? 0) + (viewport?.height ?? document.documentElement.clientHeight)
      ) - 4;
    if (target.top < top || target.bottom > bottom)
      focused.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [open, position, resizeBehavior]);
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

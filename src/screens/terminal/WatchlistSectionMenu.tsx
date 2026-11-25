import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { sectionText } from "../../i18n/messages-watchlist-sections.js";
import type { WatchlistSection } from "../../model/watchlist-sections.js";
import { DeleteIcon } from "./VisibilityIcon.js";

export function SectionIcon({ action }: { action: "add" | "collapse" | "expand" | "up" | "down" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d={
          {
            add: "M4 5h16M4 10h10M4 15h6M17 13v8M13 17h8",
            collapse: "m6 9 6 6 6-6",
            expand: "m9 6 6 6-6 6",
            up: "m6 14 6-6 6 6",
            down: "m6 10 6 6 6-6"
          }[action]
        }
      />
    </svg>
  );
}
export function WatchlistSectionMenu({
  section,
  x,
  y,
  disabled,
  canUp,
  canDown,
  onAdd,
  onToggle,
  onDelete,
  onRename,
  onMove,
  onClose
}: {
  section: WatchlistSection | null;
  x: number;
  y: number;
  disabled: boolean;
  canUp: boolean;
  canDown: boolean;
  onAdd: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  onClose: () => void;
  onRename: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const place = () =>
      setPosition({
        left: Math.max(
          6,
          Math.min(x, window.innerWidth - Math.min(300, window.innerWidth - 12) - 6)
        ),
        top: Math.max(6, Math.min(y, window.innerHeight - (ref.current?.offsetHeight ?? 100) - 6))
      });
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [x, y]);
  useEffect(() => {
    const previous = document.activeElement,
      element = ref.current;
    element?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !element?.contains(event.target)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        (document.activeElement === document.body || element?.contains(document.activeElement))
      )
        previous.focus({ preventScroll: true });
    };
  }, [onClose]);
  const run = (action: () => void) => {
    onClose();
    action();
  };
  return (
    <div
      ref={ref}
      role="menu"
      className="chart-context-menu watchlist-context-menu watchlist-section-menu"
      style={{ ...position, width: "min(300px, calc(100vw - 12px))" }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const buttons = [
            ...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])
          ];
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const index =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                  buttons.length;
          buttons[index]?.focus();
        }
      }}
    >
      <button role="menuitem" disabled={disabled} onClick={() => run(onAdd)}>
        <SectionIcon action="add" />
        <span>{sectionText("add")}</span>
      </button>
      {section && (
        <>
          <button role="menuitem" disabled={disabled} onClick={() => run(onRename)}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="m4 16 12-12 4 4L8 20H4v-4ZM13 7l4 4" />
            </svg>
            <span>{sectionText("rename")}</span>
          </button>
          <button role="menuitem" disabled={disabled} onClick={() => run(onToggle)}>
            <SectionIcon action={section.collapsed ? "expand" : "collapse"} />
            <span>{sectionText(section.collapsed ? "expand" : "collapse")}</span>
          </button>
          <button
            role="menuitem"
            disabled={disabled || !canUp}
            onClick={() => run(() => onMove(-1))}
          >
            <SectionIcon action="up" />
            <span>{sectionText("up")}</span>
          </button>
          <button
            role="menuitem"
            disabled={disabled || !canDown}
            onClick={() => run(() => onMove(1))}
          >
            <SectionIcon action="down" />
            <span>{sectionText("down")}</span>
          </button>
          <button role="menuitem" disabled={disabled} onClick={() => run(onDelete)}>
            <DeleteIcon />
            <span>{sectionText("delete")}</span>
          </button>
        </>
      )}
    </div>
  );
}

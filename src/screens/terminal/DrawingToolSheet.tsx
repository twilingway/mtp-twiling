import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n/messages.js";
import { DrawingToolIcon } from "./DrawingToolIcon.js";
import { ChevronIcon } from "./drawings/controls/ChevronIcon.js";
import type { DrawingToolbarMenuProps, ToolbarMenuItem } from "./DrawingToolbarMenu.js";

export function DrawingToolSheet({
  id,
  title,
  anchor,
  sections,
  onClose
}: DrawingToolbarMenuProps) {
  const overlay = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState<ToolbarMenuItem[]>([]);
  const level = path.at(-1);
  const current = level?.children ?? sections;
  const items = current.flatMap((part) => part.items);
  const back = () => setPath((previous) => previous.slice(0, -1));
  const open = (item: ToolbarMenuItem) => {
    if (item.disabled) return;
    if (item.children) setPath((previous) => [...previous, item]);
    else {
      // Toggles remain available; choosing a tool always closes, including the current tool.
      if (item.kind !== "checkbox") onClose(true);
      item.action?.();
    }
  };

  useLayoutEffect(() => {
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    const background = Array.from(document.body.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== overlay.current
    );
    const inert = background.map((element) => element.inert);
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    background.forEach((element) => {
      element.inert = true;
    });
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
      background.forEach((element, index) => {
        element.inert = inert[index] ?? false;
      });
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);

  useLayoutEffect(() => {
    const first =
      sheet.current?.querySelector<HTMLButtonElement>(
        '[data-menu-item][aria-checked="true"]:not([aria-disabled="true"])'
      ) ??
      sheet.current?.querySelector<HTMLButtonElement>(
        '[data-menu-item]:not([aria-disabled="true"])'
      );
    (first ?? sheet.current)?.focus({ preventScroll: true });
  }, [path]);

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const buttons = Array.from(
        sheet.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []
      );
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      (buttons[next] ?? sheet.current)?.focus({ preventScroll: true });
      return;
    }
    const target = event.target instanceof HTMLElement ? event.target : null;
    const row = target?.closest<HTMLElement>("[data-menu-row]");
    const index = items.findIndex((item) => item.id === row?.dataset.menuRow);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      const button = Array.from(
        sheet.current?.querySelectorAll<HTMLButtonElement>("[data-menu-item]") ?? []
      ).find((element) => element.dataset.menuItem === items[next]?.id);
      button?.focus({ preventScroll: true });
      button?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      const item = items[index];
      if (item?.children) open(item);
      else row?.querySelector<HTMLButtonElement>("[data-favorite]")?.focus({ preventScroll: true });
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (target?.hasAttribute("data-favorite"))
        row?.querySelector<HTMLButtonElement>("[data-menu-item]")?.focus({ preventScroll: true });
      else if (path.length) back();
      else onClose(true);
    }
  };

  return createPortal(
    <div
      ref={overlay}
      className="drawing-tool-sheet-overlay"
      onKeyDown={keyDown}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose(true);
      }}
    >
      <div
        ref={sheet}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={t(level?.label ?? title)}
        tabIndex={-1}
        className="drawing-tool-sheet"
      >
        {level && (
          <button type="button" className="drawing-sheet-back" onClick={back}>
            <ChevronIcon direction="left" />
            {t("Назад")}
          </button>
        )}
        <div role="menu" aria-label={t(level?.label ?? title)}>
          {current.map((part, sectionIndex) => (
            <div
              key={sectionIndex}
              role="group"
              aria-label={part.title ? t(part.title) : undefined}
              className="drawing-menu-section"
            >
              {part.title && (
                <div className="drawing-menu-section-title" role="presentation">
                  {t(part.title)}
                </div>
              )}
              {part.items.map((item) => (
                <div
                  key={item.id}
                  className="drawing-menu-row"
                  data-menu-row={item.id}
                  data-selected={item.checked || undefined}
                >
                  <button
                    type="button"
                    data-menu-item={item.id}
                    data-drawing-tool={item.id}
                    role={
                      item.kind === "checkbox"
                        ? "menuitemcheckbox"
                        : item.kind === "radio"
                          ? "menuitemradio"
                          : "menuitem"
                    }
                    aria-checked={item.kind ? Boolean(item.checked) : undefined}
                    aria-disabled={item.disabled || undefined}
                    aria-haspopup={item.children ? "menu" : undefined}
                    className="drawing-menu-action"
                    title={item.disabled ? t(item.reason ?? "Пока не реализовано") : t(item.label)}
                    onClick={() => open(item)}
                  >
                    <span className="drawing-menu-icon">
                      {item.icon && <DrawingToolIcon name={item.icon} />}
                    </span>
                    <span className="drawing-menu-label">{t(item.label)}</span>
                    {item.kind === "checkbox" && (
                      <span className="drawing-sheet-checkbox" aria-hidden="true">
                        {item.checked && <DrawingToolIcon name="check" />}
                      </span>
                    )}
                    {item.kind === "radio" && item.checked && (
                      <span className="drawing-menu-check" aria-hidden="true">
                        <DrawingToolIcon name="check" />
                      </span>
                    )}
                    {item.children && <ChevronIcon direction="right" />}
                  </button>
                  {item.onFavorite && (
                    <button
                      type="button"
                      data-favorite
                      className={`drawing-menu-favorite ${item.favorite ? "selected" : ""}`}
                      aria-pressed={item.favorite}
                      aria-label={
                        t(item.favorite ? "Убрать из избранного" : "В избранное") +
                        ": " +
                        t(item.label)
                      }
                      onClick={item.onFavorite}
                    >
                      <DrawingToolIcon name="star" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

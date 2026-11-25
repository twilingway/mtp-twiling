import { t } from "../../i18n/messages.js";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { DrawingToolIcon, type DrawingIconName } from "./DrawingToolIcon.js";
import { ChevronIcon } from "./drawings/controls/ChevronIcon.js";

export interface ToolbarMenuItem {
  id: string;
  label: string;
  icon?: DrawingIconName;
  disabled?: boolean;
  reason?: string;
  checked?: boolean;
  kind?: "radio" | "checkbox";
  shortcut?: string;
  favorite?: boolean;
  onFavorite?: () => void;
  action?: () => void;
  children?: ToolbarMenuSection[];
}
export interface ToolbarMenuSection {
  title: string | null;
  items: ToolbarMenuItem[];
}
interface Props {
  id: string;
  title: string;
  anchor: HTMLElement;
  sections: ToolbarMenuSection[];
  onClose: (restoreFocus?: boolean) => void;
}

interface SplitProps {
  id: string;
  toolId: string;
  label: string;
  menuLabel: string;
  icon: DrawingIconName;
  active: boolean;
  disabled?: boolean;
  expanded: boolean;
  onChoose: () => void;
  onMenu: (anchor: HTMLElement) => void;
}
export function DrawingToolbarSplit({
  id,
  toolId,
  label,
  menuLabel,
  icon,
  active,
  disabled,
  expanded,
  onChoose,
  onMenu
}: SplitProps) {
  const tooltip = disabled ? t(label) + t(" — Пока не реализовано") : t(label);
  return (
    <div className={`drawing-tool-split ${active ? "active" : ""}`} data-tool-group={id}>
      <button
        type="button"
        className="tool drawing-tool-main"
        data-tool={toolId}
        title={tooltip}
        aria-label={tooltip}
        aria-pressed={active}
        disabled={disabled}
        onClick={onChoose}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            onMenu(event.currentTarget);
          }
        }}
      >
        <DrawingToolIcon name={icon} />
      </button>
      <button
        type="button"
        className="drawing-tool-arrow"
        aria-label={t(menuLabel) + t(": открыть меню")}
        aria-haspopup="menu"
        aria-expanded={expanded}
        aria-controls={expanded ? "drawing-toolbar-menu" : undefined}
        onClick={(event) => onMenu(event.currentTarget)}
        onKeyDown={(event) => {
          if (["ArrowRight", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            onMenu(event.currentTarget);
          }
        }}
      >
        <ChevronIcon direction="right" />
      </button>
    </div>
  );
}

export function DrawingToolbarMenu({ id, title, anchor, sections, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState<ToolbarMenuItem[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const level = path.at(-1);
  const current = level?.children ?? sections;
  const items = current.flatMap((part) => part.items);
  const firstId = items.find((item) => !item.disabled)?.id ?? items[0]?.id;
  const activeId = items.some((item) => item.id === focusId) ? focusId : firstId;
  const focus = (itemId: string | undefined) => {
    if (!itemId) return;
    setFocusId(itemId);
    const button = Array.from(
      root.current?.querySelectorAll<HTMLButtonElement>("[data-menu-item]") ?? []
    ).find((element) => element.dataset.menuItem === itemId);
    button?.focus();
    button?.scrollIntoView({ block: "nearest" });
  };
  const open = (item: ToolbarMenuItem) => {
    if (item.disabled) return;
    if (item.children) {
      setPath((previous) => [...previous, item]);
      setFocusId(null);
    } else item.action?.();
  };
  const back = () => {
    const previousId = path.at(-1)?.id;
    setPath((previous) => previous.slice(0, -1));
    setFocusId(previousId ?? null);
  };

  useLayoutEffect(() => {
    const position = () => {
      const element = root.current;
      if (!element) return;
      const rect = anchor.getBoundingClientRect();
      const small = window.innerWidth <= 600;
      element.style.left = `${small ? 8 : Math.max(8, Math.min(rect.right + 8, window.innerWidth - element.offsetWidth - 8))}px`;
      element.style.top = `${small ? Math.max(96, window.innerHeight - element.offsetHeight - 8) : Math.max(8, Math.min(rect.top, window.innerHeight - element.offsetHeight - 8))}px`;
      element.style.maxHeight = `${Math.max(80, window.innerHeight - (small ? 104 : 16))}px`;
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const observer = new ResizeObserver(position);
    if (root.current) observer.observe(root.current);
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !anchor.contains(event.target)
      )
        onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [anchor, onClose]);

  useLayoutEffect(() => {
    const button = Array.from(
      root.current?.querySelectorAll<HTMLButtonElement>("[data-menu-item]") ?? []
    ).find((element) => element.dataset.menuItem === activeId);
    button?.focus();
    button?.scrollIntoView({ block: "nearest" });
  }, [activeId, path]);

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const currentButton = target?.closest<HTMLElement>("[data-menu-row]");
    const index = items.findIndex((item) => item.id === currentButton?.dataset.menuRow);
    const selected = items[index];
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    } else if (event.key === "Tab") onClose();
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      focus(items[next]?.id);
    } else if (event.key === "ArrowRight" && selected) {
      event.preventDefault();
      if (selected.children) open(selected);
      else currentButton?.querySelector<HTMLButtonElement>("[data-favorite]")?.focus();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (target?.hasAttribute("data-favorite")) focus(selected?.id);
      else if (path.length) back();
      else onClose(true);
    }
  };

  return createPortal(
    <div ref={root} id={id} className="drawing-toolbar-popup" onKeyDown={keyDown}>
      <div className="drawing-toolbar-popup-heading">
        {level && (
          <button
            type="button"
            className="drawing-menu-back"
            aria-label={t("Назад")}
            onClick={back}
          >
            <ChevronIcon direction="left" />
          </button>
        )}
        <span>{t(level?.label ?? title)}</span>
        <button
          type="button"
          className="drawing-menu-close"
          aria-label={t("Закрыть меню")}
          onClick={() => onClose(true)}
        >
          <DrawingToolIcon name="close" />
        </button>
      </div>
      <div role="menu" aria-label={t(level?.label ?? title)} className="drawing-toolbar-menu">
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
                  tabIndex={activeId === item.id ? 0 : -1}
                  className={`drawing-menu-action ${item.checked ? "selected" : ""}`}
                  title={item.disabled ? t(item.reason ?? "Пока не реализовано") : t(item.label)}
                  onFocus={() => setFocusId(item.id)}
                  onClick={() => open(item)}
                >
                  <span className="drawing-menu-icon">
                    {item.icon && <DrawingToolIcon name={item.icon} />}
                  </span>
                  <span className="drawing-menu-label">
                    {t(item.label)}
                    {item.disabled && <small>{t(item.reason ?? "Пока не реализовано")}</small>}
                  </span>
                  {item.shortcut && <kbd>{item.shortcut}</kbd>}
                  {item.checked && (
                    <span className="drawing-menu-check">
                      <DrawingToolIcon name="check" />
                    </span>
                  )}
                  {item.children && (
                    <span className="drawing-menu-next">
                      <ChevronIcon direction="right" />
                    </span>
                  )}
                </button>
                {item.onFavorite && (
                  <button
                    type="button"
                    data-favorite
                    tabIndex={-1}
                    className={`drawing-menu-favorite ${item.favorite ? "selected" : ""}`}
                    aria-pressed={item.favorite}
                    aria-label={
                      t(item.favorite ? "Убрать из избранного" : "В избранное") +
                      ": " +
                      t(item.label)
                    }
                    title={item.favorite ? t("Убрать из избранного") : t("В избранное")}
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
    </div>,
    document.body
  );
}

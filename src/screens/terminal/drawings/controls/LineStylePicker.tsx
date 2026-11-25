import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../../../../i18n/messages.js";
import type { LineStyle } from "../../../../model/types.js";
import { ChevronIcon } from "./ChevronIcon.js";
import { LineStylePreview, type LineStylePreviewProps } from "./LineStylePreview.js";

const OPTIONS = [
  ["solid", "Линия"],
  ["dashed", "Штриховой пунктир"],
  ["dotted", "Точечный пунктир"]
] as const;

interface Props extends LineStylePreviewProps {
  label: string;
  name?: string;
  disabled?: boolean;
  onChange: (value: LineStyle) => void;
}

export function LineStylePicker({ label, name, disabled, onChange, ...preview }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<LineStyle>(preview.value);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const current = OPTIONS.find(([value]) => value === preview.value) ?? OPTIONS[0];

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      const menu = popup.current?.getBoundingClientRect();
      if (!rect || !menu) return;
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - menu.width - 8)),
        top:
          rect.bottom + menu.height + 8 > window.innerHeight
            ? Math.max(8, rect.top - menu.height - 4)
            : rect.bottom + 4
      });
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    place();
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        className="drawing-line-picker"
        name={name}
        disabled={disabled}
        aria-label={`${label}: ${t(current[1])}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => {
          setActive(preview.value);
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          const key = event.key;
          if (key === "Tab") {
            setOpen(false);
            return;
          }
          if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(key)) return;
          event.preventDefault();
          event.stopPropagation();
          if ((key === "Enter" || key === " ") && open) {
            onChange(active);
            setOpen(false);
            return;
          }
          const index = OPTIONS.findIndex(([value]) => value === (open ? active : preview.value));
          const next =
            key === "Home"
              ? 0
              : key === "End"
                ? 2
                : open && (key === "ArrowDown" || key === "ArrowUp")
                  ? (index + (key === "ArrowDown" ? 1 : -1) + OPTIONS.length) % OPTIONS.length
                  : index;
          setActive(OPTIONS[next]?.[0] ?? preview.value);
          setOpen(true);
        }}
      >
        <LineStylePreview {...preview} />
        <span className="drawing-control-sr-only">{t(current[1])}</span>
        <ChevronIcon />
      </button>
      {open &&
        createPortal(
          <div
            className="drawing-line-picker-layer"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onPointerUp={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (event.target === event.currentTarget) {
                setOpen(false);
                trigger.current?.focus();
              }
            }}
          >
            <div
              ref={popup}
              id={id}
              className="drawing-line-options"
              role="listbox"
              aria-label={label}
              style={position}
            >
              {OPTIONS.map(([value, title]) => (
                <div
                  key={value}
                  id={`${id}-${value}`}
                  role="option"
                  aria-selected={value === preview.value}
                  data-active={value === active}
                  className="drawing-line-option"
                  onPointerMove={() => setActive(value)}
                  onClick={() => {
                    onChange(value);
                    setOpen(false);
                    trigger.current?.focus();
                  }}
                >
                  <LineStylePreview {...preview} value={value} />
                  <span>{t(title)}</span>
                  <span className="drawing-line-selected" aria-hidden="true">
                    {value === preview.value ? "✓" : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>,
          trigger.current?.closest("dialog") ?? document.body
        )}
    </>
  );
}

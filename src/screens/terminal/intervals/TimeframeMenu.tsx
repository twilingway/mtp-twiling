import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../../../i18n/messages.js";
import {
  getInterval,
  INTERVALS,
  INTERVAL_GROUPS,
  UNAVAILABLE_INTERVAL_GROUPS
} from "../../../model/intervals/index.js";
import type {
  IntervalDefinition,
  IntervalGroupId,
  IntervalId
} from "../../../model/intervals/index.js";

export interface TimeframeMenuProps {
  value: IntervalId;
  onSelect: (interval: IntervalId) => void;
  favorites: readonly IntervalId[];
  onToggleFavorite: (interval: IntervalId) => void;
  /** Supply a reason for intervals whose source/calendar is not ready in the host. */
  availability?: Partial<Record<IntervalId, string>>;
  className?: string;
}
export function TimeframeMenu({
  value,
  onSelect,
  favorites,
  onToggleFavorite,
  availability = {},
  className = ""
}: TimeframeMenuProps) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Partial<Record<IntervalGroupId, boolean>>>({});
  const [position, setPosition] = useState({ left: 8, top: 40, maxHeight: 500 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const selected = getInterval(value);
  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const openBelow = below >= Math.min(320, above);
    const maxHeight = Math.max(0, Math.min(560, openBelow ? below : above));
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 296 - 8)),
      top: openBelow ? rect.bottom + 6 : Math.max(8, rect.top - maxHeight - 6),
      maxHeight
    });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const selectedButton = panel?.querySelector<HTMLButtonElement>(
      "[data-selected=true]:not(:disabled)"
    );
    (selectedButton ?? panel?.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus();
    selectedButton?.scrollIntoView({ block: "nearest" });
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !panel?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      )
        setOpen(false);
    };
    const moved = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", moved);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", moved);
    };
  }, [open]);
  const row = (item: IntervalDefinition, prefix: string) => {
    const reason = availability[item.id];
    const favorite = favorites.includes(item.id);
    return (
      <div
        key={`${prefix}-${item.id}`}
        className={`interval-menu-row${value === item.id ? " is-selected" : ""}`}
      >
        <button
          type="button"
          className="interval-menu-choice"
          aria-pressed={value === item.id}
          data-selected={value === item.id}
          disabled={Boolean(reason)}
          title={
            reason
              ? t(reason)
              : item.kind === "derived"
                ? `${t("Агрегация из")} ${t(getInterval(item.source).label)}`
                : t(item.label)
          }
          onClick={() => {
            onSelect(item.id);
            close(true);
          }}
        >
          <span>{t(item.label)}</span>
          {reason ? <small>{t(reason)}</small> : null}
        </button>
        <button
          type="button"
          className={`interval-menu-star${favorite ? " is-favorite" : ""}`}
          aria-label={`${t(favorite ? "Удалить" : "Добавить")} ${t(item.label)} ${t(favorite ? "из избранного" : "в избранное")}`}
          aria-pressed={favorite}
          title={t(favorite ? "Удалить из избранного" : "Добавить в избранное")}
          onClick={() => onToggleFavorite(item.id)}
        >
          <span aria-hidden="true">{favorite ? "★" : "☆"}</span>
        </button>
      </div>
    );
  };
  const favoriteItems = INTERVALS.filter((item) => favorites.includes(item.id));
  return (
    <span className={`interval-menu ${className}`}>
      {favoriteItems.length ? (
        <span
          className="interval-favorites"
          role="group"
          aria-label={t("Избранные интервалы свечей")}
        >
          {favoriteItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`interval-favorite${value === item.id ? " is-selected" : ""}`}
              data-interval-favorite={item.id}
              aria-label={t(item.label)}
              aria-pressed={value === item.id}
              disabled={Boolean(availability[item.id])}
              title={t(availability[item.id] ?? item.label)}
              onClick={() => {
                onSelect(item.id);
                close(false);
              }}
            >
              {t(item.shortLabel)}
            </button>
          ))}
        </span>
      ) : null}
      <button
        type="button"
        ref={triggerRef}
        className="interval-menu-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${t("Интервал свечей")}: ${t(selected.label)}`}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
          }
        }}
      >
        <span>{t(selected.shortLabel)}</span>
        <span className="interval-menu-chevron" aria-hidden="true">
          ⌄
        </span>
      </button>
      {open
        ? createPortal(
            <div
              id={panelId}
              ref={panelRef}
              className="interval-menu-panel"
              role="dialog"
              aria-label={t("Интервал свечей")}
              style={position}
              onBlur={(event) => {
                if (
                  event.relatedTarget instanceof Node &&
                  !event.currentTarget.contains(event.relatedTarget) &&
                  !triggerRef.current?.contains(event.relatedTarget)
                )
                  close(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  close(true);
                  return;
                }
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const buttons = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button:not(:disabled)"
                  )
                ];
                const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                        buttons.length;
                buttons[next]?.focus();
              }}
            >
              <div className="interval-menu-heading">{t("Интервал свечей")}</div>
              <button
                type="button"
                className="interval-menu-add"
                disabled
                title={t(
                  "Произвольные интервалы пока недоступны: нужны источник и правила агрегации."
                )}
              >
                {t("＋ Добавить интервал…")}
                <small>{t("Пока недоступно")}</small>
              </button>
              {favoriteItems.length ? (
                <section className="interval-menu-section" aria-label={t("Избранное")}>
                  <div className="interval-menu-caption">{t("Избранное")}</div>
                  {favoriteItems.map((item) => row(item, "favorite"))}
                </section>
              ) : null}
              {UNAVAILABLE_INTERVAL_GROUPS.slice(0, 2).map((group) => (
                <div key={group.id} className="interval-menu-unavailable" title={t(group.reason)}>
                  <span>{t(group.label)}</span>
                  <small>{t(group.reason)}</small>
                </div>
              ))}
              {INTERVAL_GROUPS.map((group) => (
                <section
                  key={group.id}
                  className="interval-menu-section"
                  aria-label={t(group.label)}
                >
                  <button
                    type="button"
                    className="interval-menu-category"
                    aria-expanded={!collapsed[group.id]}
                    aria-controls={`${panelId}-${group.id}`}
                    onClick={() =>
                      setCollapsed((current) => ({ ...current, [group.id]: !current[group.id] }))
                    }
                  >
                    <span>{t(group.label)}</span>
                    <span aria-hidden="true">{collapsed[group.id] ? "›" : "⌄"}</span>
                  </button>
                  <div id={`${panelId}-${group.id}`} hidden={Boolean(collapsed[group.id])}>
                    {!collapsed[group.id]
                      ? INTERVALS.filter((item) => item.group === group.id).map((item) =>
                          row(item, group.id)
                        )
                      : null}
                  </div>
                </section>
              ))}
              {UNAVAILABLE_INTERVAL_GROUPS.slice(2).map((group) => (
                <div key={group.id} className="interval-menu-unavailable" title={t(group.reason)}>
                  <span>{t(group.label)}</span>
                  <small>{t(group.reason)}</small>
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

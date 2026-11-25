import { useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import type { WatchlistSection } from "../../model/watchlist-sections.js";
import { isSectionTitle, WATCHLIST_SECTION_TITLE_LIMIT } from "../../model/watchlist-sections.js";
import { sectionText } from "../../i18n/messages-watchlist-sections.js";

export function WatchlistSectionHeader({
  section,
  count,
  disabled,
  dragClass,
  onToggle,
  onRename,
  editing,
  onEdit,
  onContext,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: {
  section: WatchlistSection;
  count: number;
  disabled: boolean;
  dragClass: string;
  editing: boolean;
  onEdit: (editing: boolean) => void;
  onToggle: () => void;
  onRename: (title: string) => void;
  onContext: (event: MouseEvent) => void;
  onMove: (direction: -1 | 1) => void;
  onDragStart: (event: DragEvent<HTMLTableRowElement>) => void;
  onDragOver: (event: DragEvent<HTMLTableRowElement>) => void;
  onDrop: (event: DragEvent<HTMLTableRowElement>) => void;
  onDragEnd: () => void;
}) {
  const [draft, setDraft] = useState({ source: section.title, value: section.title });
  const title = draft.source === section.title ? draft.value : section.title;
  const setTitle = (value: string) => setDraft({ source: section.title, value });
  const invalid = !isSectionTitle(title.trim());
  return (
    <tr
      className={`watchlist-section-row ${dragClass}`}
      data-section-id={section.id}
      draggable={!disabled && !editing}
      tabIndex={0}
      title={sectionText("keyboard")}
      onContextMenu={onContext}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onKeyDown={(event) => {
        if (editing || event.target !== event.currentTarget) return;
        if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          onMove(event.key === "ArrowUp" ? -1 : 1);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        } else if (event.key === "F2") {
          event.preventDefault();
          setTitle(section.title);
          onEdit(true);
        }
      }}
    >
      <td colSpan={4}>
        <div className="watchlist-section-content">
          <span className="watchlist-section-handle" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M8 5h1M15 5h1M8 12h1M15 12h1M8 19h1M15 19h1" />
            </svg>
          </span>
          <button
            className="watchlist-section-toggle"
            aria-expanded={!section.collapsed}
            title={sectionText(section.collapsed ? "expand" : "collapse")}
            disabled={disabled}
            onClick={onToggle}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={section.collapsed ? "m9 6 6 6-6 6" : "m6 9 6 6 6-6"} />
            </svg>
          </button>
          {editing ? (
            <form
              className="watchlist-section-edit"
              onSubmit={(event) => {
                event.preventDefault();
                if (!invalid) {
                  onRename(title.trim());
                  onEdit(false);
                }
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") {
                  event.preventDefault();
                  setTitle(section.title);
                  onEdit(false);
                }
              }}
            >
              <input
                autoFocus
                value={title}
                maxLength={WATCHLIST_SECTION_TITLE_LIMIT}
                aria-label={sectionText("name")}
                aria-invalid={invalid}
                title={invalid ? sectionText("invalid") : sectionText("name")}
                onChange={(event) => setTitle(event.target.value)}
              />
              <button type="submit" disabled={disabled || invalid} aria-label={sectionText("save")}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m5 12 4 4L19 6" />
                </svg>
              </button>
              <button
                type="button"
                aria-label={sectionText("cancel")}
                onClick={() => {
                  setTitle(section.title);
                  onEdit(false);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </form>
          ) : (
            <>
              <button
                className="watchlist-section-name"
                title={section.title}
                disabled={disabled}
                onClick={onToggle}
              >
                {section.title}
              </button>
              <span className="watchlist-section-count">{count}</span>
              <button
                className="watchlist-section-rename"
                title={sectionText("rename")}
                aria-label={sectionText("rename")}
                disabled={disabled}
                onClick={() => {
                  setTitle(section.title);
                  onEdit(true);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m4 16 12-12 4 4L8 20H4v-4ZM13 7l4 4" />
                </svg>
              </button>
              <button
                className="watchlist-section-actions"
                title={sectionText("actions")}
                aria-label={sectionText("actions")}
                aria-haspopup="menu"
                disabled={disabled}
                onClick={onContext}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="5" cy="12" r="1" />
                  <circle cx="12" cy="12" r="1" />
                  <circle cx="19" cy="12" r="1" />
                </svg>
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

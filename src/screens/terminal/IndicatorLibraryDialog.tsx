import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Locale } from "../../i18n/preferences.js";
import { indicatorLibraryText } from "../../i18n/messages-indicator-library.js";
import {
  addIndicatorLibraryEntry,
  filterIndicatorLibrary,
  indicatorLibraryFocusIndex
} from "../../model/indicator-library.js";
import type {
  IndicatorLibraryCategory,
  IndicatorLibraryEntry
} from "../../model/indicator-library.js";
import { Modal } from "./Modal.js";

export interface IndicatorLibraryDialogProps<Id extends string = string> {
  onClose: () => void;
  /** Add/enable only: repeated selection must not turn an existing indicator off. */
  onAdd: (id: Id) => void;
  entries: readonly IndicatorLibraryEntry<Id>[];
  activeIds: ReadonlySet<Id> | readonly Id[];
  locale: Locale;
}

const dialogId = "indicator-library-dialog";

export function IndicatorLibraryDialog<Id extends string>({
  onClose,
  onAdd,
  entries,
  activeIds,
  locale
}: IndicatorLibraryDialogProps<Id>) {
  const [category, setCategory] = useState<IndicatorLibraryCategory>("scripts");
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLElement>(null);
  const text = (key: Parameters<typeof indicatorLibraryText>[0]) =>
    indicatorLibraryText(key, locale);
  const visible = filterIndicatorLibrary(entries, category, query);
  const active = new Set(activeIds);

  useEffect(() => {
    search.current?.focus();
  }, []);
  useEffect(() => {
    const dialog = document.getElementById(dialogId);
    const heading = dialog?.querySelector("header h2");
    if (heading) {
      heading.id = `${dialogId}-title`;
      dialog?.setAttribute("aria-labelledby", heading.id);
    }
    dialog
      ?.querySelector("header button")
      ?.setAttribute("aria-label", indicatorLibraryText("close", locale));
  }, [locale]);

  function resultButtons() {
    return Array.from(
      results.current?.querySelectorAll<HTMLButtonElement>(
        "button[data-indicator-id]:not(:disabled)"
      ) ?? []
    );
  }
  function navigateResults(event: KeyboardEvent<HTMLElement>) {
    const buttons = resultButtons();
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    const next = indicatorLibraryFocusIndex(event.key, current, buttons.length);
    if (next !== null) {
      event.preventDefault();
      buttons[next]?.focus();
    }
  }
  return (
    <Modal id={dialogId} title={text("title")} onClose={onClose}>
      <div
        className="indicator-library"
        lang={locale}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="indicator-library-search">
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <circle cx="8.5" cy="8.5" r="5.5" />
            <path d="m13 13 4 4" />
          </svg>
          <input
            ref={search}
            type="search"
            value={query}
            placeholder={text("search")}
            aria-label={text("search")}
            aria-controls={`${dialogId}-results`}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown") return;
              const first = resultButtons()[0];
              if (first) {
                event.preventDefault();
                first.focus();
              }
            }}
          />
        </div>
        <div className="indicator-library-body">
          <nav className="indicator-library-sidebar" aria-label={text("sections")}>
            <button
              type="button"
              aria-current={category === "scripts" ? "page" : undefined}
              onClick={() => setCategory("scripts")}
            >
              {text("scripts")}
            </button>
            <span className="indicator-library-group-label">{text("builtIn")}</span>
            <button
              type="button"
              aria-current={category === "technicals" ? "page" : undefined}
              onClick={() => setCategory("technicals")}
            >
              {text("technicals")}
            </button>
          </nav>
          <section
            ref={results}
            id={`${dialogId}-results`}
            className="indicator-library-results"
            aria-label={text(category)}
            onKeyDown={navigateResults}
          >
            <h3>{text(category)}</h3>
            {visible.length ? (
              <ul>
                {visible.map((entry, index) => {
                  const reasonId = `${dialogId}-reason-${index}`;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        data-indicator-id={entry.id}
                        disabled={!entry.available}
                        aria-describedby={entry.available ? undefined : reasonId}
                        onClick={() => addIndicatorLibraryEntry(entry, onAdd)}
                      >
                        <span className="indicator-library-entry-text">
                          <span className="indicator-library-entry-name">{entry.label}</span>
                          {entry.description && <small>{entry.description}</small>}
                          {!entry.available && (
                            <small id={reasonId}>{entry.reason || text("unavailable")}</small>
                          )}
                        </span>
                        {active.has(entry.id) && (
                          <span className="indicator-library-added">{text("added")}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="indicator-library-empty" role="status">
                <p>{text("empty")}</p>
                <small>{text("emptyHint")}</small>
              </div>
            )}
          </section>
        </div>
      </div>
    </Modal>
  );
}

import { selectWatchlistState } from "./terminal-state-selection.js";
import { shallowEqual } from "./snapshot-selector.js";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n/messages.js";
import { sectionText } from "../../i18n/messages-watchlist-sections.js";
import type { MarketRow } from "../../model/types.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { matchesWatchlistFlag } from "../../model/watchlist-flags.js";
import {
  reconcileWatchlistSections,
  watchlistEntryKey,
  WATCHLIST_SECTION_LIMIT
} from "../../model/watchlist-sections.js";
import type { WatchlistSection } from "../../model/watchlist-sections.js";
import { changeWatchlistSections } from "../../model/watchlist-sections-actions.js";
import type { WatchlistSectionChange } from "../../model/watchlist-sections-actions.js";
import { watchlistGroups } from "../../model/watchlist-sections-view.js";
import type { WatchlistSortKey } from "../../model/watchlist-sections-view.js";
import { importWritable } from "./controller-transfer-guard.js";
import { persistWatchlistSectionChange } from "./watchlist-section-preferences.js";
import { useTerminal } from "./context.js";
import { QuoteRow } from "./WatchlistQuoteRow.js";
import { WatchlistMenu } from "./WatchlistMenu.js";
import { WatchlistSectionHeader } from "./WatchlistSectionHeader.js";
import { WatchlistSectionMenu } from "./WatchlistSectionMenu.js";
import { WatchlistStartupStatus, watchlistStartupNotice } from "./WatchlistStartupStatus.js";
import type { TerminalController } from "./controller.js";
import { publishWorkspaceInstrument } from "./workspace-sync-controller.js";

type Menu = { x: number; y: number; owner: string } & (
  | { kind: "row"; row: MarketRow; key: string; mode?: "flag"; fromAction?: boolean }
  | { kind: "section"; section: WatchlistSection }
  | { kind: "blank" }
);
export function WatchlistSectionsTable({
  query,
  sort,
  direction,
  onSort,
  onManualOrder,
  chartEditor,
  activeInstrument
}: {
  query: string;
  sort: WatchlistSortKey | null;
  direction: number;
  onSort: (key: WatchlistSortKey) => void;
  onManualOrder: () => void;
  chartEditor?: TerminalController;
  activeInstrument?: MarketRow | null;
}) {
  const { controller, state } = useTerminal(selectWatchlistState, shallowEqual);
  const startup = watchlistStartupNotice(state);
  const editor = chartEditor ?? controller;
  const rowMenuId = useId();
  const [menu, setMenu] = useState<Menu | null>(null),
    [dragSource, setDragSource] = useState<string | null>(null),
    [drop, setDrop] = useState<{ key: string; placement: "before" | "after" } | null>(null),
    [editingSection, setEditingSection] = useState<string | null>(null);
  const drag = useRef<{
      source: string;
      owner: string;
      session: unknown;
      signature: string;
    } | null>(null),
    suppressClickUntil = useRef(0);
  const ledger = reconcileWatchlistSections(state.rows, state.preferences.watchlistSections);
  const disabled = !importWritable(state) || !!state.backupBusy;
  const closeMenu = useCallback(() => setMenu(null), []);
  const endDrag = useCallback(() => {
    if (drag.current) suppressClickUntil.current = Date.now() + 250;
    drag.current = null;
    setDragSource(null);
    setDrop(null);
  }, []);
  useEffect(() => {
    const owner = state.owner,
      session = controller.sessionKey(),
      revision = state.chartRevision,
      route = JSON.stringify([
        state.preferences.symbol,
        state.preferences.instrumentUid,
        state.preferences.timeframe,
        state.preferences.engine,
        state.preferences.rangeDays
      ]);
    return controller.subscribe(() => {
      const current = controller.getSnapshot();
      if (
        current.owner !== owner ||
        controller.sessionKey() !== session ||
        current.chartRevision !== revision ||
        !importWritable(current) ||
        current.backupBusy ||
        JSON.stringify([
          current.preferences.symbol,
          current.preferences.instrumentUid,
          current.preferences.timeframe,
          current.preferences.engine,
          current.preferences.rangeDays
        ]) !== route
      ) {
        closeMenu();
        endDrag();
        setEditingSection(null);
      }
    });
  }, [
    controller,
    state.owner,
    state.chartRevision,
    state.preferences.symbol,
    state.preferences.instrumentUid,
    state.preferences.timeframe,
    state.preferences.engine,
    state.preferences.rangeDays,
    closeMenu,
    endDrag
  ]);
  const apply = (change: WatchlistSectionChange, manual = false) => {
    const owner = state.owner,
      session = controller.sessionKey();
    if (disabled) return;
    void persistWatchlistSectionChange(controller, change)
      .then((changed) => {
        if (
          changed &&
          manual &&
          controller.getSnapshot().owner === owner &&
          controller.sessionKey() === session
        )
          onManualOrder();
      })
      .catch((error: unknown) => {
        if (controller.getSnapshot().owner === owner && controller.sessionKey() === session)
          controller.notify(error instanceof Error ? error.message : sectionText("failed"));
      });
  };
  const add = (before: string | null) => {
    if (
      ledger.entries.filter((entry) => entry.kind === "section").length >= WATCHLIST_SECTION_LIMIT
    ) {
      controller.notify(sectionText("limit"));
      return;
    }
    apply({
      kind: "insert",
      before,
      header: {
        kind: "section",
        id: `section-${crypto.randomUUID()}`,
        title: sectionText("new"),
        collapsed: false
      }
    });
  };
  const step = (source: string, direction: -1 | 1) =>
    apply({ kind: "step", source, direction }, true);
  const canStep = (source: string, direction: -1 | 1) =>
    !!changeWatchlistSections(ledger, { kind: "step", source, direction });
  const remove = (row: MarketRow) => {
    closeMenu();
    void controller
      .removeInstrument(row)
      .catch((error: unknown) =>
        controller.notify(
          error instanceof Error ? error.message : t("Не удалось удалить инструмент.")
        )
      );
  };
  const select = (symbol: string, instrumentUid: string | null) => {
    if (drag.current || Date.now() < suppressClickUntil.current || disabled) return;
    const owner = state.owner;
    if (window.matchMedia("(max-width: 800px)").matches) controller.panel.closeMobile();
    void editor
      .setPreferences({ symbol, instrumentUid })
      .then(() => {
        if (controller.getSnapshot().owner === owner)
          publishWorkspaceInstrument(editor, instrumentUid);
      })
      .catch((error: unknown) => {
        if (controller.getSnapshot().owner === owner)
          controller.notify(
            error instanceof Error ? error.message : t("Не удалось открыть инструмент.")
          );
      });
  };
  const placement = (event: DragEvent<HTMLTableRowElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2
      ? ("before" as const)
      : ("after" as const);
  };
  const validDrag = () => {
    const current = drag.current;
    return current &&
      !disabled &&
      current.owner === state.owner &&
      current.session === controller.sessionKey() &&
      current.signature === JSON.stringify(ledger)
      ? current
      : null;
  };
  const startDrag = (event: DragEvent<HTMLTableRowElement>, source: string) => {
    if (
      disabled ||
      (event.target instanceof Element && event.target.closest("button,input,select"))
    ) {
      event.preventDefault();
      return;
    }
    closeMenu();
    drag.current = {
      source,
      owner: state.owner,
      session: controller.sessionKey(),
      signature: JSON.stringify(ledger)
    };
    setDragSource(source);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-mtp-watchlist-section", source);
  };
  const over = (event: DragEvent<HTMLTableRowElement>, key: string) => {
    if (!validDrag()) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDrop({ key, placement: placement(event) });
  };
  const dropOn = (event: DragEvent<HTMLTableRowElement>, target: string) => {
    const current = validDrag();
    if (!current) {
      endDrag();
      return;
    }
    event.preventDefault();
    const side = placement(event);
    endDrag();
    apply({ kind: "move", source: current.source, target, placement: side }, true);
  };
  const dragClass = (key: string) =>
    `${dragSource === key ? "dragging" : ""} ${drop?.key === key ? `drop-${drop.placement}` : ""}`;
  const openRow = (event: MouseEvent, row: MarketRow, key: string, mode?: "flag") => {
    event.preventDefault();
    event.stopPropagation();
    const fromAction = event.type === "click" && !mode;
    if (fromAction && menu?.kind === "row" && menu.key === key && menu.fromAction) {
      closeMenu();
      return;
    }
    controller.setContext(null);
    const anchor = mode || fromAction ? event.currentTarget.getBoundingClientRect() : null;
    setMenu({
      kind: "row",
      row,
      key,
      owner: state.owner,
      x: anchor ? anchor.left : event.clientX,
      y: anchor ? anchor.bottom + 4 : event.clientY,
      fromAction,
      ...(mode ? { mode } : {})
    });
  };
  const groups = watchlistGroups(
    state.rows,
    state.preferences.watchlistSections,
    (row) =>
      matchesWatchlistFlag(
        row,
        state.preferences.watchlistFlags,
        state.preferences.watchlistFlagFilter
      ) &&
      `${row.symbol} ${row.ticker} ${row.name}`
        .toLocaleLowerCase("ru-RU")
        .includes(query.trim().toLocaleLowerCase("ru-RU")),
    sort,
    direction
  );
  const selected =
      activeInstrument === undefined
        ? selectedMarketRow(state.rows, state.preferences)
        : activeInstrument,
    sections = groups.flatMap((group) => (group.section ? [group.section] : []));
  const rowActions =
    menu?.kind === "row"
      ? {
          onAddSection: () => add(menu.key),
          onStep: (direction: -1 | 1) => step(menu.key, direction),
          onAssign: (section: string | null) =>
            apply({ kind: "assign", source: menu.key, section }, true),
          sections,
          canUp: canStep(menu.key, -1),
          canDown: canStep(menu.key, 1)
        }
      : undefined;
  return (
    <div
      className="watchlist-scroll"
      onContextMenu={(event) => {
        if (event.target instanceof Element && event.target.closest("tr")) return;
        event.preventDefault();
        controller.setContext(null);
        setMenu({ kind: "blank", x: event.clientX, y: event.clientY, owner: state.owner });
      }}
    >
      <table>
        <thead>
          <tr>
            {(
              [
                ["symbol", t("Инструмент")],
                ["price", t("Посл. цена")],
                ["change", t("Изм.")],
                ["changePercent", t("Изм. %")]
              ] as [WatchlistSortKey, string][]
            ).map(([key, label]) => (
              <th
                key={key}
                aria-sort={sort === key ? (direction === 1 ? "ascending" : "descending") : "none"}
              >
                <button data-sort={key} onClick={() => onSort(key)}>
                  {label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody
          id="quotes"
          aria-busy={startup === "loading" || undefined}
          onDragLeave={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            )
              setDrop(null);
          }}
        >
          {!startup &&
            groups.flatMap((group) => {
              const section = group.section,
                key = section ? watchlistEntryKey(section) : "";
              return [
                section ? (
                  <WatchlistSectionHeader
                    key={key}
                    section={section}
                    count={group.rows.length}
                    disabled={disabled}
                    dragClass={dragClass(key)}
                    editing={editingSection === section.id}
                    onEdit={(editing) => setEditingSection(editing ? section.id : null)}
                    onToggle={() => {
                      if (!drag.current && Date.now() >= suppressClickUntil.current)
                        apply({ kind: "collapse", id: section.id });
                    }}
                    onRename={(title) => apply({ kind: "rename", id: section.id, title })}
                    onContext={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      controller.setContext(null);
                      const rect = event.currentTarget.getBoundingClientRect();
                      setMenu({
                        kind: "section",
                        section,
                        x: event.type === "click" ? rect.left : event.clientX,
                        y: event.type === "click" ? rect.bottom : event.clientY,
                        owner: state.owner
                      });
                    }}
                    onMove={(direction) => step(key, direction)}
                    onDragStart={(event) => startDrag(event, key)}
                    onDragOver={(event) => over(event, key)}
                    onDrop={(event) => dropOn(event, key)}
                    onDragEnd={endDrag}
                  />
                ) : null,
                ...(section?.collapsed
                  ? []
                  : group.rows.map(({ row, position, key }) => (
                      <QuoteRow
                        key={key}
                        row={row}
                        position={position}
                        selected={row === selected}
                        direction={state.pricesDirection.get(row.symbol) ?? ""}
                        dragClass={dragClass(key)}
                        onDragStart={(event) => startDrag(event, key)}
                        onDragOver={(event) => over(event, key)}
                        onDrop={(event) => dropOn(event, key)}
                        onDragEnd={endDrag}
                        onStep={(direction) => step(key, direction)}
                        onSelect={select}
                        onRemove={remove}
                        onFlag={(event) => openRow(event, row, key, "flag")}
                        onContext={(event) => openRow(event, row, key)}
                        menuId={
                          menu?.kind === "row" && menu.key === key && menu.fromAction
                            ? rowMenuId
                            : undefined
                        }
                      />
                    )))
              ];
            })}
        </tbody>
      </table>
      {startup ? (
        <WatchlistStartupStatus phase={startup} locale={state.preferences.locale} />
      ) : !groups.some((group) => group.rows.length) && !sections.length ? (
        <p id="empty-search">
          {state.rows.length
            ? t("Инструменты не найдены")
            : t("Список пуст. Добавьте инструмент кнопкой +.")}
        </p>
      ) : null}
      {menu &&
        menu.owner === state.owner &&
        createPortal(
          menu.kind === "row" ? (
            <WatchlistMenu
              id={rowMenuId}
              row={menu.row}
              x={menu.x}
              y={menu.y}
              {...(menu.mode ? { mode: menu.mode } : {})}
              {...rowActions}
              onClose={closeMenu}
            />
          ) : (
            <WatchlistSectionMenu
              section={menu.kind === "section" ? menu.section : null}
              x={menu.x}
              y={menu.y}
              disabled={disabled}
              canUp={menu.kind === "section" && canStep(watchlistEntryKey(menu.section), -1)}
              canDown={menu.kind === "section" && canStep(watchlistEntryKey(menu.section), 1)}
              onAdd={() => add(menu.kind === "section" ? watchlistEntryKey(menu.section) : null)}
              onToggle={() => {
                if (menu.kind === "section") apply({ kind: "collapse", id: menu.section.id });
              }}
              onDelete={() => {
                if (menu.kind === "section") apply({ kind: "delete", id: menu.section.id });
              }}
              onRename={() => {
                if (menu.kind === "section") setEditingSection(menu.section.id);
              }}
              onMove={(direction) => {
                if (menu.kind === "section") step(watchlistEntryKey(menu.section), direction);
              }}
              onClose={closeMenu}
            />
          ),
          document.body
        )}
    </div>
  );
}

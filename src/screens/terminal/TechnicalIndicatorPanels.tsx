import { useCallback, useId, useRef, useState } from "react";
import { useTerminal } from "./context.js";
import { technicalIndicatorDefinitions } from "../../model/technical-indicators/definitions.js";
import {
  technicalCalculationUnavailableReason,
  calculationLimitMessage
} from "../../model/technical-indicators/channel-average-runtime.js";
import {
  DEFAULT_TECHNICAL_PANE_HEIGHT_RATIO,
  technicalIndicatorGroups
} from "../../model/technical-indicator-layout.js";
import type { TechnicalIndicatorGroup } from "../../model/technical-indicator-layout.js";
import type { TechnicalPaneMetric } from "../../charts/adapter.js";
import { technicalMinimumCanvasHeight } from "../../charts/technical-pane-geometry.js";
import { VisibilityIcon } from "./VisibilityIcon.js";
import { SupplementalStudyStatus } from "./SupplementalStudyStatus.js";
import { DrawingToolbarMenu } from "./DrawingToolbarMenu.js";
import type { ToolbarMenuItem } from "./DrawingToolbarMenu.js";
import { useIndicatorMenuAction } from "./useIndicatorMenuAction.js";
import { useTechnicalPaneFocus } from "./use-technical-pane-focus.js";
import { useTechnicalPaneActionReveal } from "./use-technical-pane-action-reveal.js";
import {
  changeTechnicalPane,
  moveTechnicalIndicator,
  moveTechnicalPane,
  removeTechnicalPane,
  resizeTechnicalPane,
  updateTechnicalIndicator
} from "./technical-indicator-actions.js";

function instanceLabel(instance: TechnicalIndicatorGroup["instances"][number]): string {
  const definition = technicalIndicatorDefinitions.find(
    (item) => item.id === instance.definitionId
  )!;
  return [
    definition.shortTitle,
    Object.values(instance.params)
      .filter((item) => typeof item === "number")
      .join(", ")
  ]
    .filter(Boolean)
    .join(" ");
}

type PaneDirection = -1 | 1;

function TechnicalPaneCommands({
  group,
  previous,
  next,
  focused,
  toggleFocus
}: {
  group: TechnicalIndicatorGroup;
  previous: string | undefined;
  next: string | undefined;
  focused: boolean;
  toggleFocus: () => void;
}) {
  const { state, controller } = useTerminal();
  const { pending, run } = useIndicatorMenuAction(controller);
  const menuId = useId();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback((restore = false) => {
    setAnchor(null);
    if (restore) trigger.current?.focus({ preventScroll: true });
  }, []);
  const english = state.preferences.locale === "en";
  const text = (ru: string, en: string) => (english ? en : ru);
  const locked = !!(state.importingBackup || state.importRecoveryRequired || state.backupBusy);
  const blocked = pending || locked;
  const { pane } = group;
  if (pane.kind !== "pane") return null;
  const collapsed = group.preference?.collapsed === true;
  const ratio = group.preference?.heightRatio ?? DEFAULT_TECHNICAL_PANE_HEIGHT_RATIO;
  const menuLabel = text("Действия панели индикатора", "Indicator pane actions");
  const collapseLabel =
    collapsed && !focused
      ? text("Развернуть панель", "Expand pane")
      : text("Свернуть панель", "Collapse pane");
  const focusLabel = focused
    ? text("Восстановить раскладку", "Restore layout")
    : text("Развернуть панель на весь график", "Maximize pane in chart");
  const command = (id: string, label: string, action: () => Promise<void>): ToolbarMenuItem => ({
    id,
    label,
    action: () => {
      if (blocked) return;
      closeMenu(true);
      void run(action);
    }
  });
  const move = (direction: PaneDirection, destination: string) =>
    moveTechnicalPane(controller, pane.id, destination, direction < 0 ? "before" : "after");
  const choices = [
    ...(previous
      ? [
          command("pane-up", text("Переместить панель выше", "Move pane up"), () =>
            move(-1, previous)
          )
        ]
      : []),
    ...(next
      ? [
          command("pane-down", text("Переместить панель ниже", "Move pane down"), () =>
            move(1, next)
          )
        ]
      : []),
    ...(!collapsed && !focused && ratio < 0.8
      ? [
          command("pane-grow", text("Увеличить высоту", "Increase height"), () =>
            resizeTechnicalPane(controller, pane.id, 1)
          )
        ]
      : []),
    ...(!collapsed && !focused && ratio > 0.05
      ? [
          command("pane-shrink", text("Уменьшить высоту", "Decrease height"), () =>
            resizeTechnicalPane(controller, pane.id, -1)
          )
        ]
      : []),
    command("pane-remove", text("Удалить панель", "Remove pane"), () =>
      removeTechnicalPane(controller, pane.id)
    )
  ];
  return (
    <div
      className="technical-pane-actions"
      data-menu-open={(!blocked && anchor !== null) || undefined}
      role="group"
      aria-label={menuLabel}
    >
      <button
        type="button"
        disabled={locked}
        aria-disabled={pending || undefined}
        aria-label={collapseLabel}
        aria-expanded={focused || !collapsed}
        title={collapseLabel}
        onClick={() => {
          if (blocked) return;
          if (focused) toggleFocus();
          void run(() => changeTechnicalPane(controller, pane.id, focused || !collapsed));
        }}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path d={collapsed && !focused ? "m3 9 4-4 4 4" : "m3 5 4 4 4-4"} />
        </svg>
      </button>
      <button
        type="button"
        disabled={locked}
        aria-disabled={pending || undefined}
        aria-label={focusLabel}
        title={focusLabel}
        aria-pressed={focused}
        onClick={() => {
          if (!blocked) toggleFocus();
        }}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path
            d={focused ? "M7 3v4H3m8 4V7H7M4 4l3 3m0 0 3 3" : "M2 6V2h4m6 6v4H8M2 2l4 4m2 2 4 4"}
          />
        </svg>
      </button>
      <button
        ref={trigger}
        type="button"
        disabled={locked}
        aria-disabled={pending || undefined}
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-controls={anchor ? menuId : undefined}
        title={menuLabel}
        onClick={(event) => {
          if (!blocked) setAnchor(anchor ? null : event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (!blocked && event.key === "ArrowDown") {
            event.preventDefault();
            setAnchor(event.currentTarget);
          }
        }}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="3" cy="7" r="0.75" />
          <circle cx="7" cy="7" r="0.75" />
          <circle cx="11" cy="7" r="0.75" />
        </svg>
      </button>
      {anchor && !blocked && (
        <DrawingToolbarMenu
          id={menuId}
          title={menuLabel}
          anchor={anchor}
          sections={[{ title: null, items: choices }]}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

function TechnicalRows({
  group,
  inChartPane = false
}: {
  group: TechnicalIndicatorGroup;
  inChartPane?: boolean;
}) {
  const { state, controller } = useTerminal();
  const { pending, run } = useIndicatorMenuAction(controller);
  const dragging = useRef<string | null>(null);
  const english = state.preferences.locale === "en";
  const text = (ru: string, en: string) => (english ? en : ru);
  const blocked =
    pending || !!state.importingBackup || !!state.importRecoveryRequired || !!state.backupBusy;
  const shared = group.instances.length > 1;
  return (
    <div className="technical-indicator-rows" data-technical-group={group.key}>
      {group.instances.map((instance, index) => {
        const label = instanceLabel(instance);
        const limited =
          technicalCalculationUnavailableReason(instance, state.candles?.length ?? 0) ===
          "calculation-limit";
        return (
          <div
            key={instance.id}
            className={`technical-indicator-row ${instance.visible ? "" : "legend-hidden"}`}
            data-technical-id={instance.id}
            draggable={!blocked && shared}
            onDragStart={(event) => {
              dragging.current = instance.id;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("application/x-mtp-indicator", instance.id);
            }}
            onDragEnd={() => {
              dragging.current = null;
            }}
            onDragOver={(event) => {
              if (dragging.current) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              const id = dragging.current;
              dragging.current = null;
              if (id && !blocked)
                void run(() =>
                  moveTechnicalIndicator(
                    controller,
                    id,
                    instance.id,
                    event.clientY >
                      event.currentTarget.getBoundingClientRect().top +
                        event.currentTarget.clientHeight / 2
                      ? "after"
                      : "before"
                  )
                );
            }}
          >
            <button
              type="button"
              className="technical-indicator-title"
              disabled={blocked}
              title={`${label} · ${text("Настройки", "Settings")}`}
              onClick={() =>
                controller.update({
                  editingTechnicalIndicator: instance.id,
                  dialog: "technical-settings",
                  contextMenu: null
                })
              }
            >
              {label}
              {limited && <span role="status"> · {calculationLimitMessage(english)}</span>}
              {instance.visible && (
                <SupplementalStudyStatus definitionId={instance.definitionId} english={english} />
              )}
            </button>
            <span className="technical-row-actions">
              <button
                type="button"
                disabled={blocked}
                title={text(
                  instance.visible ? "Скрыть" : "Показать",
                  instance.visible ? "Hide" : "Show"
                )}
                onClick={() => {
                  void run(() =>
                    updateTechnicalIndicator(controller, instance.id, (item) => ({
                      ...item,
                      visible: !item.visible
                    }))
                  );
                }}
              >
                <VisibilityIcon hidden={!instance.visible} />
              </button>
              {shared &&
                ([-1, 1] as const)
                  .filter((direction) => group.instances[index + direction])
                  .map((direction) => (
                    <button
                      type="button"
                      key={direction}
                      disabled={blocked}
                      title={text(
                        direction < 0 ? "Выше в панели" : "Ниже в панели",
                        direction < 0 ? "Move up in pane" : "Move down in pane"
                      )}
                      onClick={() => {
                        const target = group.instances[index + direction];
                        if (target)
                          void run(() =>
                            moveTechnicalIndicator(
                              controller,
                              instance.id,
                              target.id,
                              direction < 0 ? "before" : "after"
                            )
                          );
                      }}
                    >
                      <svg viewBox="0 0 14 14" aria-hidden="true">
                        <path d={direction < 0 ? "m3 9 4-4 4 4" : "m3 5 4 4 4-4"} />
                      </svg>
                    </button>
                  ))}
              {(!inChartPane || shared) && (
                <button
                  type="button"
                  disabled={blocked}
                  title={text("Удалить индикатор", "Remove indicator")}
                  onClick={() => {
                    void run(() => updateTechnicalIndicator(controller, instance.id, () => null));
                  }}
                >
                  <svg viewBox="0 0 14 14" aria-hidden="true">
                    <path d="m4 4 6 6m0-6-6 6" />
                  </svg>
                </button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function TechnicalPriceLegend() {
  const { state } = useTerminal();
  const group = technicalIndicatorGroups(state.preferences.technicalIndicators ?? []).find(
    (item) => item.key === "price"
  );
  return group ? <TechnicalRows group={group} /> : null;
}

export function TechnicalObjectTree() {
  const { state } = useTerminal();
  const groups = technicalIndicatorGroups(
    state.preferences.technicalIndicators ?? [],
    state.preferences.technicalPaneLayout
  );
  return (
    <>
      {groups.map((group, index) => (
        <section key={group.key} className="technical-object-group">
          <h4>
            {state.preferences.locale === "en"
              ? group.key === "price"
                ? "Price chart"
                : `Pane ${index + 1}`
              : group.key === "price"
                ? "На графике цены"
                : `Панель ${index + 1}`}
          </h4>
          <TechnicalRows group={group} />
        </section>
      ))}
    </>
  );
}

export function TechnicalIndicatorPanels({ metrics }: { metrics: readonly TechnicalPaneMetric[] }) {
  const { state, controller } = useTerminal();
  const legend = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<{ key: string; scope: string } | null>(null);
  const groups = technicalIndicatorGroups(
    state.preferences.technicalIndicators ?? [],
    state.preferences.technicalPaneLayout
  ).filter((group) => group.pane.kind === "pane");
  useTechnicalPaneActionReveal(legend, metrics, groups.length > 0);
  const scope = JSON.stringify([
    state.owner,
    state.chartRevision,
    state.preferences.symbol,
    state.preferences.instrumentUid,
    state.preferences.timeframe,
    state.preferences.engine
  ]);
  const focus =
    selected && selected.scope === scope && groups.some((group) => group.key === selected.key)
      ? selected.key
      : null;
  const legacyVolume = state.preferences.engine === "kline" && state.preferences.indicators.volume;
  useTechnicalPaneFocus(
    legend,
    controller,
    focus,
    technicalMinimumCanvasHeight(groups.length, legacyVolume, 52),
    metrics
  );
  const showLegend = state.preferences.chartSettings.showLegend !== false;
  return (
    <div ref={legend} className="technical-pane-legends">
      {groups.map((group, index) => {
        if (focus && focus !== group.key) return null;
        const metric = metrics.find((item) => item.key === group.key);
        const collapsed = !focus && group.preference?.collapsed === true;
        const labels = collapsed ? group.instances.map(instanceLabel).join(" · ") : "";
        return metric ? (
          <div
            key={group.key}
            className="technical-pane-legend"
            data-technical-pane={group.key}
            style={{
              top: metric.top + 3,
              width: metric.width,
              height: Math.max(24, metric.height - 5)
            }}
          >
            {(showLegend || collapsed || focus) && (
              <div className="technical-pane-row-list">
                {collapsed ? (
                  <span className="technical-pane-summary" title={labels}>
                    {labels}
                  </span>
                ) : (
                  <TechnicalRows group={group} inChartPane />
                )}
              </div>
            )}
            <TechnicalPaneCommands
              group={group}
              previous={groups[index - 1]?.key.slice(5)}
              next={groups[index + 1]?.key.slice(5)}
              focused={focus === group.key}
              toggleFocus={() => setSelected(focus ? null : { key: group.key, scope })}
            />
          </div>
        ) : null;
      })}
    </div>
  );
}

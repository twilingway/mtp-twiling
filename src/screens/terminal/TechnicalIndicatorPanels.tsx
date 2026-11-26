import { useRef } from "react";
import { useTerminal } from "./context.js";
import { technicalIndicatorDefinitions } from "../../model/technical-indicators/definitions.js";
import {
  technicalCalculationUnavailableReason,
  calculationLimitMessage
} from "../../model/technical-indicators/channel-average-runtime.js";
import { technicalIndicatorGroups } from "../../model/technical-indicator-layout.js";
import type { TechnicalIndicatorGroup } from "../../model/technical-indicator-layout.js";
import type { TechnicalPaneMetric } from "../../charts/adapter.js";
import { VisibilityIcon } from "./VisibilityIcon.js";
import { useIndicatorMenuAction } from "./useIndicatorMenuAction.js";
import {
  changeTechnicalPane,
  moveTechnicalIndicator,
  moveTechnicalPane,
  updateTechnicalIndicator
} from "./technical-indicator-actions.js";

function TechnicalRows({ group }: { group: TechnicalIndicatorGroup }) {
  const { state, controller } = useTerminal();
  const { pending, run } = useIndicatorMenuAction(controller);
  const dragging = useRef<string | null>(null);
  const english = state.preferences.locale === "en";
  const text = (ru: string, en: string) => (english ? en : ru);
  const blocked =
    pending || !!state.importingBackup || !!state.importRecoveryRequired || !!state.backupBusy;
  const allGroups = technicalIndicatorGroups(
    state.preferences.technicalIndicators ?? [],
    state.preferences.technicalPaneLayout
  );
  const panes = allGroups.filter((item) => item.pane.kind === "pane");
  const paneIndex = panes.findIndex((item) => item.key === group.key);
  const collapsed = group.preference?.collapsed === true;
  return (
    <div className="technical-indicator-rows" data-technical-group={group.key}>
      {group.pane.kind === "pane" && (
        <div className="technical-pane-actions">
          <button
            type="button"
            disabled={blocked}
            aria-expanded={!collapsed}
            title={text(
              collapsed ? "Развернуть панель" : "Свернуть панель",
              collapsed ? "Expand pane" : "Collapse pane"
            )}
            onClick={() => {
              const pane = group.pane;
              if (pane.kind === "pane")
                void run(() => changeTechnicalPane(controller, pane.id, !collapsed));
            }}
          >
            <svg viewBox="0 0 14 14" aria-hidden="true">
              <path d={collapsed ? "m3 5 4 4 4-4" : "m3 9 4-4 4 4"} />
            </svg>
          </button>
          {([-1, 1] as const).map((direction) => (
            <button
              type="button"
              key={direction}
              disabled={blocked || !panes[paneIndex + direction]}
              title={text(
                direction < 0 ? "Панель выше" : "Панель ниже",
                direction < 0 ? "Move pane up" : "Move pane down"
              )}
              onClick={() => {
                const pane = group.pane,
                  target = panes[paneIndex + direction]?.pane;
                if (pane.kind === "pane" && target?.kind === "pane")
                  void run(() =>
                    moveTechnicalPane(
                      controller,
                      pane.id,
                      target.id,
                      direction < 0 ? "before" : "after"
                    )
                  );
              }}
            >
              <svg viewBox="0 0 14 14" aria-hidden="true">
                <path d={direction < 0 ? "m3 8 4-4 4 4M7 4v7" : "m3 6 4 4 4-4M7 3v7"} />
              </svg>
            </button>
          ))}
        </div>
      )}
      {group.instances.map((instance, index) => {
        const definition = technicalIndicatorDefinitions.find(
          (item) => item.id === instance.definitionId
        )!;
        const label = `${definition.shortTitle} ${Object.values(instance.params)
          .filter((item) => typeof item === "number")
          .join(", ")}`;
        const limited =
          technicalCalculationUnavailableReason(instance, state.candles?.length ?? 0) ===
          "calculation-limit";
        return (
          <div
            key={instance.id}
            className={`technical-indicator-row ${instance.visible ? "" : "legend-hidden"}`}
            data-technical-id={instance.id}
            draggable={!blocked && !collapsed}
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
              {([-1, 1] as const).map((direction) => (
                <button
                  type="button"
                  key={direction}
                  disabled={blocked || !group.instances[index + direction]}
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
  const { state } = useTerminal();
  const groups = technicalIndicatorGroups(
    state.preferences.technicalIndicators ?? [],
    state.preferences.technicalPaneLayout
  );
  if (state.preferences.chartSettings.showLegend === false) return null;
  return (
    <div className="technical-pane-legends">
      {groups
        .filter((group) => group.pane.kind === "pane")
        .map((group) => {
          const metric = metrics.find((item) => item.key === group.key);
          return metric ? (
            <div
              key={group.key}
              className="technical-pane-legend"
              style={{
                top: metric.top + 3,
                maxWidth: metric.width,
                maxHeight: Math.max(24, metric.height - 5)
              }}
            >
              <TechnicalRows group={group} />
            </div>
          ) : null;
        })}
    </div>
  );
}

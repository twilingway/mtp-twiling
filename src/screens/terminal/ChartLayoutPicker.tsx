import { useEffect, useId, useRef, useState } from "react";
import { t } from "../../i18n/messages.js";
import {
  CHART_LAYOUT_COUNTS,
  CHART_LAYOUTS,
  chartLayout
} from "../../model/chart-workspace-layout.js";
import type {
  ChartLayoutCount,
  ChartLayoutDefinition,
  ChartLayoutId
} from "../../model/chart-workspace-layout.js";
import type { WorkspaceSyncFlags } from "./workspace-sync.js";

export interface ChartLayoutPickerProps {
  layoutId: ChartLayoutId;
  flags: WorkspaceSyncFlags;
  disabled?: boolean;
  onLayoutChange: (id: ChartLayoutId) => void;
  onFlagChange: (key: keyof WorkspaceSyncFlags, enabled: boolean) => void;
}

const syncOptions = [
  ["instrument", "Инструмент"],
  ["timeframe", "Интервал"],
  ["crosshair", "Перекрестие"],
  ["time", "Время"],
  ["dateRange", "Диапазон дат"]
] as const satisfies ReadonlyArray<readonly [keyof WorkspaceSyncFlags, string]>;

function layoutName({ id, rows }: ChartLayoutDefinition) {
  if (id === "single") return t("Один график");
  if (rows === 1) return t("В один ряд");
  if (id.endsWith("-wide")) return t("Широкая сетка");
  if (id.endsWith("-stack")) return t("В одну колонку");
  if (id === "3-balanced" || id.endsWith("-focus")) return t("С главным графиком");
  return t("Равномерно");
}

export function ChartLayoutThumbnail({ layout }: { layout: ChartLayoutDefinition }) {
  return (
    <span
      className="chart-layout-thumbnail"
      aria-hidden="true"
      style={{
        gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`
      }}
    >
      {layout.panes.map((pane) => (
        <span
          key={pane.slot}
          style={{
            gridColumn: `${pane.columnStart + 1} / ${pane.columnEnd + 1}`,
            gridRow: `${pane.rowStart + 1} / ${pane.rowEnd + 1}`
          }}
        />
      ))}
    </span>
  );
}

export function ChartLayoutOptions({
  layoutId,
  flags,
  disabled,
  onLayoutChange,
  onFlagChange
}: ChartLayoutPickerProps) {
  const id = useId();
  const currentCount = chartLayout(layoutId)?.count ?? 1;
  const [browsing, setBrowsing] = useState<{
    fromLayoutId: ChartLayoutId;
    count: ChartLayoutCount;
  }>();
  const count = browsing?.fromLayoutId === layoutId ? browsing.count : currentCount;
  return (
    <div className="chart-layout-options">
      <fieldset className="chart-layout-counts" disabled={disabled}>
        <legend>{t("Число графиков")}</legend>
        <div className="chart-layout-count-grid">
          {CHART_LAYOUT_COUNTS.map((choice) => (
            <label key={choice}>
              <input
                type="radio"
                name={`${id}-chart-count`}
                aria-label={`${t("Число графиков")} ${choice}`}
                checked={choice === count}
                onChange={() => setBrowsing({ fromLayoutId: layoutId, count: choice })}
              />
              <span aria-hidden="true">{choice}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="chart-layout-variants" disabled={disabled}>
        <legend>{t("Варианты раскладки")}</legend>
        <div className="chart-layout-variant-grid">
          {CHART_LAYOUTS.filter((layout) => layout.count === count).map((layout) => (
            <button
              key={layout.id}
              className="chart-layout-variant"
              type="button"
              aria-controls="chart-workspace"
              aria-pressed={layout.id === layoutId}
              onClick={() => onLayoutChange(layout.id)}
            >
              <ChartLayoutThumbnail layout={layout} />
              <span>{layoutName(layout)}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="chart-layout-sync-flags" disabled={disabled}>
        <legend>{t("Синхронизация графиков")}</legend>
        {syncOptions.map(([key, label]) => (
          <label key={key}>
            <span>{t(label)}</span>
            <input
              type="checkbox"
              role="switch"
              checked={flags[key]}
              onChange={(event) => onFlagChange(key, event.currentTarget.checked)}
            />
          </label>
        ))}
      </fieldset>
    </div>
  );
}

export function ChartLayoutPicker(props: ChartLayoutPickerProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const layout = chartLayout(props.layoutId);
  const count = layout?.count ?? 1;
  const label = t("Раскладка графиков");
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div
      ref={root}
      className="chart-layout-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="chart-layout-picker-trigger"
        aria-label={`${label} · ${t("Число графиков")} ${count}`}
        aria-controls={id}
        aria-expanded={open}
        disabled={props.disabled}
        title={label}
        onClick={() => setOpen(!open)}
      >
        {layout && <ChartLayoutThumbnail layout={layout} />}
        <span>{count}</span>
        <span aria-hidden="true" className="chart-layout-picker-chevron" />
      </button>
      <div id={id} className="chart-layout-picker-popover" hidden={!open}>
        {open && (
          <ChartLayoutOptions
            {...props}
            onLayoutChange={(layoutId) => {
              props.onLayoutChange(layoutId);
              close();
            }}
          />
        )}
      </div>
    </div>
  );
}

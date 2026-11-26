import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { t } from "../../i18n/messages.js";
import {
  chartGridDividers,
  chartGridResizeRange,
  defaultChartLayout,
  resizeChartGridTracks
} from "../../model/chart-workspace-layout.js";
import type {
  ChartGridDivider,
  ChartLayoutCount,
  ChartLayoutDefinition
} from "../../model/chart-workspace-layout.js";
import {
  readWorkspaceGridSizes,
  workspaceGridStorageKey,
  writeWorkspaceGridSizes
} from "./workspace-grid-storage.js";
import type { LayoutSizes } from "./workspace-grid-storage.js";

type Axis = ChartGridDivider["axis"];

interface Drag {
  id: number;
  start: number;
  handle: HTMLDivElement;
  sizes: readonly number[];
  minimum: number;
}

const breakpoint = "(max-width: 1050px)";
const columnProperty = "--chart-grid-columns";
const rowProperty = "--chart-grid-rows";
const narrowRowProperty = "--chart-grid-stacked-rows";

function subscribe(callback: () => void): () => void {
  const query = window.matchMedia(breakpoint);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function isNarrow(): boolean {
  return window.matchMedia(breakpoint).matches;
}

function trackSizes(grid: HTMLElement, axis: Axis): number[] {
  const style = getComputedStyle(grid);
  const template = axis === "column" ? style.gridTemplateColumns : style.gridTemplateRows;
  const lengths = template.trim().split(/\s+/);
  return lengths.every((value) => /^\d+(?:\.\d+)?px$/.test(value))
    ? lengths.map((value) => Number.parseFloat(value))
    : [];
}

function sum(sizes: readonly number[]): number {
  return sizes.reduce((total, size) => total + size, 0);
}

function paneMinimum(
  sizes: readonly number[],
  definition: ChartLayoutDefinition,
  axis: Axis,
  narrow: boolean
): number {
  if (axis === "row" && narrow) return 240;
  if (axis === "row" && definition.id.endsWith("-stack")) return 160;
  const cells =
    axis === "column"
      ? Math.max(
          ...Array.from(
            { length: definition.rows },
            (_, index) =>
              definition.panes.filter((pane) => pane.rowStart <= index && index < pane.rowEnd)
                .length
          )
        )
      : sizes.length;
  return Math.min(axis === "column" ? 128 : 112, (0.8 * sum(sizes)) / cells);
}

function applySizes(
  grid: HTMLElement,
  axis: Axis,
  narrow: boolean,
  scrollable: boolean,
  sizes: readonly number[]
) {
  const property = axis === "column" ? columnProperty : narrow ? narrowRowProperty : rowProperty;
  const pixels = axis === "row" && scrollable;
  grid.style.setProperty(
    property,
    sizes.map((size) => (pixels ? `${size}px` : `minmax(0, ${size}fr)`)).join(" ")
  );
}

function updateHandleValues(
  layer: HTMLElement,
  dividers: readonly ChartGridDivider[],
  axis: Axis,
  sizes: readonly number[],
  minimum: number
) {
  const total = sum(sizes);
  if (total <= 0) return;
  const percent = (pixels: number) => String(Math.round((100 * pixels) / total));
  for (const [index, divider] of dividers.entries()) {
    const handle = layer.children[index];
    if (divider.axis !== axis || !handle) continue;
    const position = sum(sizes.slice(0, divider.boundary));
    const [from, to] = chartGridResizeRange(sizes, divider, minimum);
    handle.setAttribute("aria-valuemin", percent(position + from));
    handle.setAttribute("aria-valuemax", percent(position + to));
    handle.setAttribute("aria-valuenow", percent(position));
  }
}

function coordinate(event: PointerEvent<HTMLDivElement>, axis: Axis): number {
  return axis === "column" ? event.clientX : event.clientY;
}

function placement({ axis, boundary, cross }: ChartGridDivider) {
  const line = boundary + 1;
  const from = cross.start + 1;
  const to = cross.end + 1;
  return axis === "column"
    ? { gridColumn: `${line} / span 1`, gridRow: `${from} / ${to}` }
    : { gridColumn: `${from} / ${to}`, gridRow: `${line} / span 1` };
}

function clearDrag(drag: Drag) {
  delete drag.handle.dataset.resizing;
  if (drag.handle.hasPointerCapture(drag.id)) drag.handle.releasePointerCapture(drag.id);
}

export function WorkspaceGridDividers({
  count,
  definition = defaultChartLayout(count),
  owner
}: {
  count: ChartLayoutCount;
  definition?: ChartLayoutDefinition;
  owner?: string;
}) {
  const narrow = useSyncExternalStore(subscribe, isNarrow, () => false);
  const dividers = useMemo(() => chartGridDividers(definition, narrow), [definition, narrow]);
  const scrollable = narrow || definition.id.endsWith("-stack");
  const layout = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const saved = useRef(new Map<string, LayoutSizes>());
  const key = workspaceGridStorageKey(owner ?? "", definition, narrow);

  useLayoutEffect(() => {
    const layer = layout.current;
    const grid = layer?.parentElement;
    if (!layer || !grid) return;
    const measurements = saved.current;
    const sizes =
      measurements.get(key) ?? (owner ? readWorkspaceGridSizes(key, definition, narrow) : {});
    measurements.set(key, sizes);
    for (const axis of ["column", "row"] as const) {
      const restored = sizes?.[axis];
      if (restored) applySizes(grid, axis, narrow, scrollable, restored);
      const current = trackSizes(grid, axis);
      updateHandleValues(
        layer,
        dividers,
        axis,
        current,
        paneMinimum(current, definition, axis, narrow)
      );
    }
    return () => {
      const current = drag.current;
      drag.current = null;
      if (current) {
        clearDrag(current);
        const pending = measurements.get(key);
        if (owner && pending) writeWorkspaceGridSizes(key, pending);
      }
      grid.style.removeProperty(columnProperty);
      grid.style.removeProperty(rowProperty);
      grid.style.removeProperty(narrowRowProperty);
    };
  }, [definition, dividers, key, narrow, owner, scrollable]);

  const resize = (
    divider: ChartGridDivider,
    sizes: readonly number[],
    minimum: number,
    delta: number
  ) => {
    const layer = layout.current;
    const grid = layer?.parentElement;
    if (!layer || !grid) return;
    const { axis } = divider;
    const next = resizeChartGridTracks(sizes, divider, delta, minimum);
    saved.current.set(key, { ...saved.current.get(key), [axis]: next });
    applySizes(grid, axis, narrow, scrollable, next);
    updateHandleValues(layer, dividers, axis, next, minimum);
  };

  const persistSizes = () => {
    const current = saved.current.get(key);
    if (owner && current) writeWorkspaceGridSizes(key, current);
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>, divider: ChartGridDivider) => {
    const grid = layout.current?.parentElement;
    if (!grid || event.button !== 0 || drag.current) return;
    const sizes = trackSizes(grid, divider.axis);
    if (sizes.length < divider.adjacentTracks.end || sizes.some((size) => size <= 0)) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(event.pointerId);
    handle.dataset.resizing = "true";
    drag.current = {
      id: event.pointerId,
      start: coordinate(event, divider.axis),
      handle,
      sizes,
      minimum: paneMinimum(sizes, definition, divider.axis, narrow)
    };
  };

  const endDrag = ({ pointerId }: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current?.id !== pointerId) return;
    drag.current = null;
    clearDrag(current);
    persistSizes();
  };

  const keyboardResize = (event: KeyboardEvent<HTMLDivElement>, divider: ChartGridDivider) => {
    const grid = layout.current?.parentElement;
    if (!grid) return;
    const forward = divider.axis === "column" ? "ArrowRight" : "ArrowDown";
    const back = divider.axis === "column" ? "ArrowLeft" : "ArrowUp";
    const step = event.shiftKey ? 32 : 12;
    const delta =
      event.key === forward
        ? step
        : event.key === back
          ? -step
          : event.key === "Home"
            ? -Infinity
            : event.key === "End"
              ? Infinity
              : 0;
    if (!delta) return;
    event.preventDefault();
    const sizes = trackSizes(grid, divider.axis);
    if (sizes.length < divider.adjacentTracks.end || sizes.some((size) => size <= 0)) return;
    resize(divider, sizes, paneMinimum(sizes, definition, divider.axis, narrow), delta);
    persistSizes();
  };

  return (
    <div ref={layout} className="chart-workspace-dividers">
      {dividers.map((divider, index) => {
        const column = divider.axis === "column";
        const label = t(column ? "Изменить ширину графиков" : "Изменить высоту графиков");
        return (
          <div
            key={`${divider.axis}:${divider.boundary}:${divider.cross.start}`}
            className="chart-workspace-divider"
            data-axis={divider.axis}
            style={placement(divider)}
            role="separator"
            tabIndex={0}
            aria-label={`${label} ${index + 1}`}
            aria-orientation={column ? "vertical" : "horizontal"}
            onKeyDown={(event) => keyboardResize(event, divider)}
            onPointerDown={(event) => startDrag(event, divider)}
            onPointerMove={(event) => {
              const current = drag.current;
              if (current?.id !== event.pointerId) return;
              resize(
                divider,
                current.sizes,
                current.minimum,
                coordinate(event, divider.axis) - current.start
              );
            }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
          />
        );
      })}
    </div>
  );
}

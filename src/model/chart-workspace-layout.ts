export const CHART_LAYOUT_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const;
export const CHART_GRID_COLUMNS = 12;

export type ChartLayoutCount = (typeof CHART_LAYOUT_COUNTS)[number];
type MultiChartCount = Exclude<ChartLayoutCount, 1>;
type LayoutPattern = "balanced" | "wide" | "stack" | "focus";
export type ChartLayoutId = "single" | `${MultiChartCount}-${LayoutPattern}`;

/** The slot is 1-based. Track boundaries are 0-based and the end is exclusive. */
export interface ChartLayoutPane {
  readonly slot: number;
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly columnStart: number;
  readonly columnEnd: number;
}

export interface ChartLayoutDefinition {
  readonly id: ChartLayoutId;
  readonly count: ChartLayoutCount;
  readonly rows: number;
  readonly columns: number;
  readonly panes: readonly ChartLayoutPane[];
}

export function isChartLayoutCount(value: number): value is ChartLayoutCount {
  return Number.isInteger(value) && value >= 1 && value <= CHART_LAYOUT_COUNTS.length;
}

export function chartLayoutRowWidths(count: ChartLayoutCount): readonly number[] {
  // The first pane occupies both rows in the three-chart layout.
  if (count === 3) return [2, 1];
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const baseWidth = Math.floor(count / rows);
  const wideRows = count % rows;
  return Array.from({ length: rows }, (_, index) => baseWidth + Number(index < wideRows));
}

function rowGeometry(
  id: ChartLayoutId,
  count: ChartLayoutCount,
  widths: readonly number[],
  columns = CHART_GRID_COLUMNS
): ChartLayoutDefinition {
  let slot = 0;
  const panes = widths.flatMap((width, row) => {
    const span = columns / width;
    return Array.from({ length: width }, (_, index) => ({
      slot: ++slot,
      rowStart: row,
      rowEnd: row + 1,
      columnStart: index * span,
      columnEnd: (index + 1) * span
    }));
  });
  return { id, count, rows: widths.length, columns, panes };
}

function stackedWidths(count: ChartLayoutCount): readonly number[] {
  return Array.from({ length: count }, () => 1);
}

function focusedLayout(id: ChartLayoutId, count: MultiChartCount): ChartLayoutDefinition {
  const columns = CHART_GRID_COLUMNS,
    split = columns / 2,
    rows = count - 1;
  return {
    id,
    count,
    rows,
    columns,
    panes: [
      { slot: 1, rowStart: 0, rowEnd: rows, columnStart: 0, columnEnd: split },
      ...Array.from({ length: rows }, (_, row) => ({
        slot: row + 2,
        rowStart: row,
        rowEnd: row + 1,
        columnStart: split,
        columnEnd: columns
      }))
    ]
  };
}

const wideRows: Readonly<Record<Exclude<MultiChartCount, 2>, readonly number[]>> = {
  3: [3],
  4: [4],
  5: [4, 1],
  6: [4, 2],
  7: [4, 3],
  8: [4, 4],
  9: [4, 3, 2],
  10: [4, 4, 2],
  11: [6, 3, 2],
  12: [6, 6],
  13: [6, 4, 3],
  14: [6, 4, 4],
  15: [6, 6, 3],
  16: [6, 6, 4]
};

function layoutsForCount(count: ChartLayoutCount): readonly ChartLayoutDefinition[] {
  if (count === 1) return [rowGeometry("single", 1, [1])];
  const id = `${count}-balanced` as const;
  const balanced =
    count === 3 ? focusedLayout(id, 3) : rowGeometry(id, count, chartLayoutRowWidths(count));
  if (count === 2) return [balanced, rowGeometry("2-stack", 2, [1, 1])];
  return [
    balanced,
    rowGeometry(`${count}-wide`, count, wideRows[count]),
    ...(count <= 6 ? [rowGeometry(`${count}-stack`, count, stackedWidths(count))] : []),
    ...(count >= 4 && count <= 6 ? [focusedLayout(`${count}-focus`, count)] : [])
  ];
}

export const CHART_LAYOUTS: readonly ChartLayoutDefinition[] =
  CHART_LAYOUT_COUNTS.flatMap(layoutsForCount);
const layouts = new Map<string, ChartLayoutDefinition>(
  CHART_LAYOUTS.map((layout) => [layout.id, layout])
);

export function chartLayout(id: string | null | undefined): ChartLayoutDefinition | undefined {
  return id == null ? undefined : layouts.get(id);
}

export function defaultChartLayout(count: ChartLayoutCount): ChartLayoutDefinition {
  return layouts.get(count === 1 ? "single" : `${count}-balanced`)!;
}

type TrackRange = { start: number; end: number };

export interface ChartGridDivider {
  axis: "column" | "row";
  boundary: number;
  cross: TrackRange;
  adjacentTracks: TrackRange;
  adjacentPanes: readonly TrackRange[];
}

type Axis = ChartGridDivider["axis"];

function ranges(pane: ChartLayoutPane, axis: Axis) {
  const columns = { start: pane.columnStart, end: pane.columnEnd };
  const rows = { start: pane.rowStart, end: pane.rowEnd };
  return axis === "column" ? { along: columns, cross: rows } : { along: rows, cross: columns };
}

interface DividerEdge {
  spans: TrackRange[];
  panes: TrackRange[];
}

function dividerEdges(layout: ChartLayoutDefinition, axis: Axis): Map<number, DividerEdge> {
  const edges = new Map<number, DividerEdge>();
  const panes = layout.panes.map((pane) => ranges(pane, axis));
  for (const leading of panes) {
    const boundary = leading.along.end;
    for (const trailing of panes) {
      if (boundary !== trailing.along.start) continue;
      const start = Math.max(leading.cross.start, trailing.cross.start);
      const end = Math.min(leading.cross.end, trailing.cross.end);
      if (start >= end) continue;
      const edge = edges.get(boundary) ?? { spans: [], panes: [] };
      edge.spans.push({ start, end });
      edge.panes.push({ start: leading.along.start, end: trailing.along.end });
      edges.set(boundary, edge);
    }
  }
  return edges;
}

function joinedSpans(spans: TrackRange[]): TrackRange[] {
  const joined: TrackRange[] = [];
  for (const { start, end } of spans.sort((a, b) => a.start - b.start)) {
    const previous = joined.at(-1);
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else joined.push({ start, end });
  }
  return joined;
}

function axisDividers(layout: ChartLayoutDefinition, axis: Axis): ChartGridDivider[] {
  const edges = dividerEdges(layout, axis);
  const limit = axis === "column" ? layout.columns : layout.rows;
  const boundaries = [0, ...[...edges.keys()].sort((a, b) => a - b), limit];
  return boundaries.slice(1, -1).flatMap((boundary, index) => {
    const { panes, spans } = edges.get(boundary)!;
    return joinedSpans(spans).map((cross) => ({
      axis,
      boundary,
      cross,
      adjacentTracks: { start: boundaries[index]!, end: boundaries[index + 2]! },
      adjacentPanes: panes
    }));
  });
}

export function chartGridDividers(
  chosen: ChartLayoutDefinition | ChartLayoutCount,
  narrow: boolean
): readonly ChartGridDivider[] {
  const layout = typeof chosen === "number" ? defaultChartLayout(chosen) : chosen;
  const geometry = narrow
    ? rowGeometry(layout.id, layout.count, stackedWidths(layout.count), 1)
    : layout;
  return [...axisDividers(geometry, "column"), ...axisDividers(geometry, "row")];
}

function rangeWidth(sizes: readonly number[], start: number, end: number): number {
  return sizes.slice(start, end).reduce((sum, size) => sum + size, 0);
}

export function chartGridResizeRange(
  sizes: readonly number[],
  divider: ChartGridDivider,
  minimumPane: number
): readonly [number, number] {
  const { adjacentTracks, adjacentPanes, boundary } = divider;
  const leading = rangeWidth(sizes, adjacentTracks.start, boundary);
  const trailing = rangeWidth(sizes, boundary, adjacentTracks.end);
  let minimum = Math.min(0, 8 - leading);
  let maximum = Math.max(0, trailing - 8);
  for (const { start, end } of adjacentPanes) {
    minimum = Math.max(minimum, Math.min(0, minimumPane - rangeWidth(sizes, start, boundary)));
    maximum = Math.min(maximum, Math.max(0, rangeWidth(sizes, boundary, end) - minimumPane));
  }
  return [minimum, maximum];
}

export function resizeChartGridTracks(
  sizes: readonly number[],
  divider: ChartGridDivider,
  delta: number,
  minimumPane: number
): readonly number[] {
  const { start, end } = divider.adjacentTracks;
  const { boundary } = divider;
  const [minimum, maximum] = chartGridResizeRange(sizes, divider, minimumPane);
  const movement = Math.max(minimum, Math.min(delta, maximum));
  if (!movement) return sizes;
  const leadingRatio = 1 + movement / rangeWidth(sizes, start, boundary);
  const trailingRatio = 1 - movement / rangeWidth(sizes, boundary, end);
  return sizes.map((size, index) => {
    if (index < start || index >= end) return size;
    return size * (index < boundary ? leadingRatio : trailingRatio);
  });
}

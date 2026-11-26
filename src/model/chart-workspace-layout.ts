export const CHART_LAYOUT_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const;
export const CHART_GRID_COLUMNS = 12;

export type ChartLayoutCount = (typeof CHART_LAYOUT_COUNTS)[number];

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

type TrackRange = { start: number; end: number };

export interface ChartGridDivider {
  axis: "column" | "row";
  boundary: number;
  cross: TrackRange;
  adjacentTracks: TrackRange;
  adjacentPanes: readonly TrackRange[];
}

export function chartGridDividers(
  count: ChartLayoutCount,
  narrow: boolean
): readonly ChartGridDivider[] {
  const rowWidths = narrow ? Array.from({ length: count }, () => 1) : chartLayoutRowWidths(count);
  const columns = narrow ? 1 : CHART_GRID_COLUMNS;
  const wideRows = count === 3 && !narrow ? [2, 2] : rowWidths;
  const dividers: ChartGridDivider[] = [];
  const edges = new Map<number, { rows: number[]; panes: TrackRange[] }>();
  wideRows.forEach((width, row) => {
    const span = columns / width;
    for (let boundary = span; boundary < columns; boundary += span) {
      const edge = edges.get(boundary) ?? { rows: [], panes: [] };
      edge.rows.push(row);
      edge.panes.push({ start: boundary - span, end: boundary + span });
      edges.set(boundary, edge);
    }
  });
  const boundaries = [0, ...[...edges.keys()].sort((a, b) => a - b), columns];
  boundaries.slice(1, -1).forEach((boundary, index) => {
    const edge = edges.get(boundary);
    if (!edge) return;
    const adjacentTracks = { start: boundaries[index]!, end: boundaries[index + 2]! };
    let start = edge.rows[0]!;
    edge.rows.forEach((row, position) => {
      if (edge.rows[position + 1] === row + 1) return;
      dividers.push({
        axis: "column",
        boundary,
        cross: { start, end: row + 1 },
        adjacentTracks,
        adjacentPanes: edge.panes
      });
      start = edge.rows[position + 1] ?? row + 1;
    });
  });
  for (let boundary = 1; boundary < wideRows.length; boundary++) {
    const adjacentTracks = { start: boundary - 1, end: boundary + 1 };
    dividers.push({
      axis: "row",
      boundary,
      cross: { start: count === 3 && !narrow ? columns / 2 : 0, end: columns },
      adjacentTracks,
      adjacentPanes: [adjacentTracks]
    });
  }
  return dividers;
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

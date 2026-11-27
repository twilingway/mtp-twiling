import type {
  ChartGridDivider,
  ChartLayoutDefinition
} from "../../model/chart-workspace-layout.js";

export function gridTrackTotal(sizes: readonly number[]): number {
  return sizes.reduce((total, size) => total + size, 0);
}

export function gridPaneMinimum(
  sizes: readonly number[],
  definition: ChartLayoutDefinition,
  axis: ChartGridDivider["axis"],
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
  return Math.min(axis === "column" ? 128 : 112, (0.8 * gridTrackTotal(sizes)) / cells);
}

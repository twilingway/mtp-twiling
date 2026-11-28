import type { DrawingPoint, DrawingTool } from "./types.js";

/** A repeated first vertex encodes closure without adding a persistence field. */
export function preservePolylineClosure(
  name: DrawingTool,
  original: readonly DrawingPoint[],
  edited: DrawingPoint[],
  handle: number
): DrawingPoint[] {
  const first = original[0],
    last = original.at(-1);
  if (
    name !== "polyline" ||
    original.length < 4 ||
    first?.timestamp !== last?.timestamp ||
    first?.value !== last?.value
  )
    return edited;
  const opposite = handle === 0 ? edited.length - 1 : handle === edited.length - 1 ? 0 : -1;
  return opposite < 0
    ? edited
    : edited.map((point, index) => (index === opposite ? { ...edited[handle]! } : point));
}

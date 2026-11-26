import type { NumericSeries } from "./types.js";
import type {
  CompiledPresentation,
  CompiledPresentationPlot,
  PlotColorPolicy,
  PlotGeometry,
  PlotSize,
  PresentationDefinition,
  PresentationInput
} from "./presentation-types.js";

const hex = (value: string): boolean => /^#[0-9a-f]{6}$/i.test(value);
const size = (value: number): value is PlotSize =>
  Number.isInteger(value) && value >= 1 && value <= 4;
const opacity = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;
const matchingLength = (values: NumericSeries, count: number): boolean =>
  Array.isArray(values) && values.length === count;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RangeError(`Invalid TA presentation: ${message}`);
}
function validColor(policy: PlotColorPolicy): boolean {
  return policy.kind === "solid"
    ? hex(policy.color)
    : policy.kind === "palette" &&
        (policy.id === "macd-sign-change-v1" ||
          policy.id === "ao-change-v1" ||
          policy.id === "bbp-sign-v1");
}
function validGeometry(geometry: PlotGeometry): boolean {
  return geometry.kind === "line"
    ? geometry.gaps === "legacy" || geometry.gaps === "break"
    : geometry.kind === "columns"
      ? geometry.base === 0
      : geometry.kind === "cross" &&
        geometry.size.unit === "pine-relative" &&
        size(geometry.size.value);
}
/** Validates the full numeric graph, including hidden anchors; never repairs or fills missing prices. */
export function compilePresentation(
  definition: PresentationDefinition,
  input: PresentationInput
): CompiledPresentation {
  assert(definition.renderVersion === 2, "render version");
  const precisionPolicy = definition.precisionPolicy ?? "legacy-fixed-6";
  assert(
    precisionPolicy === "legacy-fixed-6" ||
      precisionPolicy === "native-price" ||
      precisionPolicy === "fixed-2",
    "precision policy"
  );
  assert(typeof input.visible === "boolean" && typeof input.collapsed === "boolean", "visibility");
  const count = input.timestamps.length;
  for (let i = 0; i < count; i++)
    assert(
      Number.isFinite(input.timestamps[i]) &&
        (i === 0 || input.timestamps[i]! > input.timestamps[i - 1]!),
      "timestamps must be finite and strictly increasing"
    );
  const constants = new Map<string, NumericSeries>();
  for (const constant of definition.constantSeries ?? []) {
    assert(
      !constants.has(constant.seriesKey) && !Object.hasOwn(input.series, constant.seriesKey),
      "constant series collision"
    );
    assert(
      definition.hiddenSeries.includes(constant.seriesKey) && Number.isFinite(constant.value),
      "constant declaration"
    );
    constants.set(constant.seriesKey, Object.freeze(Array<number>(count).fill(constant.value)));
  }
  const series = (key: string): NumericSeries => {
    assert(Object.hasOwn(input.series, key) || constants.has(key), `missing series ${key}`);
    const values = constants.get(key) ?? input.series[key]!;
    assert(matchingLength(values, count), `series length ${key}`);
    for (let i = 0; i < count; i++)
      assert(values[i] === null || Number.isFinite(values[i]), `non-finite series ${key}`);
    return values;
  };
  const hidden = new Set(definition.hiddenSeries);
  assert(hidden.size === definition.hiddenSeries.length, "duplicate hidden series");
  for (const key of hidden) series(key);
  const ids = new Set<string>(),
    outputIds = new Set([
      ...definition.plots.map((plot) => plot.id),
      ...(definition.referenceLevels ?? []).map((level) => level.id),
      ...definition.fills.filter((fill) => fill.extent === "pane").map((fill) => fill.id)
    ]),
    declaredSeries = new Set([...hidden, ...definition.plots.map((plot) => plot.seriesKey)]);
  for (const key of Object.keys(input.styles ?? {})) assert(outputIds.has(key), "unknown style");
  const visible = input.visible && !input.collapsed;
  const plots = definition.plots.map((plot): CompiledPresentationPlot => {
    assert(plot.id.length > 0 && !ids.has(plot.id), "duplicate or empty plot id");
    ids.add(plot.id);
    assert(!hidden.has(plot.seriesKey), "hidden anchor cannot create a visible plot");
    assert(validGeometry(plot.geometry) && size(plot.width), "plot geometry or width");
    assert(validColor(plot.color), "plot color");
    assert(plot.color.kind !== "palette" || plot.geometry.kind === "columns", "palette geometry");
    const values = series(plot.seriesKey),
      custom = input.styles?.[plot.id];
    if (custom)
      assert(
        hex(custom.color) &&
          size(custom.width) &&
          typeof custom.visible === "boolean" &&
          (custom.opacity === undefined || opacity(custom.opacity)) &&
          (custom.lineStyle === undefined ||
            ["solid", "dashed", "dotted"].includes(custom.lineStyle)),
        "legacy output style"
      );
    const width = custom?.width ?? plot.width;
    assert(size(width), "resolved plot width");
    let geometry: PlotGeometry = { ...plot.geometry };
    if (plot.geometry.kind === "cross") {
      const relativeSize = custom?.width ?? plot.geometry.size.value;
      assert(size(relativeSize), "resolved cross size");
      geometry = { kind: "cross", size: { unit: "pine-relative", value: relativeSize } };
    }
    const color: PlotColorPolicy = custom
      ? { kind: "solid", color: custom.color }
      : { ...plot.color };
    const compiled: CompiledPresentationPlot = {
      ...plot,
      precisionPolicy,
      geometry,
      color,
      width,
      values,
      opacity: custom?.opacity ?? 1,
      lineStyle: custom?.lineStyle ?? "solid",
      visible: visible && (custom?.visible ?? true),
      scale: "include-when-visible"
    };
    return Object.freeze(compiled);
  });
  const referenceLevels = definition.referenceLevels?.map((level) => {
    assert(level.id.length > 0 && !ids.has(level.id), "duplicate or empty reference id");
    ids.add(level.id);
    assert(
      Number.isFinite(level.value) &&
        hex(level.color) &&
        opacity(level.opacity) &&
        size(level.width) &&
        ["solid", "dashed", "dotted"].includes(level.lineStyle),
      "reference style"
    );
    const custom = input.styles?.[level.id];
    if (custom)
      assert(
        hex(custom.color) &&
          size(custom.width) &&
          typeof custom.visible === "boolean" &&
          (custom.opacity === undefined || opacity(custom.opacity)) &&
          (custom.lineStyle === undefined ||
            ["solid", "dashed", "dotted"].includes(custom.lineStyle)),
        "reference custom style"
      );
    const width = custom?.width ?? level.width;
    assert(size(width), "resolved reference width");
    return Object.freeze({
      ...level,
      ...custom,
      width,
      precisionPolicy,
      visible: visible && (custom?.visible ?? true),
      scale: "include-when-visible" as const
    });
  });
  const fills = definition.fills.map((fill) => {
    assert(fill.id.length > 0 && !ids.has(fill.id), "duplicate or empty fill id");
    ids.add(fill.id);
    assert(hex(fill.color) && opacity(fill.opacity) && fill.gaps === "break", "fill style");
    assert(fill.extent === undefined || fill.extent === "pane", "fill extent");
    const custom = fill.extent === "pane" ? input.styles?.[fill.id] : undefined;
    if (custom)
      assert(
        hex(custom.color) &&
          size(custom.width) &&
          typeof custom.visible === "boolean" &&
          (custom.opacity === undefined || opacity(custom.opacity)),
        "fill custom style"
      );
    assert(
      declaredSeries.has(fill.fromSeries) && declaredSeries.has(fill.toSeries),
      "fill anchor must be a declared plot or hidden series"
    );
    return Object.freeze({
      ...fill,
      ...(custom ? { color: custom.color, opacity: custom.opacity ?? fill.opacity } : {}),
      precisionPolicy,
      from: series(fill.fromSeries),
      to: series(fill.toSeries),
      visible: visible && (custom?.visible ?? true),
      scale: "none" as const
    });
  });
  return Object.freeze({
    renderVersion: 2,
    timestamps: input.timestamps,
    plots: Object.freeze(plots),
    fills: Object.freeze(fills),
    ...(referenceLevels ? { referenceLevels: Object.freeze(referenceLevels) } : {})
  });
}

/** Immediate previous slot, including null; intentionally never searches for a last-known price. */
export function presentationColor(plot: CompiledPresentationPlot, index: number): string | null {
  const current = plot.values[index];
  if (current === null || current === undefined) return null;
  if (plot.color.kind === "solid") return plot.color.color;
  if (plot.color.id === "bbp-sign-v1") return current >= 0 ? "#089981" : "#F23645";
  const previous = index > 0 ? plot.values[index - 1] : null,
    rising = previous !== null && previous !== undefined && current > previous;
  if (plot.color.id === "ao-change-v1")
    return previous === null || previous === undefined || rising ? "#009688" : "#F44336";
  return current >= 0 ? (rising ? "#26A69A" : "#B2DFDB") : rising ? "#FFCDD2" : "#FF5252";
}

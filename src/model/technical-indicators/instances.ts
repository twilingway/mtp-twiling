import { getTechnicalIndicatorDefinition, PRICE_SOURCES } from "./definitions.js";
import type {
  IndicatorPane,
  OutputStyle,
  TechnicalIndicatorId,
  TechnicalIndicatorInstance,
  TechnicalParameters
} from "./types.js";

const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value);
function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) => "value" in descriptor
    )
  );
}
function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Reflect.ownKeys(value).every((key) => typeof key === "string" && fields.includes(key));
}
function pane(value: unknown): value is IndicatorPane {
  return (
    record(value) &&
    (value.kind === "overlay"
      ? exact(value, ["kind"])
      : value.kind === "pane" && exact(value, ["kind", "id"]) && identifier(value.id))
  );
}
function style(value: unknown): value is OutputStyle {
  return (
    record(value) &&
    exact(value, ["color", "width", "visible"]) &&
    typeof value.color === "string" &&
    /^#[0-9a-f]{6}$/i.test(value.color) &&
    typeof value.width === "number" &&
    Number.isInteger(value.width) &&
    value.width >= 1 &&
    value.width <= 4 &&
    typeof value.visible === "boolean"
  );
}
export function isTechnicalIndicatorInstance(value: unknown): value is TechnicalIndicatorInstance {
  if (
    !record(value) ||
    !exact(value, [
      "schemaVersion",
      "id",
      "definitionId",
      "params",
      "pane",
      "visible",
      "order",
      "styles"
    ]) ||
    value.schemaVersion !== 1 ||
    !identifier(value.id) ||
    typeof value.definitionId !== "string" ||
    !record(value.params) ||
    !pane(value.pane) ||
    typeof value.visible !== "boolean" ||
    typeof value.order !== "number" ||
    !Number.isInteger(value.order) ||
    value.order < 0 ||
    value.order > 10000
  )
    return false;
  const definition = getTechnicalIndicatorDefinition(value.definitionId),
    params = value.params;
  if (
    !definition ||
    definition.status !== "computed" ||
    !exact(
      params,
      definition.parameters.map((item) => item.key)
    )
  )
    return false;
  if (
    !definition.parameters.every((parameter) => {
      const entry = params[parameter.key];
      return parameter.type === "source"
        ? PRICE_SOURCES.some((source) => source === entry)
        : typeof entry === "number" &&
            Number.isFinite(entry) &&
            entry >= parameter.min &&
            entry <= parameter.max &&
            (parameter.type !== "integer" || Number.isInteger(entry));
    })
  )
    return false;
  return (
    value.styles === undefined ||
    (record(value.styles) &&
      exact(
        value.styles,
        definition.outputs.map((output) => output.id)
      ) &&
      Object.values(value.styles).every(style))
  );
}
export function isTechnicalIndicatorInstanceList(
  value: unknown
): value is TechnicalIndicatorInstance[] {
  if (!Array.isArray(value) || value.length > 100) return false;
  const items: unknown[] = Array.from(value);
  return (
    items.every(isTechnicalIndicatorInstance) &&
    new Set(items.map((item) => item.id)).size === items.length
  );
}
export interface InstanceOptions<K extends TechnicalIndicatorId> {
  params?: Partial<TechnicalParameters[K]>;
  pane?: IndicatorPane;
  visible?: boolean;
  order?: number;
  styles?: Record<string, OutputStyle>;
}
export function createTechnicalIndicatorInstance<K extends TechnicalIndicatorId>(
  definitionId: K,
  id: string,
  options: InstanceOptions<K> = {}
): TechnicalIndicatorInstance {
  const definition = getTechnicalIndicatorDefinition(definitionId);
  if (!definition || definition.status !== "computed")
    throw new RangeError(
      definition?.status === "unsupported" ? definition.reason : "Unknown technical indicator"
    );
  const candidate: unknown = {
    schemaVersion: 1,
    id,
    definitionId,
    params: {
      ...Object.fromEntries(definition.parameters.map((item) => [item.key, item.defaultValue])),
      ...options.params
    },
    pane:
      options.pane ??
      (definition.defaultPane === "overlay" ? { kind: "overlay" } : { kind: "pane", id }),
    visible: options.visible ?? true,
    order: options.order ?? 0,
    ...(options.styles ? { styles: structuredClone(options.styles) } : {})
  };
  if (!isTechnicalIndicatorInstance(candidate))
    throw new RangeError("Invalid technical indicator instance");
  return structuredClone(candidate);
}

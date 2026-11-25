/** Instrument identifiers are opaque database values, never filesystem paths. */
export function isInstrumentSymbol(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 100 &&
    value.trim() === value &&
    /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]+$/u.test(value) &&
    !value.includes("\\") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

/** Read the three chart suffixes from the right so a ticker may itself contain colons. */
export function isInstrumentViewKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 200) return false;
  const fields = value.split(":"),
    suffixes = fields.splice(-3);
  return suffixes.length === 3 && suffixes.every(Boolean) && isInstrumentSymbol(fields.join(":"));
}

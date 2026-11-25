import type { IndicatorFlags, IndicatorKey } from "./types.js";

/** Combined and original MTP variants share periods and must not draw them twice. */
export function toggleIndicatorFlags(flags: IndicatorFlags, key: IndicatorKey): IndicatorFlags {
  const next: IndicatorFlags = { ...flags };
  if (key === "mtpAll") {
    next.mtpAll = !mtpSelection(flags).all;
    next.mtp160 = next.mtp440 = next.mtp640 = false;
  } else if (key.startsWith("mtp")) {
    if (flags.mtpAll) next.mtp160 = next.mtp440 = next.mtp640 = true;
    next[key] = !(flags.mtpAll || flags[key]);
    next.mtpAll = false;
  } else next[key] = !flags[key];
  return next;
}

export function mtpSelection(flags: IndicatorFlags): { all: boolean; partial: boolean } {
  const values = [flags.mtp160, flags.mtp440, flags.mtp640];
  const all = !!flags.mtpAll || values.every(Boolean);
  return { all, partial: !all && values.some(Boolean) };
}

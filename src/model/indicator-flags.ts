import type { IndicatorFlags, IndicatorKey } from "./types.js";

/** Combined and original MTP variants share periods and must not draw them twice. */
export function toggleIndicatorFlags(flags: IndicatorFlags, key: IndicatorKey): IndicatorFlags {
  const enabled = !flags[key];
  const next: IndicatorFlags = { ...flags, [key]: enabled };
  if (enabled && key === "mtpAll") {
    next.mtp160 = false;
    next.mtp440 = false;
    next.mtp640 = false;
  } else if (enabled && key.startsWith("mtp")) next.mtpAll = false;
  return next;
}

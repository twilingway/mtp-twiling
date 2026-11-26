import { timestampIsValid } from "./ta-batch-sessions-calendar.js";
import type { TechnicalBar } from "./types.js";

export interface MoonPhaseEvent {
  readonly kind: "new" | "full";
  readonly timestamp: number;
}

export interface MoonEphemeris {
  readonly startTimestamp: number;
  readonly endTimestamp: number;
  readonly phases: readonly MoonPhaseEvent[];
}

export interface MoonPhaseBar {
  readonly timestamp: number;
  readonly stage: "waxing" | "waning" | null;
  readonly markers: readonly MoonPhaseEvent[];
}

export function moonPhases(
  bars: readonly Pick<TechnicalBar, "timestamp">[],
  ephemeris?: MoonEphemeris
): MoonPhaseBar[] {
  if (ephemeris) {
    let previous = -Infinity;
    const { startTimestamp, endTimestamp, phases } = ephemeris;
    if (
      !timestampIsValid(startTimestamp) ||
      !timestampIsValid(endTimestamp) ||
      startTimestamp >= endTimestamp
    )
      throw new RangeError("Invalid ephemeris coverage period");
    for (const { kind, timestamp } of phases) {
      if (
        (kind !== "new" && kind !== "full") ||
        !timestampIsValid(timestamp) ||
        timestamp <= previous ||
        timestamp < startTimestamp ||
        timestamp >= endTimestamp
      )
        throw new RangeError("Invalid ordered lunar phases");
      previous = timestamp;
    }
  }
  const result: MoonPhaseBar[] = [];
  let previous = -Infinity;
  let phaseIndex = 0;
  let stage: MoonPhaseBar["stage"] = null;
  for (const { timestamp } of bars) {
    if (!timestampIsValid(timestamp) || timestamp <= previous)
      throw new RangeError("Bar opening times must be strictly increasing");
    previous = timestamp;
    const markers: MoonPhaseEvent[] = [];
    if (!ephemeris || timestamp < ephemeris.startTimestamp || timestamp >= ephemeris.endTimestamp) {
      result.push({ timestamp, stage: null, markers });
      continue;
    }
    while (
      phaseIndex < ephemeris.phases.length &&
      ephemeris.phases[phaseIndex]!.timestamp <= timestamp
    ) {
      const event = ephemeris.phases[phaseIndex++]!;
      stage = event.kind === "new" ? "waxing" : "waning";
      if (event.timestamp >= bars[0]!.timestamp) markers.push(event);
    }
    result.push({ timestamp, stage, markers });
  }
  return result;
}

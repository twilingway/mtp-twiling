export type VolumeAverage = "EMA" | "SMA";

export function boundedInteger(value: number, max: number): number {
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new RangeError(`Parameter must be an integer in 1..${max}`);
  return value;
}

export function averageType(value: VolumeAverage): VolumeAverage {
  if (value !== "EMA" && value !== "SMA") throw new RangeError("Unknown average type");
  return value;
}

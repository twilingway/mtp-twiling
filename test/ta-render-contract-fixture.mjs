import { createHash } from "node:crypto";
import { frozen42Contract } from "./technical-state-oscillator-fixture.mjs";

/** Intentionally excludes definitions: presentation metadata may evolve, numeric/v1 data may not. */
export function numeric42Witness(model) {
  const { definitions: _definitions, ...numeric } = frozen42Contract(model);
  return createHash("sha256").update(JSON.stringify(numeric)).digest("hex");
}

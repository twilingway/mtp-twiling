import { validateYandexManualDeletePlan } from "./slot-maintenance-plan.js";
import type { YandexManualDeletePlan } from "./slot-maintenance-plan.js";
import { object, uuidPattern, YandexError } from "./types.js";
import type { CloudDeleteTarget } from "../../model/cloud-sync.js";

export interface YandexMaintenance {
  readonly version: 1;
  readonly accountId: string;
  readonly credentialGeneration: string;
  readonly writerDeviceId: string;
  /** Conditional removal uses this exact operation generation, never a later plan. */
  readonly generation: string;
  readonly plan: YandexManualDeletePlan;
}
export function yandexMaintenanceTarget(plan: YandexManualDeletePlan): CloudDeleteTarget {
  const selected = plan.beforeSlots
    .flatMap(({ envelope }) => [envelope.current, envelope.previous])
    .find((version) => version?.revision.revisionId === plan.remoteId);
  if (!selected) throw new YandexError("remote-invalid");
  const deviceId = selected.revision.deviceId;
  const versions =
    plan.kind === "previous"
      ? 1
      : new Set(
          plan.beforeSlots
            .filter(({ envelope }) => envelope.current.revision.deviceId === deviceId)
            .flatMap(({ envelope }) => [envelope.current, envelope.previous])
            .filter((version) => version !== null)
            .map((version) => version.revision.revisionId)
        ).size;
  return { deviceId, date: selected.revision.createdAt, versions, kind: plan.kind };
}

export async function readYandexMaintenance(
  input: unknown,
  accountId: string
): Promise<YandexMaintenance | undefined> {
  if (input === undefined) return undefined;
  const value = object(input);
  if (
    !value ||
    value.version !== 1 ||
    value.accountId !== accountId ||
    typeof value.credentialGeneration !== "string" ||
    !value.credentialGeneration ||
    typeof value.writerDeviceId !== "string" ||
    !uuidPattern.test(value.writerDeviceId) ||
    typeof value.generation !== "string" ||
    !uuidPattern.test(value.generation)
  )
    throw new YandexError("local-save");
  let plan: YandexManualDeletePlan;
  try {
    plan = await validateYandexManualDeletePlan(value.plan);
  } catch {
    throw new YandexError("local-save");
  }
  if (
    plan.accountId !== accountId ||
    plan.credentialGeneration !== value.credentialGeneration ||
    plan.operationId !== value.generation
  )
    throw new YandexError("local-save");
  return {
    version: 1,
    accountId,
    credentialGeneration: value.credentialGeneration,
    writerDeviceId: value.writerDeviceId,
    generation: value.generation,
    plan
  };
}

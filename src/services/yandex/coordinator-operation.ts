import { yandexTransfer } from "./coordinator-transfer.js";
import { yandexTransferActions } from "./coordinator-actions.js";
import type { YandexContextBaseline } from "./context-baseline.js";

/** One writer-locked transfer uses the opening context baseline and the same action guards. */
export async function yandexOperationTransfer(
  options: Parameters<typeof yandexTransferActions>[0] & {
    baseline: YandexContextBaseline;
    inspectionOnly: boolean;
  }
): Promise<void> {
  const { host, revisions, journal, clientId, accountId, guard, selection, inspectionOnly } =
    options;
  const association = await options.baseline.operation(
    host,
    guard,
    journal,
    clientId,
    accountId,
    inspectionOnly || !!selection
  );
  return yandexTransfer(
    host,
    revisions,
    journal,
    clientId,
    accountId,
    guard,
    yandexTransferActions(options),
    selection,
    inspectionOnly,
    association
  );
}

import type { ChartAdapter } from "../../charts/adapter.js";
import { positivePriceStep } from "../../charts/price-format.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { viewKey } from "./controller-bridge.js";
import type { TerminalController } from "./controller.js";

/** Price metadata owns no history or camera writes and never extends the adapter lifetime. */
export function watchChartPriceMetadata(
  controller: Pick<TerminalController, "chart" | "sessionKey" | "getSnapshot" | "subscribe">,
  adapter: ChartAdapter,
  alive: () => boolean
): () => void {
  const source = adapter.source && { ...adapter.source };
  if (!source || !adapter.updatePriceFormat) return () => {};
  const session = controller.sessionKey(),
    revision = controller.getSnapshot().chartRevision;
  let appliedStep: number | undefined;
  const update = () => {
    const state = controller.getSnapshot(),
      row = selectedMarketRow(state.rows, state.preferences);
    if (
      !alive() ||
      controller.chart !== adapter ||
      adapter.retired ||
      !state.authenticated ||
      state.importingBackup ||
      state.importRecoveryRequired ||
      state.owner !== source.owner ||
      controller.sessionKey() !== session ||
      state.chartRevision !== revision ||
      adapter.source?.owner !== source.owner ||
      adapter.source.uid !== source.uid ||
      adapter.source.viewKey !== source.viewKey ||
      viewKey(state.preferences) !== source.viewKey ||
      row?.uid !== source.uid ||
      !positivePriceStep(row.step) ||
      row.step === appliedStep
    )
      return;
    adapter.updatePriceFormat?.({ owner: source.owner, uid: source.uid, step: row.step });
    appliedStep = row.step;
  };
  const unsubscribe = controller.subscribe(update);
  update();
  return unsubscribe;
}

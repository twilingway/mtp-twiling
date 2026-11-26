import { useEffect, useState } from "react";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { isBankIdentity } from "../../model/market-provider.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { MarketRow } from "../../model/types.js";
import { loadTbankPriceTarget } from "../../services/instrument-details/tbank-price-target.js";
import type { TerminalController } from "./controller.js";
import { marketAvailable } from "./market-readiness.js";
import { observePriceTarget } from "./price-target-request.js";
import type { ChartPriceTarget, PriceTargetLoader } from "./price-target-request.js";
import type { TerminalState } from "./state.js";

export type { ChartPriceTarget, PriceTargetLoader } from "./price-target-request.js";

function isPriceTarget(item: {
  readonly definitionId: string;
  readonly visible: boolean;
}): boolean {
  return item.definitionId === "price-target" && item.visible;
}

function priceTargetVisible({ preferences }: TerminalState): boolean {
  return (
    !drawingToolbarSettings(preferences.chartSettings).indicatorsHidden &&
    (preferences.technicalIndicators?.some(isPriceTarget) ?? false)
  );
}

function mayLoad(state: TerminalState): boolean {
  return (
    marketAvailable(state) &&
    !state.profileTransition &&
    !state.importingBackup &&
    !state.importRecoveryRequired &&
    state.historyViewReady !== false
  );
}

interface Observation {
  readonly owner: string;
  readonly uid: string;
  readonly session: NonNullable<ReturnType<TerminalController["sessionKey"]>>;
  readonly value: ChartPriceTarget;
}

export function usePriceTarget(
  controller: TerminalController,
  state: TerminalState,
  row: MarketRow | undefined,
  load: PriceTargetLoader = loadTbankPriceTarget
): ChartPriceTarget {
  const { owner } = state;
  const uid = row?.uid;
  const session = controller.sessionKey();
  const wanted = priceTargetVisible(state);
  const supported =
    !!row &&
    !!uid &&
    row.type === undefined &&
    (!row.assetClass || row.assetClass === "stock" || row.assetClass === "unknown") &&
    isBankIdentity(row) &&
    !!session?.authenticated &&
    !session.closed;
  const enabled = wanted && supported && mayLoad(state) && session.owner === owner;
  const [result, setResult] = useState<Observation | null>(null);

  useEffect(() => {
    if (!enabled || !uid || !session) return;
    return observePriceTarget({
      client: session,
      uid,
      load,
      now: () => session.serverNow(),
      active() {
        const current = controller.getSnapshot();
        return (
          controller.sessionKey() === session &&
          current.owner === owner &&
          priceTargetVisible(current) &&
          mayLoad(current) &&
          selectedMarketRow(current.rows, current.preferences)?.uid === uid
        );
      },
      publish: (value) => setResult({ owner, uid, session, value })
    });
  }, [controller, enabled, load, owner, session, uid]);

  if (!wanted) return { status: "hidden" };
  if (!supported) return { status: "unsupported" };
  if (!enabled) return { status: "loading" };
  return result?.owner === owner && result.uid === uid && result.session === session
    ? result.value
    : { status: "loading" };
}

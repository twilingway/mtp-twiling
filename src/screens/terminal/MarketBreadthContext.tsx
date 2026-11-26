import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  ImportedMarketBreadth,
  MarketBreadthInput
} from "../../model/technical-indicators/catalog-expansion/market-breadth.js";
import { useTerminal } from "./context.js";

type DateBasis = MarketBreadthInput["dateBasis"];
interface BreadthSource {
  input?: MarketBreadthInput;
  setData: (data: ImportedMarketBreadth | null) => void;
  setDateBasis: (basis: DateBasis) => void;
}
const SourceContext = createContext<BreadthSource | null>(null);

export function MarketBreadthProvider({ children }: { children: ReactNode }) {
  const { controller, state } = useTerminal();
  const session = controller.sessionKey();
  const scope = useMemo(() => ({ owner: state.owner, session }), [state.owner, session]);
  const [saved, setSaved] = useState<{ scope: typeof scope; input: MarketBreadthInput }>();
  const enabled =
    !state.profileTransition && !state.importingBackup && !state.importRecoveryRequired;
  const value = useMemo<BreadthSource>(() => {
    const input = enabled && saved?.scope === scope ? saved.input : undefined;
    const active = () => {
      const current = controller.getSnapshot();
      return (
        enabled &&
        current.owner === scope.owner &&
        controller.sessionKey() === scope.session &&
        !current.profileTransition &&
        !current.importingBackup &&
        !current.importRecoveryRequired
      );
    };
    return {
      ...(input ? { input } : {}),
      setData(data) {
        if (!active()) return;
        setSaved(
          data
            ? {
                scope,
                input: { data, marketId: data.metadata.marketId, dateBasis: "utc-date" }
              }
            : undefined
        );
      },
      setDateBasis(dateBasis) {
        if (input && active()) setSaved({ scope, input: { ...input, dateBasis } });
      }
    };
  }, [controller, enabled, saved, scope]);
  return <SourceContext value={value}>{children}</SourceContext>;
}

export function useMarketBreadth() {
  return useContext(SourceContext);
}

import { memo, useId, useMemo, useState } from "react";
import { t } from "../../i18n/messages.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { MarketRow } from "../../model/types.js";
import { AuxiliaryChart } from "./AuxiliaryChart.js";
import type { WorkspaceInstrument } from "./AuxiliaryChart.js";
import { ChartPanel } from "./ChartPanel.js";
import { useTerminal } from "./context.js";
import { marketAvailable } from "./market-readiness.js";
import { providerLabel } from "./provider-label.js";
import { PERIOD_LABELS } from "./state.js";

import type { ChartLayoutCount } from "./ChartLayoutControl.js";

function workspaceInstruments(rows: readonly MarketRow[]): readonly WorkspaceInstrument[] {
  const seen = new Set<string>();
  return rows.filter((row): row is WorkspaceInstrument => {
    if (!row.uid || seen.has(row.uid)) return false;
    seen.add(row.uid);
    return true;
  });
}

function instrumentOption({ ticker, symbol, name, providerRef, classCode }: WorkspaceInstrument) {
  const source = providerRef
    ? `${providerLabel(providerRef)} ${providerRef.category === "spot" ? "Spot" : "USDT"}`
    : classCode;
  return [ticker || symbol, source, name].filter(Boolean).join(" · ");
}

const InstrumentOptions = memo(
  function InstrumentOptions({ rows }: { rows: readonly WorkspaceInstrument[] }) {
    return rows.map((row) => (
      <option key={row.uid} value={row.uid}>
        {instrumentOption(row)}
      </option>
    ));
  },
  (previous, next) =>
    previous.rows.length === next.rows.length &&
    previous.rows.every((row, index) => {
      const updated = next.rows[index];
      return updated?.uid === row.uid && instrumentOption(updated) === instrumentOption(row);
    })
);

function ComparisonPanel({
  index,
  initialUid,
  rows
}: {
  index: number;
  initialUid: string;
  rows: readonly WorkspaceInstrument[];
}) {
  const selectId = useId();
  const [uid, setUid] = useState(initialUid);
  const { controller, state } = useTerminal();
  const p = state.preferences;
  const row = rows.find((candidate) => candidate.uid === uid);
  const timeframe = row?.providerRef
    ? p.timeframe === "2m"
      ? "1m"
      : p.timeframe === "10m"
        ? "5m"
        : p.timeframe
    : p.timeframe;
  const market = controller.sessionKey();
  const available =
    marketAvailable(state) &&
    (state.authenticated || !!row?.providerRef) &&
    !state.profileTransition &&
    !state.importingBackup &&
    !state.importRecoveryRequired;
  return (
    <section className="auxiliary-chart" aria-label={`${t("График")} ${index}`}>
      <div className="auxiliary-chart-toolbar">
        <label htmlFor={selectId}>{index}</label>
        <select
          id={selectId}
          aria-label={`${t("Инструмент графика")} ${index}`}
          value={row?.uid ?? ""}
          onChange={(event) => setUid(event.currentTarget.value)}
        >
          <option value="">{t("Выберите инструмент")}</option>
          <InstrumentOptions rows={rows} />
        </select>
        {row && (
          <span className="auxiliary-chart-timeframe" title={t("Таймфрейм")}>
            {t(PERIOD_LABELS[timeframe])}
          </span>
        )}
      </div>
      {market && available && row ? (
        <AuxiliaryChart
          key={JSON.stringify([row.uid, row.symbol, timeframe, p.rangeDays])}
          row={row}
          controller={controller}
          market={market}
          owner={state.owner}
          preferences={timeframe === p.timeframe ? p : { ...p, timeframe }}
        />
      ) : (
        <div className="auxiliary-chart-empty">
          {t(row ? "Источник котировок недоступен." : "Выберите инструмент из списка котировок.")}
        </div>
      )}
    </section>
  );
}

export function ChartWorkspace({ count }: { count: ChartLayoutCount }) {
  const { state } = useTerminal();
  const rows = useMemo(() => workspaceInstruments(state.rows), [state.rows]);
  const primaryUid = selectedMarketRow(state.rows, state.preferences)?.uid;
  const alternatives =
    count > 1
      ? rows.filter((row) => row.uid !== primaryUid && (state.authenticated || row.providerRef))
      : [];
  return (
    <div id="chart-workspace" className="chart-workspace" data-chart-count={count}>
      <ChartPanel />
      {count >= 2 && (
        <ComparisonPanel
          key={`${state.owner}:2`}
          index={2}
          rows={rows}
          initialUid={alternatives[0]?.uid ?? ""}
        />
      )}
      {count >= 3 && (
        <ComparisonPanel
          key={`${state.owner}:3`}
          index={3}
          rows={rows}
          initialUid={alternatives[1]?.uid ?? ""}
        />
      )}
    </div>
  );
}

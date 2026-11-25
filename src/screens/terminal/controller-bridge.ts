import type { ChartAdapter } from "../../charts/adapter.js";
import type { Candle } from "../../model/types.js";
import type { TBankClient } from "../../services/tbank-client.js";
import { DEFAULT_CHART_SETTINGS, DEFAULT_INDICATORS } from "./state.js";
import type { TerminalPreferences, TerminalState } from "./state.js";

export interface TerminalBridge {
  getState: () => TerminalState;
  getChart: () => ChartAdapter | null;
  update: (patch: Partial<TerminalState>) => void;
  notify: (message: string) => void;
}
export interface HistoryBridge extends TerminalBridge {
  getClient: () => TBankClient | null;
  isAlive: () => boolean;
}
export interface SessionBridge extends TerminalBridge {
  resetHistory: () => void;
  loadHistory: (refresh?: boolean) => Promise<void>;
  isClearingHistory: () => boolean;
  mutateCandles: (candles: Candle[]) => void;
  flush: () => Promise<void>;
}
export const defaultPreferences = (): TerminalPreferences => ({
  symbol: "GAZP",
  timeframe: "1d",
  engine: "tradingview",
  indicators: { ...DEFAULT_INDICATORS },
  rangeDays: 365,
  chartSettings: { ...DEFAULT_CHART_SETTINGS }
});
export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : "Не удалось выполнить действие.";
export const isAbort = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";
export function viewKey(preferences: TerminalPreferences): string {
  return `${preferences.symbol}:${preferences.timeframe}:${preferences.engine}:${preferences.rangeDays}`;
}

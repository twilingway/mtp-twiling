import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { TerminalState } from "./state.js";

/** Crosshair is volatile; consumers must explicitly select it to receive hover updates. */
export function equalTerminalState(before: TerminalState, next: TerminalState): boolean {
  const keys = (Object.keys(before) as (keyof TerminalState)[]).filter(
    (key) => key !== "crosshairBar"
  );
  return (
    keys.length === Object.keys(next).filter((key) => key !== "crosshairBar").length &&
    keys.every((key) => Object.hasOwn(next, key) && Object.is(before[key], next[key]))
  );
}

export const selectPreferences = (state: TerminalState) => state.preferences;

export const selectShellState = (state: TerminalState) => ({
  owner: state.owner,
  ready: state.ready,
  profileTransition: state.profileTransition,
  importingBackup: state.importingBackup,
  mobilePanelOpen: state.mobilePanelOpen,
  rightPanelCollapsed: state.preferences.rightPanelCollapsed,
  dialog: state.dialog
});

export const selectControlsState = (state: TerminalState) => ({
  owner: state.owner,
  ready: state.ready,
  name: state.name,
  authenticated: state.authenticated,
  status: state.status,
  profileTransition: state.profileTransition,
  backupBusy: state.backupBusy,
  importingBackup: state.importingBackup,
  importRecoveryRequired: state.importRecoveryRequired,
  annotationReady: state.annotationReady,
  chartRevision: state.chartRevision,
  mobilePanelOpen: state.mobilePanelOpen,
  objectPanel: state.objectPanel,
  preferences: state.preferences
});

export type TerminalControlsState = ReturnType<typeof selectControlsState>;

export function selectToolbarState(state: TerminalState) {
  const row = selectedMarketRow(state.rows, state.preferences);
  return {
    ...selectControlsState(state),
    selectedTicker: row?.ticker,
    selectedProvider: row?.providerRef?.provider
  };
}

export const selectPanelState = (state: TerminalState) => ({
  owner: state.owner,
  objectPanel: state.objectPanel,
  mobilePanelOpen: state.mobilePanelOpen,
  rightPanelCollapsed: state.preferences.rightPanelCollapsed,
  locale: state.preferences.locale
});

export const selectDrawingToolbarState = (state: TerminalState) => ({
  owner: state.owner,
  authenticated: state.authenticated,
  dialog: state.dialog,
  activeTool: state.activeTool,
  preferences: state.preferences,
  drawings: state.drawings,
  images: state.images,
  selectedUid: selectedMarketRow(state.rows, state.preferences)?.uid
});

export const selectObjectTreeState = (state: TerminalState) => ({
  owner: state.owner,
  preferences: state.preferences,
  drawings: state.drawings,
  images: state.images,
  selectedObject: state.selectedObject,
  objectPanel: state.objectPanel
});

export const selectAccountState = (state: TerminalState) => ({
  owner: state.owner,
  name: state.name,
  authenticated: state.authenticated,
  status: state.status,
  error: state.error,
  initialAccountSection: state.initialAccountSection,
  preferences: state.preferences
});

export const selectWatchlistState = (state: TerminalState) => ({
  ...selectControlsState(state),
  importingBackup: !!state.importingBackup,
  importRecoveryRequired: !!state.importRecoveryRequired,
  profileTransition: !!state.profileTransition,
  annotationReady: state.annotationReady !== false,
  rows: state.rows,
  pricesDirection: state.pricesDirection,
  ...(state.watchlistStartup ? { watchlistStartup: state.watchlistStartup } : {})
});

export const selectApplicationInfoState = (state: TerminalState) => ({
  authenticated: state.authenticated,
  marketReady: state.marketReady,
  status: state.status,
  error: state.error,
  historyHelp: state.historyHelp,
  locale: state.preferences.locale
});

export const selectTransferSettingsState = (state: TerminalState) => ({
  owner: state.owner,
  preferences: state.preferences,
  pendingPublicSource: state.pendingPublicSource,
  profileTransition: state.profileTransition,
  marketReady: state.marketReady,
  backupBusy: state.backupBusy
});

export const selectStoragePanelState = (state: TerminalState) => ({
  ...selectControlsState(state),
  rows: state.rows
});

export const selectInstrumentDetailsState = (state: TerminalState) => ({
  owner: state.owner,
  authenticated: state.authenticated,
  profileTransition: state.profileTransition,
  status: state.status,
  importingBackup: state.importingBackup,
  importRecoveryRequired: state.importRecoveryRequired,
  preferences: state.preferences
});

export const selectTechnicalRowsState = (state: TerminalState) => ({
  ...selectControlsState(state),
  candleCount: state.candles?.length ?? 0
});

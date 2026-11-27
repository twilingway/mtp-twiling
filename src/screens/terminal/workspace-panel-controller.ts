import { mergeCandles, updateCandleList } from "../../model/history-codec.js";
import { historyRequestWindow } from "../../model/intervals/calendar.js";
import { nativeTimeframe } from "../../model/intervals/native-timeframes.js";
import { withTheme } from "../../model/theme.js";
import { retainNativeChartType } from "../../model/native-chart-type.js";
import type { Candle, ChartSettings, HistoryRange, MarketRow } from "../../model/types.js";
import type { MarketClient } from "../../services/market-client.js";
import type { PublicMarketReconnect } from "../../services/market-public.js";
import { nativeInterval } from "../../services/providers/bybit/market.js";
import { okxNativeInterval } from "../../services/providers/okx/market.js";
import { TerminalController } from "./controller.js";
import { importWritable } from "./controller-transfer-guard.js";
import { changeMenuIndicator, toggleCombinedMtpVisibility } from "./indicator-menu-actions.js";
import { marketAvailable } from "./market-readiness.js";
import type { TerminalPreferences, TerminalState } from "./state.js";
import { readWorkspaceAnnotations } from "./workspace-annotations.js";
import { startWorkspaceCandleFeed, workspaceHistoryRange } from "./workspace-candle-feed.js";
import { loadPanelCandles } from "./workspace-panel-candle-queue.js";
import {
  loadPanelPreferences,
  panelChartSettings,
  savePanelPreferences
} from "./workspace-panel-preferences.js";
import type { PanelPreferences } from "./workspace-panel-preferences.js";
export { loadWorkspaceInstrument, saveWorkspaceInstrument } from "./workspace-panel-preferences.js";

export type WorkspacePanelRow = MarketRow & { uid: string };

const dayMs = 86_400_000;
function panelTimeframe(
  timeframe: TerminalPreferences["timeframe"],
  row: WorkspacePanelRow | undefined
) {
  if (!row?.providerRef) return timeframe;
  return timeframe === "2m" ? "1m" : timeframe === "10m" ? "5m" : timeframe;
}

function availability(parent: TerminalState, row: WorkspacePanelRow | undefined): boolean {
  return !!row && marketAvailable(parent);
}

function knownRows(
  current: MarketRow[],
  latest: MarketRow[],
  selected?: WorkspacePanelRow
): MarketRow[] {
  if (current.length !== latest.length) return latest;
  const same = current.every((row, index) => {
    const next = latest[index]!;
    return selected && row.uid === selected.uid
      ? row === next
      : row.uid === next.uid &&
          row.symbol === next.symbol &&
          row.ticker === next.ticker &&
          row.name === next.name &&
          row.classCode === next.classCode;
  });
  return same ? current : latest;
}

interface PanelRoute {
  owner: string;
  row: WorkspacePanelRow;
  market: MarketClient;
  timeframe: TerminalPreferences["timeframe"];
  rangeDays: number;
}

function sameRoute(previous: PanelRoute | undefined, next: PanelRoute | undefined): boolean {
  return (
    previous === next ||
    (!!previous &&
      !!next &&
      previous.owner === next.owner &&
      previous.market === next.market &&
      previous.row.uid === next.row.uid &&
      previous.row.symbol === next.row.symbol &&
      previous.timeframe === next.timeframe &&
      previous.rangeDays === next.rangeDays)
  );
}

export class WorkspacePanelController extends TerminalController {
  private local?: PanelPreferences;
  private configuredOwner: string | undefined;
  private shared: TerminalPreferences | undefined;
  private row: WorkspacePanelRow | undefined;
  private route: PanelRoute | undefined;
  private retireFeed: (() => void) | undefined;
  private disconnect: (() => void) | undefined;
  private historyFrom: number | undefined;
  private historyAbort: AbortController | undefined;
  private olderBusy = false;
  private annotationRequest: PanelRoute | undefined;

  constructor(
    private readonly parent: TerminalController,
    private readonly slot: number,
    private readonly selectInstrument: (uid: string) => void
  ) {
    super(slot, parent.panel);
  }

  override sessionKey = () => this.parent.sessionKey();
  override marketNow = () => this.parent.marketNow();
  override loadCandleCalendar: TerminalController["loadCandleCalendar"] = (...args) =>
    this.parent.loadCandleCalendar(...args);

  private combinedPreferences(
    shared: TerminalPreferences,
    local: PanelPreferences,
    row: WorkspacePanelRow | undefined
  ): TerminalPreferences {
    const { locale, timeZone, watchlistSections } = shared;
    return {
      ...local,
      ...(locale && { locale }),
      ...(timeZone && { timeZone }),
      ...(shared.rightPanelTab && { rightPanelTab: shared.rightPanelTab }),
      ...(shared.rightPanelCollapsed !== undefined && {
        rightPanelCollapsed: shared.rightPanelCollapsed
      }),
      ...(watchlistSections && { watchlistSections }),
      symbol: row?.symbol ?? "",
      instrumentUid: row?.uid ?? null,
      ...(row?.providerRef && { providerRef: row.providerRef }),
      timeframe: panelTimeframe(local.timeframe, row),
      chartSettings: {
        ...(shared.chartSettings.theme && { theme: shared.chartSettings.theme }),
        ...local.chartSettings
      }
    };
  }

  configure(row: WorkspacePanelRow | undefined, parent: TerminalState): void {
    const state = this.getSnapshot();
    if (parent.profileTransition && !state.profileTransition) {
      this.retireFeed?.();
      this.retireFeed = undefined;
      this.disconnect?.();
      this.disconnect = undefined;
    }
    const market = this.sessionKey();
    const ready = availability(parent, row);
    const local =
      this.configuredOwner === parent.owner && this.local
        ? this.local
        : loadPanelPreferences(parent.owner, this.slot, parent.preferences);
    if (this.configuredOwner !== parent.owner) savePanelPreferences(parent.owner, this.slot, local);
    this.local = local;
    this.configuredOwner = parent.owner;
    this.row = row;
    const route =
      row &&
      market &&
      ready &&
      !parent.importingBackup &&
      !parent.importRecoveryRequired &&
      !parent.workspaceMigrationIncomplete
        ? {
            owner: parent.owner,
            row,
            market,
            timeframe: panelTimeframe(local.timeframe, row),
            rangeDays: local.rangeDays
          }
        : undefined;
    const reset = !sameRoute(this.route, route) || parent.owner !== state.owner;
    const preferences =
      reset ||
      this.shared?.locale !== parent.preferences.locale ||
      this.shared?.timeZone !== parent.preferences.timeZone ||
      this.shared?.watchlistSections !== parent.preferences.watchlistSections ||
      this.shared?.rightPanelTab !== parent.preferences.rightPanelTab ||
      this.shared?.rightPanelCollapsed !== parent.preferences.rightPanelCollapsed ||
      this.shared?.chartSettings.theme !== parent.preferences.chartSettings.theme ||
      state.preferences.instrumentUid !== (row?.uid ?? null) ||
      state.preferences.providerRef !== row?.providerRef
        ? this.combinedPreferences(parent.preferences, local, row)
        : state.preferences;
    this.shared = parent.preferences;
    const sameDocument =
      parent.owner === state.owner &&
      state.preferences.symbol === (row?.symbol ?? "") &&
      state.preferences.instrumentUid === (row?.uid ?? null);
    const resetAnnotations =
      !sameDocument || parent.importingBackup || parent.importRecoveryRequired;
    const preserveCandles =
      sameDocument &&
      state.preferences.timeframe === preferences.timeframe &&
      state.preferences.rangeDays === preferences.rangeDays &&
      !parent.importingBackup &&
      !parent.importRecoveryRequired;
    if (reset) {
      if (resetAnnotations) this.editing.reset();
      this.stop();
      this.route = route;
      this.historyFrom = undefined;
    }
    const patch = {
      owner: parent.owner,
      authenticated: parent.authenticated,
      ready: parent.ready,
      marketReady: ready,
      status: parent.status,
      profileTransition: !!parent.profileTransition,
      workspaceMigrationIncomplete: !!parent.workspaceMigrationIncomplete,
      importingBackup: !!parent.importingBackup,
      importRecoveryRequired: !!parent.importRecoveryRequired,
      backupBusy: !!parent.backupBusy,
      rows: knownRows(state.rows, parent.rows, row),
      preferences
    };
    if (reset)
      this.update({
        ...patch,
        chartRevision: state.chartRevision + 1,
        candles: preserveCandles ? state.candles : [],
        ...(resetAnnotations ? { annotationReady: false, drawings: [], images: [] } : {}),
        crosshairBar: null,
        selectedObject: null,
        contextMenu: null,
        activeTool: null,
        preview: null,
        dialog:
          state.dialog === "instruments" && importWritable(parent, state.owner)
            ? state.dialog
            : null,
        historyViewReady: true,
        loading: !!route,
        historyHelp: route ? "Загружаем историю…" : "Выберите инструмент"
      });
    else if (
      (Object.keys(patch) as (keyof typeof patch)[]).some((key) => patch[key] !== state[key])
    )
      this.update(patch);
    if ((!reset && this.retireFeed) || !route || !importWritable(parent)) return;
    const reconnect = (event: Event) => {
      const reference = route.row.providerRef;
      const detail = (event as CustomEvent<PublicMarketReconnect>).detail;
      if (
        !reference ||
        (detail?.provider === reference.provider && detail.category === reference.category)
      )
        void this.loadHistory(true);
    };
    const name = route.row.providerRef ? "market-reconnect" : "bank-reconnect";
    route.market.addEventListener(name, reconnect);
    this.disconnect = () => route.market.removeEventListener(name, reconnect);
    void this.loadHistory();
  }
  private current(route: PanelRoute): boolean {
    const parent = this.parent.getSnapshot();
    return (
      this.route === route &&
      !route.market.closed &&
      this.sessionKey() === route.market &&
      importWritable(parent, route.owner) &&
      parent.rows.some((row) => row.uid === route.row.uid && row.symbol === route.row.symbol)
    );
  }
  private canEdit(state: TerminalState): boolean {
    return !!this.route && this.current(this.route) && importWritable(state) && !state.backupBusy;
  }
  override setDialog: TerminalController["setDialog"] = (dialog, section) => {
    if (dialog === "account") this.parent.setDialog(dialog, section);
    else this.drawingSettings.setDialog(dialog, section);
  };

  override setPreferences: TerminalController["setPreferences"] = (patch, _force, valid) =>
    this.applyPanelPreferences(patch, valid);
  protected override applyChartSettings = (chartSettings: ChartSettings, changingType = false) =>
    this.applyPanelPreferences({ chartSettings }, undefined, changingType);
  private async applyPanelPreferences(
    patch: Partial<TerminalPreferences>,
    valid?: () => boolean,
    changingType = false
  ): Promise<void> {
    const state = this.getSnapshot();
    const local = this.local;
    if (!local || (valid && !valid()) || !importWritable(this.parent.getSnapshot(), state.owner))
      return;
    const { instrumentUid, symbol } = patch;
    if (
      instrumentUid &&
      symbol &&
      this.parent
        .getSnapshot()
        .rows.some((row) => row.uid === instrumentUid && row.symbol === symbol)
    ) {
      this.selectInstrument(instrumentUid);
      this.setDialog(null);
      return;
    }
    if (!this.canEdit(state)) return;
    const {
      indicators,
      technicalIndicators,
      technicalPaneLayout,
      indicatorPaneLayout,
      chartSettings,
      timeframe,
      rangeDays,
      engine,
      favoriteIntervals,
      locale,
      timeZone
    } = patch;
    if (timeframe) this.validateTimeframe(timeframe);
    if (
      rangeDays !== undefined &&
      (!Number.isFinite(rangeDays) || rangeDays < 1 || rangeDays > 3650)
    )
      throw new RangeError("Недопустимая глубина истории.");
    if (timeframe !== undefined || rangeDays !== undefined || engine !== undefined)
      void this.saveView().catch(() => {});
    this.local = {
      ...local,
      ...(indicators && { indicators }),
      ...(technicalIndicators && { technicalIndicators }),
      ...(technicalPaneLayout && { technicalPaneLayout }),
      ...(indicatorPaneLayout && { indicatorPaneLayout }),
      ...(chartSettings && {
        chartSettings: panelChartSettings(
          changingType ? chartSettings : retainNativeChartType(local.chartSettings, chartSettings)
        )
      }),
      ...(timeframe && { timeframe }),
      ...(rangeDays !== undefined && { rangeDays }),
      ...(engine && { engine }),
      ...(favoriteIntervals && { favoriteIntervals })
    };
    const parent = this.parent.getSnapshot();
    this.update({
      preferences: this.combinedPreferences(parent.preferences, this.local, this.row),
      ...(changingType && { crosshairBar: null })
    });
    savePanelPreferences(state.owner, this.slot, this.local);
    if (timeframe !== undefined || rangeDays !== undefined) this.configure(this.row, parent);
    const theme = chartSettings?.theme;
    const displayPatch: Partial<TerminalPreferences> = {
      ...(locale && locale !== parent.preferences.locale && { locale }),
      ...(timeZone && timeZone !== parent.preferences.timeZone && { timeZone }),
      ...(theme &&
        theme !== parent.preferences.chartSettings.theme && {
          chartSettings: withTheme(parent.preferences.chartSettings, theme)
        })
    };
    if (Object.keys(displayPatch).length) await this.parent.setPreferences(displayPatch);
  }

  private validateTimeframe(timeframe: TerminalPreferences["timeframe"]): void {
    nativeTimeframe(timeframe);
    const provider = this.row?.providerRef?.provider;
    if (provider === "bybit") nativeInterval(timeframe);
    if (provider === "okx") okxNativeInterval(timeframe);
  }

  override setTimeframe: TerminalController["setTimeframe"] = (timeframe) =>
    this.setPreferences({ timeframe });
  override searchInstruments: TerminalController["searchInstruments"] = (...args) =>
    this.parent.searchInstruments(...args);

  override addInstrument: TerminalController["addInstrument"] = async (instrument) => {
    const parent = this.parent.getSnapshot();
    const session = this.sessionKey();
    const route = this.route;
    const row = await this.parent.addToWatchlist(instrument);
    if (
      !row?.uid ||
      this.route !== route ||
      this.sessionKey() !== session ||
      !importWritable(this.parent.getSnapshot(), parent.owner) ||
      this.getSnapshot().dialog !== "instruments"
    )
      return;
    this.selectInstrument(row.uid);
    this.setDialog(null);
  };

  override toggleIndicator: TerminalController["toggleIndicator"] = (key) =>
    key === "mtpAll" && this.getSnapshot().preferences.indicators.mtpAll
      ? toggleCombinedMtpVisibility(this)
      : changeMenuIndicator(this, key);

  private async readAnnotations(route: PanelRoute): Promise<void> {
    if (this.getSnapshot().annotationReady !== false || this.annotationRequest === route) return;
    this.annotationRequest = route;
    try {
      const annotations = await readWorkspaceAnnotations(route.owner, route.row.symbol);
      if (this.current(route)) this.update({ ...annotations, annotationReady: true });
    } catch {
      if (this.current(route)) this.notify("Не удалось загрузить разметку.");
    } finally {
      if (this.annotationRequest === route) this.annotationRequest = undefined;
    }
  }

  override loadHistory: TerminalController["loadHistory"] = () => {
    const route = this.route;
    if (!route || !this.current(route)) return Promise.resolve();
    this.retireFeed?.();
    this.olderBusy = false;
    void this.readAnnotations(route);
    const now = route.market.serverNow();
    const range = workspaceHistoryRange(now, route.timeframe, route.rangeDays);
    const abort = new AbortController();
    this.historyAbort = abort;
    const active = () => !abort.signal.aborted && this.current(route);
    this.update({ loading: true, historyHelp: "Загружаем историю…" });
    return new Promise<void>((resolve) => {
      const apply = (candles: Candle[]) => this.update({ candles });
      const stop = startWorkspaceCandleFeed(
        {
          watchCandles: route.market.watchCandles.bind(route.market),
          loadCandles: (...args) => loadPanelCandles(route.market, ...args)
        },
        {
          uid: route.row.uid,
          symbol: route.row.symbol,
          timeframe: route.timeframe,
          range,
          initial: this.getSnapshot().candles,
          active,
          replace: apply,
          update: (bar) => apply(updateCandleList([...this.getSnapshot().candles], bar)),
          settle: (outcome, hasData) => {
            if (outcome !== "error")
              this.historyFrom = Math.min(this.historyFrom ?? range.from, range.from);
            this.update({
              loading: false,
              historyHelp: hasData
                ? ""
                : outcome === "error"
                  ? "Не удалось загрузить историю."
                  : "История недоступна"
            });
            resolve();
            if (outcome !== "error") void this.expandHistory(route, abort, true);
          }
        }
      );
      this.retireFeed = () => {
        abort.abort();
        stop();
        resolve();
      };
    });
  };

  private async expandHistory(
    route: PanelRoute,
    abort: AbortController,
    all: boolean
  ): Promise<void> {
    const from = this.historyFrom;
    if (this.olderBusy || from === undefined || !this.current(route)) return;
    let to = from;
    const now = route.market.serverNow();
    const recent = workspaceHistoryRange(now, route.timeframe, route.rangeDays);
    const minimum = historyRequestWindow(
      { from: Math.max(0, now - route.rangeDays * dayMs), to: now },
      route.timeframe
    ).from;
    const span = now - recent.from;
    if (span <= 0 || to <= minimum) return;
    this.olderBusy = true;
    const active = () => !abort.signal.aborted && this.current(route);
    let empty = 0;
    try {
      do {
        const range: HistoryRange = historyRequestWindow(
          { from: Math.max(minimum, to - span), to },
          route.timeframe
        );
        if (range.from >= to) break;
        const result = await loadPanelCandles(
          route.market,
          route.row.symbol,
          route.timeframe,
          range,
          {
            uid: route.row.uid,
            signal: abort.signal
          }
        );
        if (!active()) return;
        const earlier = result.candles.filter((bar) => bar.timestamp < to);
        to = range.from;
        this.historyFrom = to;
        empty = earlier.length ? 0 : empty + 1;
        if (earlier.length)
          this.update({ candles: mergeCandles(earlier, this.getSnapshot().candles) });
      } while (all && active() && to > minimum && empty < 2);
    } catch (error: unknown) {
      if (active() && !(error instanceof Error && error.name === "AbortError"))
        this.update({ historyHelp: "Не удалось догрузить историю." });
    } finally {
      if (this.historyAbort === abort) this.olderBusy = false;
    }
  }

  override scheduleOlderHistory: TerminalController["scheduleOlderHistory"] = () => {
    const route = this.route;
    const abort = this.historyAbort;
    if (route && abort && !this.getSnapshot().loading) void this.expandHistory(route, abort, false);
  };

  stop(): void {
    this.route = undefined;
    this.retireFeed?.();
    this.retireFeed = undefined;
    this.historyAbort = undefined;
    this.olderBusy = false;
    this.annotationRequest = undefined;
    this.disconnect?.();
    this.disconnect = undefined;
  }
}

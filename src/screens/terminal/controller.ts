import * as storage from "../../services/storage-v2.js";
import { setDisplayPreferences } from "../../i18n/preferences.js";
import type { MarketClient } from "../../services/market-client.js";
import type { BackupImportOptions } from "../../model/backup-import.js";
import type { BackupExportOptions } from "../../model/backup-export.js";
import type { WatchlistMove } from "../../services/watchlist-order.js";
import { marketCalendar } from "../../services/market-calendar.js";
import { toggleIndicatorFlags } from "../../model/indicator-flags.js";
import { toggleCombinedMtpVisibility } from "./indicator-menu-actions.js";
import { historyDepthTransition, saveControllerView } from "./controller-camera.js";
import {
  PreferenceRouting,
  preferenceRoutingScope,
  mergeRoutingPreferences
} from "./controller-preference-routing.js";
import type { TradingCalendarDay } from "../../model/candle-clock.js";
import { resolveWatchlist } from "../../model/market-model.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import {
  addWatchlistInstrument,
  removeWatchlistInstrument,
  reorderCanonicalWatchlist
} from "./controller-watchlist.js";
import type {
  Candle,
  ChartSettings,
  Drawing,
  DrawingTool,
  ImageAsset,
  IndicatorKey,
  InstrumentSearchKind,
  Timeframe
} from "../../model/types.js";
import type { ChartAdapter } from "../../charts/adapter.js";
import { TerminalHistory } from "./controller-history.js";
import { TerminalSession } from "./controller-session.js";
import { TerminalEditing } from "./controller-editing.js";
import { createDrawingPreview, drawingPreviewState } from "./drawing-settings-preview.js";
import { TerminalDrawingTools } from "./controller-drawing-tools.js";
import { TerminalPanel } from "./controller-panel.js";
import { TerminalBackups } from "./controller-backups.js";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { defaultPreferences, terminalHistoryLabel } from "./controller-bridge.js";
import { nativeTimeframe } from "../../model/intervals/native-timeframes.js";
import { importWritable } from "./controller-transfer-guard.js";
import { openLegacyIndicatorSettings } from "./indicator-preferences.js";
import { marketAvailable } from "./market-readiness.js";
import { nativeInterval } from "../../services/providers/bybit/market.js";
import { flushWorkspaceAnnotations } from "./workspace-annotations.js";
import type { ContextMenu, TerminalDialog, TerminalPreferences, TerminalState } from "./state.js";

export class TerminalController {
  private state: TerminalState = {
    chartRevision: 0,
    ready: false,
    owner: "guest",
    name: "",
    authenticated: false,
    marketReady: false,
    status: "offline",
    error: null,
    rows: resolveWatchlist([], [], []),
    pricesDirection: new Map(),
    preferences: defaultPreferences(),
    candles: [],
    drawings: [],
    images: [],
    loading: false,
    historyHelp: "Выберите криптовалюту или подключите Т‑Банк",
    activeTool: null,
    preview: null,
    selectedObject: null,
    dialog: null,
    contextMenu: null,
    objectPanel: false,
    toast: "",
    editingIndicator: "mtp160",
    crosshairBar: null
  };
  private readonly listeners = new Set<() => void>();
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  chart: ChartAdapter | null = null;
  private readonly history: TerminalHistory;
  private readonly session: TerminalSession;
  private readonly preferenceRouting = new PreferenceRouting();
  readonly editing: TerminalEditing;
  readonly drawingSettings: ReturnType<typeof createDrawingPreview>;
  readonly tools: TerminalDrawingTools;
  readonly panel: TerminalPanel;
  private readonly backups: TerminalBackups;
  constructor(
    readonly workspaceSlot?: number,
    shellPanel?: TerminalPanel
  ) {
    if (workspaceSlot === undefined) setDisplayPreferences(this.state.preferences);
    const bridge = {
      getState: () => this.state,
      getChart: () => this.chart,
      update: (patch: Partial<TerminalState>) => this.update(patch),
      notify: (message: string) => this.notify(message)
    };
    this.editing = new TerminalEditing(bridge);
    this.drawingSettings = createDrawingPreview(bridge, this.editing, () => !this.session.disposed);
    this.tools = new TerminalDrawingTools(this);
    this.panel = shellPanel ?? new TerminalPanel(this);
    this.history = new TerminalHistory({
      ...bridge,
      getClient: () => this.session.client,
      isAlive: () => !this.session.disposed
    });
    this.session = new TerminalSession({
      ...bridge,
      subscribe: this.subscribe,
      resetHistory: () => this.history.reset(),
      loadHistory: (refresh?: boolean) => this.history.load(refresh),
      isClearingHistory: () => this.history.clearing,
      mutateCandles: (candles: Candle[]) => {
        this.state = { ...this.state, candles };
      },
      flush: () => this.flush()
    });
    this.backups = new TerminalBackups({
      ...bridge,
      getClient: () => this.client,
      saveView: this.saveView,
      editing: this.editing,
      session: this.session,
      resetHistory: () => this.resetHistory(),
      loadHistory: this.loadHistory,
      flush: this.flush,
      isAlive: () => !this.session.disposed
    });
  }
  private get client(): MarketClient | null {
    return this.session.client;
  }
  getSnapshot = (): TerminalState => this.state;
  sessionKey = (): MarketClient | null => this.client;
  marketNow = (): number => this.client?.serverNow?.() ?? Date.now();
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  update = (patch: Partial<TerminalState>): void => {
    if (this.session.disposed) return;
    if (patch.historyViewReady === false && this.chart) this.chart.persistView = false;
    const ownerChanged = patch.owner !== undefined && patch.owner !== this.state.owner;
    if (patch.preferences)
      patch = { ...patch, objectPanel: patch.preferences.rightPanelTab === "objects" };
    if (ownerChanged || (patch.authenticated === false && this.state.authenticated))
      this.editing.reset();
    else if (
      patch.preferences &&
      (patch.preferences.symbol !== this.state.preferences.symbol ||
        patch.preferences.instrumentUid !== this.state.preferences.instrumentUid ||
        patch.preferences.timeframe !== this.state.preferences.timeframe)
    )
      this.editing.cancelGesture();
    if (ownerChanged)
      patch = {
        importingBackup: false,
        importRecoveryRequired: false,
        backupBusy: false,
        candles: [],
        historyViewReady: true,
        mobilePanelOpen: false,
        objectPanel: false,
        drawings: [],
        images: [],
        selectedObject: null,
        preview: null,
        activeTool: null,
        ...patch
      };
    this.state = drawingPreviewState({ ...this.state, ...patch });
    if (patch.preferences && this.workspaceSlot === undefined)
      setDisplayPreferences(patch.preferences);
    this.listeners.forEach((listener) => listener());
  };
  notify = (message: string): void => {
    if (this.session.disposed) return;
    this.update({ toast: message });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.update({ toast: "" }), 5000);
  };
  private async savePreferences(): Promise<void> {
    await storage.savePreferences(this.state.owner, this.state.preferences);
  }
  saveView = (): Promise<void> => saveControllerView(this);
  flush = async (options: BackupExportOptions = {}): Promise<void> => {
    const client = this.client;
    await this.editing.flush();
    await flushWorkspaceAnnotations(this.state.owner);
    if (options.captureView !== false) await this.saveView();
    await client?.flush();
    await storage.flush();
  };
  private resetHistory(): void {
    this.history.reset();
  }
  start = (): Promise<void> => this.session.start();
  dispose = (): void => {
    this.drawingSettings.cancel();
    this.editing.reset();
    this.session.dispose();
    if (this.toastTimer) clearTimeout(this.toastTimer);
  };
  login = async (token: string, name: string, remember: boolean): Promise<void> => {
    await this.editing.flush();
    await this.session.login(token, name, remember);
  };
  logout = (): Promise<void> => {
    return this.session.logout();
  };
  setDialog = (
    dialog: TerminalDialog,
    initialAccountSection?: TerminalState["initialAccountSection"]
  ): void => this.drawingSettings.setDialog(dialog, initialAccountSection);
  mergePublicProfile = (): Promise<void> => this.session.mergePublicProfile();
  setContext = (contextMenu: ContextMenu | null): void => this.update({ contextMenu });
  selectObject = (id: string | null): void => this.update({ selectedObject: id });
  focusObject = (id: string): void => {
    const drawing = this.state.drawings.find((item) => item.id === id);
    const image = this.state.images.find((item) => item.id === id);
    this.selectObject(id);
    const points = drawing?.points ?? (image ? [image.point] : []);
    if (points.length) this.chart?.focusPoints?.(points);
  };
  toggleObjects = (): void => {
    void this.panel
      .select("objects")
      .catch((error: unknown) =>
        this.notify(error instanceof Error ? error.message : "Не удалось изменить панель")
      );
  };
  setTool = (tool: DrawingTool | null): void => {
    if (!importWritable(this.state)) return;
    this.editing.cancelGesture();
    this.update({ activeTool: tool, preview: null, selectedObject: null, contextMenu: null });
  };
  setPreview = (preview: TerminalState["preview"]): void => this.update({ preview });
  undoDrawings = (): Promise<void> => {
    this.drawingSettings.cancel();
    if (this.state.activeTool && this.state.preview) {
      this.setTool(null);
      return Promise.resolve();
    }
    return this.editing.undo();
  };
  setPreferences = async (
    patch: Partial<TerminalPreferences>,
    forceReload = false,
    valid: () => boolean = () => true
  ): Promise<void> => {
    if (!importWritable(this.state)) return;
    const routing =
      forceReload ||
      ["symbol", "instrumentUid", "timeframe", "rangeDays", "engine"].some((key) => key in patch);
    if (routing) {
      const scope = preferenceRoutingScope(this, () => !this.session.disposed, valid);
      return this.preferenceRouting.enqueue(
        patch,
        forceReload,
        scope,
        this.applyRoutingPreferences
      );
    }
    const owner = this.state.owner,
      client = this.client;
    await this.saveView();
    await this.editing.flush();
    if (!this.session.matches(client) || !importWritable(this.state, owner) || !valid()) return;
    const next = { ...this.state.preferences, ...patch },
      selected = selectedMarketRow(this.state.rows, next);
    if (selected?.providerRef) next.providerRef = selected.providerRef;
    else delete next.providerRef;
    this.update({ preferences: next, crosshairBar: null });
    await this.savePreferences();
  };
  private applyRoutingPreferences = async (): Promise<void> => {
    for (;;) {
      const batch = this.preferenceRouting.batch((patch) => historyDepthTransition(this, patch));
      if (!batch) return;
      const depth = historyDepthTransition(this, batch.patch);
      const merge = () => mergeRoutingPreferences(this.state, batch.patch);
      try {
        await this.saveView();
        await this.editing.flush();
        if (!batch.current()) continue;
        if (!depth.valid()) {
          if (!batch.cancelDepth(this.state.preferences.rangeDays))
            throw new Error("Invalid depth without a depth intent");
          continue;
        }
        let next = merge();
        if (depth.active && !(await depth.carry(next, batch.current))) {
          if (!batch.current()) continue;
          if (!batch.cancelDepth(this.state.preferences.rangeDays))
            throw new Error("Failed depth without a depth intent");
          continue;
        }
        if (!batch.current()) continue;
        if (!depth.valid()) {
          if (!batch.cancelDepth(this.state.preferences.rangeDays))
            throw new Error("Invalid depth without a depth intent");
          continue;
        }
        next = merge();
        const previous = this.state.preferences,
          reload =
            batch.forceReload ||
            ["symbol", "instrumentUid", "timeframe", "rangeDays", "engine"].some(
              (key) =>
                next[key as keyof TerminalPreferences] !==
                previous[key as keyof TerminalPreferences]
            );
        batch.accept();
        const generation = reload ? this.preferenceRouting.commit() : 0;
        if (reload) this.resetHistory();
        this.update({
          preferences: next,
          crosshairBar: null,
          ...(reload
            ? {
                candles: [],
                loading: false,
                historyViewReady: false,
                drawings: [],
                images: [],
                selectedObject: null,
                activeTool: null,
                preview: null
              }
            : {})
        });
        if (!batch.ownersCurrent()) {
          batch.finish();
          return;
        }
        await this.savePreferences();
        const loading =
          reload &&
          this.preferenceRouting.isCommitted(generation) &&
          batch.ownersCurrent() &&
          marketAvailable(this.state)
            ? this.loadHistory()
            : undefined;
        batch.finish(loading);
        return;
      } catch (error) {
        batch.fail(error);
        return;
      } finally {
        depth.dispose();
      }
    }
  };
  setTimeframe = async (timeframe: Timeframe): Promise<void> => {
    nativeTimeframe(timeframe);
    if (selectedMarketRow(this.state.rows, this.state.preferences)?.providerRef)
      nativeInterval(timeframe);
    await this.setPreferences({ timeframe });
  };
  toggleIndicator = async (key: IndicatorKey): Promise<void> => {
    if (key === "mtpAll" && this.state.preferences.indicators.mtpAll)
      return toggleCombinedMtpVisibility(this);
    const owner = this.state.owner,
      client = this.client;
    await this.saveView();
    if (!this.session.matches(client) || !importWritable(this.state, owner)) return;
    const indicators = toggleIndicatorFlags(this.state.preferences.indicators, key);
    const chartSettings = {
      ...this.state.preferences.chartSettings,
      removedIndicators:
        this.state.preferences.chartSettings.removedIndicators?.filter(
          (item) => item !== key && !indicators[item]
        ) ?? []
    };
    if (!indicators.mtpAll) delete chartSettings.mtpAllHidden;
    this.update({ preferences: { ...this.state.preferences, indicators, chartSettings } });
    await this.savePreferences();
    if (!this.session.matches(client) || owner !== this.state.owner) return;
    if (key === "volume") this.scheduleOlderHistory(true);
    else await this.loadHistory(true);
  };
  setChartSettings = async (patch: ChartSettings): Promise<void> => {
    const owner = this.state.owner,
      client = this.client;
    await this.saveView();
    if (!this.session.matches(client) || !importWritable(this.state, owner)) return;
    this.update({
      preferences: {
        ...this.state.preferences,
        chartSettings: { ...this.state.preferences.chartSettings, ...patch }
      }
    });
    await this.savePreferences();
  };
  setDrawings = async (drawings: Drawing[]): Promise<void> => {
    await this.editing.change({ drawings });
  };
  updateDrawing = async (drawing: Drawing): Promise<void> =>
    this.setDrawings(this.state.drawings.map((item) => (item.id === drawing.id ? drawing : item)));
  addDrawing = async (drawing: Drawing): Promise<void> => {
    const owner = this.state.owner,
      activeTool = this.state.activeTool,
      symbol = this.state.preferences.symbol,
      uid = selectedMarketRow(this.state.rows, this.state.preferences)?.uid;
    await this.setDrawings([...this.state.drawings, drawing]);
    if (
      owner === this.state.owner &&
      activeTool === this.state.activeTool &&
      symbol === this.state.preferences.symbol &&
      uid === selectedMarketRow(this.state.rows, this.state.preferences)?.uid
    )
      this.update({
        selectedObject: drawing.id,
        activeTool: drawingToolbarSettings(this.state.preferences.chartSettings).stayInDrawingMode
          ? this.state.activeTool
          : null,
        preview: null
      });
  };
  loadHistory = (refresh = false): Promise<void> => this.history.load(refresh);
  loadCandleCalendar = async (
    uid: string,
    barTimestamp: number,
    timeframe: Timeframe,
    now: number,
    signal: AbortSignal
  ): Promise<TradingCalendarDay[]> => {
    const client = this.client,
      owner = this.state.owner;
    return marketCalendar(
      client,
      uid,
      barTimestamp,
      timeframe,
      now,
      signal,
      () => !this.session.disposed && owner === this.state.owner && this.session.matches(client)
    );
  };
  scheduleOlderHistory = (volumeAverage = false): void => this.history.scheduleOlder(volumeAverage);
  searchInstruments = async (query: string, kind: InstrumentSearchKind, signal: AbortSignal) =>
    this.client?.searchInstruments(query, kind, signal) ?? [];
  addToWatchlist = (instrument: Parameters<MarketClient["addInstrument"]>[0]) =>
    addWatchlistInstrument(this, this.session, instrument);
  addInstrument = async (
    instrument: Parameters<MarketClient["addInstrument"]>[0]
  ): Promise<void> => {
    const owner = this.state.owner;
    const row = await this.addToWatchlist(instrument);
    if (!row || !importWritable(this.state, owner)) return;
    this.update({ dialog: null });
    await this.setPreferences({ symbol: row.symbol, instrumentUid: row.uid });
  };
  removeInstrument = async (
    reference: Pick<TerminalState["rows"][number], "uid" | "symbol">
  ): Promise<void> => removeWatchlistInstrument(this, this.session, reference);
  reorderWatchlist = async (move: WatchlistMove, expectedOwner: string): Promise<boolean> =>
    reorderCanonicalWatchlist(this, this.session, move, expectedOwner);
  getStorageStats = async () => ({
    candles: await storage.historyStats(this.state.owner),
    browser: await storage.usage()
  });
  clearHistory = (uid: string | null, timeframe: Timeframe | null): Promise<void> =>
    this.history.clear(uid, timeframe);
  exportBackup: TerminalBackups["export"] = (...args) => this.backups.export(...args);
  importBackup = (input: unknown, options?: BackupImportOptions): Promise<void> =>
    this.backups.import(input, options);
  importBackupFile: TerminalBackups["importFile"] = (...args) => this.backups.importFile(...args);
  recoverBackup = (): Promise<void> => this.backups.recover();
  saveImage = async (asset: ImageAsset): Promise<void> => {
    if (asset.owner !== this.state.owner || asset.symbol !== this.state.preferences.symbol) return;
    const previous = this.state.images.some((image) => image.id === asset.id);
    await this.editing.change({
      images: previous
        ? this.state.images.map((image) => (image.id === asset.id ? asset : image))
        : [...this.state.images, asset]
    });
  };
  deleteImage = async (id: string): Promise<void> => {
    await this.tools.deleteObject(id);
  };
  attachImage = (file: File): Promise<void> => this.editing.attachImage(file);
  editIndicator = (key: IndicatorKey): void => openLegacyIndicatorSettings(this, key);
  setCrosshair = (crosshairBar: Candle | null): void => {
    if (this.state.crosshairBar?.timestamp !== crosshairBar?.timestamp)
      this.update({ crosshairBar });
  };
  historyLabel = (): string => terminalHistoryLabel(this.state);
}

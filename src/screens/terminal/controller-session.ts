import * as storage from "../../services/storage-v2.js";
import { displayPreferences } from "../../i18n/preferences.js";
import { MarketClient } from "../../services/market-client.js";
import type { MarketSnapshot } from "../../services/market-client.js";
import type { PublicMarketReconnect } from "../../services/market-public.js";
import { TIMEFRAMES, updateCandleList } from "../../model/history-codec.js";
import { migrateCandlePalette } from "../../model/candle-palette.js";
import { pinSelectedInstrument, selectedMarketRow } from "../../model/selected-instrument.js";
import { orderedWatchlistRows } from "../../model/watchlist-sections.js";
import type { Candle } from "../../model/types.js";
import { DEFAULT_CHART_SETTINGS, DEFAULT_INDICATORS } from "./state.js";
import type { TerminalPreferences } from "./state.js";
import { defaultPreferences, errorText } from "./controller-bridge.js";
import type { SessionBridge } from "./controller-bridge.js";
import { DEVICE_OWNER, prepareDeviceWorkspace } from "../../services/workspace-identity.js";
import type { DeviceWorkspaceBinding } from "../../services/workspace-identity.js";
import { shareMarketRows } from "./market-state-sharing.js";
const cancelled = () => new DOMException("Отключено", "AbortError");

export class TerminalSession {
  client: MarketClient | null = null;
  disposed = false;
  readonly cloudSession = {};
  workspaceBinding: DeviceWorkspaceBinding | undefined;
  private lifecycle = 0;
  private activation = 0;
  private transitionAbort: AbortController | undefined;
  private readonly transitionPauses = new WeakMap<MarketClient, boolean>();
  private liveFrame: number | null = null;
  private reconnectClient: MarketClient | null = null;
  private sessionWrites: Promise<void> = Promise.resolve();
  constructor(private readonly bridge: SessionBridge) {}
  private current(lifecycle: number, activation?: number, client?: MarketClient): boolean {
    return (
      !this.disposed &&
      lifecycle === this.lifecycle &&
      (activation === undefined || activation === this.activation) &&
      (client === undefined || client === this.client)
    );
  }
  matches(client: MarketClient | null): boolean {
    return !this.disposed && !this.bridge.getState().profileTransition && client === this.client;
  }
  async prepareProfile(
    owner: string,
    name: string,
    force = false,
    valid: () => boolean = () => !this.disposed
  ): Promise<void> {
    if (!valid() || (!force && this.bridge.getState().owner === owner)) return;
    const preferences = await this.readProfilePreferences(owner, name, valid);
    if (!valid()) return;
    this.bridge.resetHistory();
    this.bridge.update({ owner, name, preferences });
  }
  private async readProfilePreferences(
    owner: string,
    name: string,
    valid: () => boolean
  ): Promise<TerminalPreferences> {
    await storage.prepareProfileV2(owner, valid);
    if (owner !== DEVICE_OWNER) await storage.migrateLegacy(owner, name);
    if (!valid()) throw cancelled();
    const saved = await storage.loadPreferences(owner),
      defaults = defaultPreferences();
    if (!valid()) throw cancelled();
    return {
      ...defaults,
      ...saved,
      ...displayPreferences(saved),
      indicators: { ...DEFAULT_INDICATORS, ...saved.indicators },
      chartSettings: { ...DEFAULT_CHART_SETTINGS, ...migrateCandlePalette(saved.chartSettings) }
    };
  }
  async start(): Promise<void> {
    this.disposed = false;
    if (!this.client) this.bridge.update({ watchlistStartup: "loading" });
    const lifecycle = ++this.lifecycle;
    let activation = this.activation;
    window.addEventListener("online", this.onOnline);
    window.addEventListener("pagehide", this.onPageHide);
    try {
      const session = await storage.restoreSession();
      if (!this.current(lifecycle, activation)) return;
      activation++;
      await this.activate(null, "", lifecycle, session?.owner, Boolean(session));
      if (!this.current(lifecycle, activation)) return;
      this.bridge.update({ ready: true });
      if (!session || !this.current(lifecycle, activation)) return;
      activation++;
      try {
        await this.activate(session.token, session.name, lifecycle);
      } catch (error) {
        if (this.current(lifecycle, activation)) this.bridge.notify(errorText(error));
      }
    } catch (error) {
      if (this.current(lifecycle, activation)) this.failWatchlistStartup();
      else if (this.current(lifecycle)) return;
      throw error;
    }
  }
  private failWatchlistStartup(): void {
    if (this.bridge.getState().watchlistStartup === "loading")
      this.bridge.update({ watchlistStartup: "error" });
  }
  private onOnline = (): void => {
    const client = this.client,
      state = this.bridge.getState();
    if (
      !client ||
      this.disposed ||
      this.reconnectClient === client ||
      state.profileTransition ||
      state.importingBackup ||
      state.importRecoveryRequired
    )
      return;
    const lifecycle = this.lifecycle;
    this.reconnectClient = client;
    void client
      .start()
      .then((snapshot) => {
        if (
          this.matches(client) &&
          this.current(lifecycle, undefined, client) &&
          !this.bridge.getState().importingBackup &&
          !this.bridge.getState().importRecoveryRequired
        ) {
          this.applyBankState(snapshot);
          if (!this.bridge.getState().candles.length) return this.bridge.loadHistory();
        }
      })
      .catch((error: unknown) => {
        if (this.current(lifecycle, undefined, client)) this.bridge.notify(errorText(error));
      })
      .finally(() => {
        if (this.reconnectClient === client) this.reconnectClient = null;
      });
  };
  private onPageHide = (): void => {
    void this.bridge.flush().catch(() => undefined);
  };
  dispose(): void {
    this.disposed = true;
    this.lifecycle++;
    this.activation++;
    this.transitionAbort?.abort();
    this.bridge.resetHistory();
    this.cancelLiveFrame();
    const client = this.client;
    this.client = null;
    if (client) void client.close().catch(() => undefined);
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("pagehide", this.onPageHide);
  }
  private cancelLiveFrame(): void {
    if (this.liveFrame !== null) cancelAnimationFrame(this.liveFrame);
    this.liveFrame = null;
  }
  applyBankState(snapshot: MarketSnapshot, settleEmptyStartup = false): void {
    const state = this.bridge.getState(),
      { rows, pricesDirection } = shareMarketRows(state, snapshot.rows);
    this.bridge.update({
      rows,
      ...(state.watchlistStartup === "error" ||
      (state.watchlistStartup === "loading" && (rows.length > 0 || settleEmptyStartup))
        ? { watchlistStartup: "ready" }
        : {}),
      preferences: pinSelectedInstrument(rows, state.preferences),
      marketReady: snapshot.marketReady,
      authenticated: snapshot.authenticated,
      status: snapshot.status,
      error: snapshot.error ?? null,
      pricesDirection
    });
  }
  private attach(client: MarketClient, lifecycle: number): void {
    const valid = () => this.current(lifecycle, undefined, client);
    client.addEventListener("notice", (event) => {
      if (valid()) this.bridge.notify((event as CustomEvent<string>).detail);
    });
    client.addEventListener("state", (event) => {
      const current = this.bridge.getState();
      if (
        valid() &&
        !current.profileTransition &&
        !current.importingBackup &&
        !current.importRecoveryRequired
      )
        this.applyBankState((event as CustomEvent<MarketSnapshot>).detail);
    });
    client.addEventListener("market-reconnect", (event) => {
      const state = this.bridge.getState(),
        row = selectedMarketRow(state.rows, state.preferences),
        source = (event as CustomEvent<PublicMarketReconnect>).detail;
      if (
        valid() &&
        !state.profileTransition &&
        !state.importingBackup &&
        !state.importRecoveryRequired &&
        row?.providerRef?.provider === source.provider &&
        row.providerRef.category === source.category
      )
        void this.bridge.loadHistory(true).catch(() => undefined);
    });
    client.addEventListener("candle", (event) => {
      const state = this.bridge.getState();
      if (
        !valid() ||
        state.profileTransition ||
        state.importingBackup ||
        this.bridge.isClearingHistory() ||
        !state.candles.length
      )
        return;
      const detail = (event as CustomEvent<{ uid: string; interval: string; bar: Candle }>).detail,
        row = selectedMarketRow(state.rows, state.preferences);
      if (
        detail.uid !== row?.uid ||
        detail.interval !== TIMEFRAMES[state.preferences.timeframe].stream
      )
        return;
      this.bridge.mutateCandles(updateCandleList([...state.candles], detail.bar));
      if (this.liveFrame !== null) return;
      this.liveFrame = requestAnimationFrame(() => {
        this.liveFrame = null;
        if (valid()) this.bridge.update({ candles: this.bridge.getState().candles });
      });
    });
  }
  private async activate(
    token: string | null,
    name: string,
    lifecycle = this.lifecycle,
    owner?: string,
    deferEmptyWatchlist = false
  ): Promise<MarketClient> {
    this.transitionAbort?.abort();
    const transition = new AbortController();
    this.transitionAbort = transition;
    const activation = ++this.activation,
      previous = this.client,
      previousPaused = previous
        ? (this.transitionPauses.get(previous) ?? previous.cachePaused)
        : false;
    if (previous) this.transitionPauses.set(previous, previousPaused);
    let candidate: MarketClient | undefined;
    const attempt = () => this.current(lifecycle, activation) && !transition.signal.aborted;
    const cameraViews = this.bridge.captureCameraViews?.();
    this.bridge.update({ profileTransition: true });
    this.bridge.resetHistory();
    this.cancelLiveFrame();
    try {
      await cameraViews;
      await this.bridge.settleTransfers?.();
      await previous?.settleMutations?.();
      await this.bridge.flush();
      if (!attempt()) throw cancelled();
      if (previous) previous.cachePaused = true;
      const preferredOwner = previous ? this.bridge.getState().owner : owner;
      const binding = await prepareDeviceWorkspace({
        ...(preferredOwner === undefined ? {} : { preferredOwner }),
        valid: attempt,
        signal: transition.signal
      });
      if (!attempt()) throw cancelled();
      candidate = new MarketClient(token, name, storage, { owner: binding.owner });
      const target = binding.owner;
      await candidate.start();
      if (!attempt()) throw cancelled();
      const preferences =
        this.bridge.getState().owner === target
          ? this.bridge.getState().preferences
          : await this.readProfilePreferences(target, name, attempt);
      if (!attempt()) throw cancelled();
      await previous
        ?.close()
        .catch(() => this.bridge.notify("Не удалось завершить старое подключение котировок."));
      if (!attempt()) throw cancelled();
      this.bridge.resetHistory();
      this.cancelLiveFrame();
      this.client = candidate;
      this.workspaceBinding = binding;
      this.reconnectClient = null;
      this.attach(candidate, lifecycle);
      const valid = () => attempt() && this.current(lifecycle, activation, candidate);
      this.bridge.update({
        owner: target,
        preferences,
        name,
        loading: false,
        workspaceMigrationIncomplete: false,
        pendingPublicSource: null
      });
      if (!valid()) throw cancelled();
      this.applyBankState(candidate.snapshot(), !deferEmptyWatchlist);
      const state = this.bridge.getState();
      if (!selectedMarketRow(state.rows, state.preferences)) {
        const first = orderedWatchlistRows(state.rows, state.preferences.watchlistSections)[0];
        this.bridge.update({
          preferences: {
            ...state.preferences,
            symbol: first?.symbol ?? "",
            instrumentUid: first?.uid ?? null,
            providerRef: first?.providerRef
          }
        });
      }
      this.bridge.update({ profileTransition: false });
      await this.bridge.loadHistory(true);
      if (!valid()) throw cancelled();
      return candidate;
    } catch (error) {
      if (candidate && candidate !== this.client) {
        candidate.cachePaused = true;
        await candidate.close();
      }
      if (attempt() && !this.client)
        this.bridge.update({ workspaceMigrationIncomplete: true, ready: false });
      else if (attempt() && candidate === this.client)
        this.bridge.update({ importRecoveryRequired: true, historyViewReady: false });
      if (attempt()) this.failWatchlistStartup();
      throw error;
    } finally {
      if (attempt()) {
        if (previous && !previous.closed) previous.cachePaused = previousPaused;
        if (previous) this.transitionPauses.delete(previous);
        this.bridge.update({ profileTransition: false, loading: false });
      }
    }
  }
  async login(token: string, name: string, remember: boolean): Promise<void> {
    const clean = token.trim().replaceAll("\\_", "_");
    if (!/^t\.[A-Za-z0-9_-]{40,200}$/.test(clean))
      throw new Error("Введите корректный read-only токен.");
    // A committed migration is adopted before API validation can fail.
    if (this.bridge.getState().owner !== DEVICE_OWNER)
      await this.activate(null, "", this.lifecycle, this.bridge.getState().owner);
    const client = await this.activate(clean, name.trim());
    const operation = this.sessionWrites.then(async () => {
      if (!this.matches(client)) throw cancelled();
      await storage.saveSession({ token: clean, owner: client.owner, name: name.trim(), remember });
    });
    this.sessionWrites = operation.catch(() => undefined);
    await operation;
    if (this.matches(client)) this.bridge.update({ dialog: null, ready: true });
  }
  async logout(): Promise<void> {
    const client = this.client,
      lifecycle = this.lifecycle,
      activation = this.activation;
    await this.bridge.flush();
    await this.sessionWrites;
    if (!this.current(lifecycle, activation)) return;
    await storage.clearSession(client?.owner);
    if (!this.current(lifecycle, activation)) return;
    await this.activate(null, "", lifecycle);
  }
  async mergePublicProfile(): Promise<void> {
    const state = this.bridge.getState(),
      source = state.pendingPublicSource,
      client = this.client,
      owner = state.owner;
    if (!source || !client || state.profileTransition || state.importingBackup || state.backupBusy)
      return;
    const valid = () =>
      !this.disposed &&
      client === this.client &&
      this.bridge.getState().owner === owner &&
      !this.bridge.getState().importingBackup;
    this.bridge.update({ profileTransition: true });
    const previousPaused = client.cachePaused;
    try {
      await client.settleMutations?.();
      await this.bridge.flush();
      client.cachePaused = true;
      await storage.copyPublicProfile(source, owner, valid, true, this.transitionAbort?.signal);
      if (!valid()) return;
      const rows = await storage.loadWatchlist(owner);
      if (!valid()) return;
      if (rows) client.rows = rows;
      this.bridge.update({ pendingPublicSource: null });
      this.applyBankState(client.snapshot());
    } finally {
      client.cachePaused = previousPaused;
      if (valid()) this.bridge.update({ profileTransition: false });
    }
  }
}

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
import { publicGuestRecoveryCache } from "../../services/storage-guest-cache.js";
import { guestRecoveryText } from "../../i18n/messages-guest-recovery.js";
import { guestActivationFence } from "./controller-guest-activation.js";
const cancelled = () => new DOMException("Отключено", "AbortError");

export class TerminalSession {
  client: MarketClient | null = null;
  disposed = false;
  private lifecycle = 0;
  private activation = 0;
  private transitionAbort: AbortController | undefined;
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
    return !this.disposed && client === this.client;
  }
  async prepareProfile(
    owner: string,
    name: string,
    force = false,
    valid: () => boolean = () => !this.disposed
  ): Promise<void> {
    if (!valid() || (!force && this.bridge.getState().owner === owner)) return;
    await storage.prepareProfileV2(owner, valid);
    await storage.migrateLegacy(owner, name);
    if (!valid()) return;
    const saved = await storage.loadPreferences(owner),
      defaults = defaultPreferences();
    if (!valid()) return;
    const preferences: TerminalPreferences = {
      ...defaults,
      ...saved,
      ...displayPreferences(saved),
      indicators: { ...DEFAULT_INDICATORS, ...saved.indicators },
      chartSettings: { ...DEFAULT_CHART_SETTINGS, ...migrateCandlePalette(saved.chartSettings) }
    };
    this.bridge.resetHistory();
    this.bridge.update({ owner, name, preferences });
  }
  async start(): Promise<void> {
    this.disposed = false;
    const lifecycle = ++this.lifecycle,
      activation = this.activation;
    window.addEventListener("online", this.onOnline);
    window.addEventListener("pagehide", this.onPageHide);
    const session = await storage.restoreSession();
    if (!this.current(lifecycle, activation)) return;
    await this.activate(null, "", lifecycle, storage.PUBLIC_OWNER);
    if (!this.current(lifecycle)) return;
    this.bridge.update({ ready: true });
    if (session)
      try {
        await this.activate(session.token, session.name, lifecycle);
      } catch (error) {
        if (this.current(lifecycle)) this.bridge.notify(errorText(error));
      }
  }
  private onOnline = (): void => {
    const client = this.client;
    if (!client || this.disposed || this.reconnectClient === client) return;
    const lifecycle = this.lifecycle;
    this.reconnectClient = client;
    void client
      .start()
      .then((snapshot) => {
        if (this.current(lifecycle, undefined, client)) {
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
  applyBankState(snapshot: MarketSnapshot): void {
    const state = this.bridge.getState(),
      directions = new Map(state.pricesDirection),
      before = new Map(state.rows.map((row) => [row.symbol, row.price]));
    const rows = snapshot.rows.map((row) => {
      const previous = before.get(row.symbol);
      if (previous != null && row.price != null && previous !== row.price)
        directions.set(row.symbol, row.price > previous ? "positive" : "negative");
      return { ...row };
    });
    this.bridge.update({
      rows,
      preferences: pinSelectedInstrument(rows, state.preferences),
      marketReady: snapshot.marketReady,
      authenticated: snapshot.authenticated,
      status: snapshot.status,
      error: snapshot.error ?? null,
      pricesDirection: directions
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
    owner?: string
  ): Promise<MarketClient> {
    this.transitionAbort?.abort();
    const transition = new AbortController();
    this.transitionAbort = transition;
    const activation = ++this.activation,
      previous = this.client,
      sourceOwner = storage.PUBLIC_OWNER,
      previousPaused = previous?.cachePaused ?? false;
    let guestRecoveryFailed = false,
      guestRecoveryQuota = false;
    const cache =
      token === null ? publicGuestRecoveryCache(storage, () => guestRecoveryQuota) : storage;
    const candidate = new MarketClient(token, name, cache, owner ? { owner } : {});
    const recoveryFence = guestActivationFence(
      this.bridge,
      () => candidate.owner,
      () => this.current(lifecycle, activation),
      transition,
      token === null
    );
    const attempt = recoveryFence.valid;
    this.bridge.update({ profileTransition: true });
    try {
      await previous?.settleMutations?.();
      await this.bridge.flush();
      if (!attempt()) throw cancelled();
      if (previous) previous.cachePaused = true;
      const target = await candidate.prepareOwner();
      if (!attempt()) throw cancelled();
      await storage.prepareProfileV2(target, attempt, transition.signal);
      if (token === null && target === storage.PUBLIC_OWNER && recoveryFence.canAdopt) {
        const recovery = await storage.adoptLegacyGuestWorkspace(attempt, transition.signal);
        guestRecoveryQuota = recovery === "quota-failed";
        guestRecoveryFailed =
          guestRecoveryQuota || recovery === "failed" || recovery === "source-invalid";
      }
      const transfer = await storage.copyPublicProfile(
        sourceOwner,
        target,
        attempt,
        false,
        transition.signal
      );
      if (!attempt()) throw cancelled();
      await candidate.start();
      if (!attempt()) throw cancelled();
      await previous?.close();
      if (!attempt()) throw cancelled();
      recoveryFence.beforeProfileCommit();
      this.bridge.resetHistory();
      this.cancelLiveFrame();
      this.client = candidate;
      this.reconnectClient = null;
      this.attach(candidate, lifecycle);
      const valid = () => attempt() && this.current(lifecycle, activation, candidate);
      await this.prepareProfile(target, name, false, valid);
      if (!valid()) throw cancelled();
      this.bridge.update({
        name,
        profileTransition: false,
        pendingPublicSource: transfer.conflict ? sourceOwner : null
      });
      this.applyBankState(candidate.snapshot());
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
      recoveryFence.afterProfileCommit();
      await this.bridge.loadHistory();
      if (!valid()) throw cancelled();
      if (
        guestRecoveryFailed &&
        recoveryFence.warningAllowed() &&
        target === storage.PUBLIC_OWNER &&
        !this.bridge.getState().importingBackup
      )
        this.bridge.notify(guestRecoveryText("autoFailed"));
      return candidate;
    } catch (error) {
      if (candidate !== this.client) {
        if (
          token === null &&
          (transition.signal.aborted ||
            ((error instanceof DOMException || error instanceof Error) &&
              error.name === "AbortError"))
        )
          candidate.cachePaused = true;
        await candidate.close();
      }
      throw error;
    } finally {
      recoveryFence.dispose();
      if (previous && !previous.closed) previous.cachePaused = previousPaused;
      if (attempt()) this.bridge.update({ profileTransition: false });
    }
  }
  async login(token: string, name: string, remember: boolean): Promise<void> {
    const clean = token.trim().replaceAll("\\_", "_");
    if (!/^t\.[A-Za-z0-9_-]{40,200}$/.test(clean))
      throw new Error("Введите корректный read-only токен.");
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
    this.bridge.update({ authenticated: false, profileTransition: true });
    const client = this.client,
      lifecycle = this.lifecycle,
      activation = this.activation;
    await this.bridge.flush();
    await this.sessionWrites;
    if (!this.current(lifecycle, activation)) return;
    await storage.clearSession(client?.owner);
    if (!this.current(lifecycle, activation)) return;
    await this.activate(null, "", lifecycle, storage.PUBLIC_OWNER);
  }
  async mergePublicProfile(): Promise<void> {
    const state = this.bridge.getState(),
      source = state.pendingPublicSource,
      client = this.client,
      owner = state.owner;
    if (!source || !client || state.profileTransition || state.importingBackup || state.backupBusy)
      return;
    const valid = () =>
      this.matches(client) &&
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

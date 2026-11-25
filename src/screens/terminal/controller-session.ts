import * as storage from "../../services/storage.js";
import { displayPreferences } from "../../i18n/preferences.js";
import { TBankClient } from "../../services/tbank-client.js";
import { TIMEFRAMES, updateCandleList } from "../../model/history-codec.js";
import { migrateCandlePalette } from "../../model/candle-palette.js";
import { pinSelectedInstrument, selectedMarketRow } from "../../model/selected-instrument.js";
import type { Candle } from "../../model/types.js";
import { DEFAULT_CHART_SETTINGS, DEFAULT_INDICATORS } from "./state.js";
import type { TerminalPreferences } from "./state.js";
import { defaultPreferences, errorText } from "./controller-bridge.js";
import type { SessionBridge } from "./controller-bridge.js";

type BankSnapshot = ReturnType<TBankClient["snapshot"]>;
const cancelled = (): DOMException => new DOMException("Отключено", "AbortError");

export class TerminalSession {
  client: TBankClient | null = null;
  disposed = false;
  private lifecycle = 0;
  private activation = 0;
  private liveFrame: number | null = null;
  private reconnectClient: TBankClient | null = null;
  private sessionWrites: Promise<void> = Promise.resolve();
  constructor(private readonly bridge: SessionBridge) {}
  private current(lifecycle: number, activation?: number, client?: TBankClient): boolean {
    return (
      !this.disposed &&
      lifecycle === this.lifecycle &&
      (activation === undefined || activation === this.activation) &&
      (client === undefined || client === this.client)
    );
  }
  matches(client: TBankClient | null): boolean {
    return !this.disposed && client === this.client;
  }
  async prepareProfile(
    owner: string,
    name: string,
    force = false,
    valid: () => boolean = () => !this.disposed
  ): Promise<void> {
    if (!valid() || (!force && this.bridge.getState().owner === owner)) return;
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
      initialActivation = this.activation;
    const bootstrapCurrent = () => this.current(lifecycle, initialActivation);
    window.addEventListener("online", this.onOnline);
    window.addEventListener("pagehide", this.onPageHide);
    this.bridge.update({ loading: false });
    await storage.migrateLegacy("guest", "");
    if (!bootstrapCurrent()) return;
    const previous = await storage.lastProfile();
    if (!bootstrapCurrent()) return;
    if (previous) await this.prepareProfile(previous.owner, previous.name, false, bootstrapCurrent);
    else await this.prepareProfile("guest", "", true, bootstrapCurrent);
    if (!bootstrapCurrent()) return;
    const session = await storage.restoreSession();
    if (!bootstrapCurrent()) return;
    this.bridge.update({ ready: true });
    if (session) {
      const activation = this.activation + 1;
      try {
        await this.activate(session.token, session.name, lifecycle);
      } catch (error) {
        if (!this.current(lifecycle, activation)) return;
        const client = this.client,
          cached = await storage.loadMarket(session.owner);
        if (!this.current(lifecycle, activation)) return;
        if (cached !== undefined && client) {
          await this.prepareProfile(session.owner, session.name, false, () =>
            this.current(lifecycle, activation, client)
          );
          if (!this.current(lifecycle, activation, client)) return;
          client.owner = session.owner;
          client.rows = cached.rows;
          client.authenticated = true;
          this.bridge.update({
            rows: cached.rows,
            preferences: pinSelectedInstrument(cached.rows, this.bridge.getState().preferences),
            authenticated: true,
            status: "offline",
            error: null
          });
          await this.bridge.loadHistory();
        } else this.bridge.notify(errorText(error));
      }
    }
    if (!this.current(lifecycle)) return;
  }
  private onOnline = (): void => {
    const client = this.client;
    if (
      !client ||
      this.disposed ||
      this.bridge.getState().status === "connected" ||
      this.reconnectClient === client
    )
      return;
    const lifecycle = this.lifecycle,
      activation = this.activation;
    this.reconnectClient = client;
    void (async () => {
      try {
        const snapshot = await client.start();
        if (!this.current(lifecycle, activation, client)) return;
        await this.prepareProfile(client.owner, client.name, false, () =>
          this.current(lifecycle, activation, client)
        );
        if (!this.current(lifecycle, activation, client)) return;
        this.applyBankState(snapshot);
        if (!this.bridge.getState().candles.length) await this.bridge.loadHistory();
      } catch (error) {
        if (this.current(lifecycle, activation, client)) this.bridge.notify(errorText(error));
      } finally {
        if (this.reconnectClient === client) this.reconnectClient = null;
      }
    })();
  };
  private onPageHide = (): void => {
    void this.bridge.flush().catch(() => undefined);
  };
  dispose(): void {
    this.disposed = true;
    this.lifecycle++;
    this.activation++;
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
  applyBankState(snapshot: BankSnapshot): void {
    const state = this.bridge.getState(),
      directions = new Map(state.pricesDirection);
    const before = new Map(state.rows.map((row) => [row.symbol, row.price]));
    const rows = snapshot.rows.map((row) => {
      const previous = before.get(row.symbol);
      if (previous != null && row.price != null && previous !== row.price)
        directions.set(row.symbol, row.price > previous ? "positive" : "negative");
      return { ...row };
    });
    this.bridge.update({
      rows,
      preferences: pinSelectedInstrument(rows, state.preferences),
      authenticated: snapshot.authenticated,
      status: snapshot.status,
      error: snapshot.error ?? null,
      pricesDirection: directions
    });
  }
  private async activate(
    token: string,
    name: string,
    lifecycle = this.lifecycle
  ): Promise<TBankClient> {
    const activation = ++this.activation,
      previous = this.client;
    this.client = null;
    this.reconnectClient = null;
    this.bridge.resetHistory();
    this.cancelLiveFrame();
    this.bridge.update({ loading: false });
    await previous?.close();
    if (!this.current(lifecycle, activation)) throw cancelled();
    const client = new TBankClient(token, name, storage);
    this.client = client;
    const valid = () => this.current(lifecycle, activation, client);
    client.addEventListener("notice", (event) => {
      if (valid()) this.bridge.notify((event as CustomEvent<string>).detail);
    });
    client.addEventListener("state", (event) => {
      if (valid()) this.applyBankState((event as CustomEvent<BankSnapshot>).detail);
    });
    client.addEventListener("candle", (event) => {
      const state = this.bridge.getState();
      if (!valid() || this.bridge.isClearingHistory() || !state.candles.length) return;
      const detail = (event as CustomEvent<{ uid: string; interval: string; bar: Candle }>).detail;
      const row = selectedMarketRow(state.rows, state.preferences);
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
    const snapshot = await client.start();
    if (!valid()) throw cancelled();
    await this.prepareProfile(client.owner, name, false, valid);
    if (!valid()) throw cancelled();
    this.bridge.update({ name });
    this.applyBankState(snapshot);
    const state = this.bridge.getState();
    if (
      state.preferences.instrumentUid === undefined &&
      !selectedMarketRow(state.rows, state.preferences) &&
      state.rows[0]
    )
      this.bridge.update({
        preferences: {
          ...state.preferences,
          symbol: state.rows[0].symbol,
          instrumentUid: state.rows[0].uid
        }
      });
    await this.bridge.loadHistory();
    if (!valid()) throw cancelled();
    return client;
  }
  async login(token: string, name: string, remember: boolean): Promise<void> {
    const clean = token.trim().replaceAll("\\_", "_");
    if (!/^t\.[A-Za-z0-9_-]{40,200}$/.test(clean))
      throw new Error("Введите корректный read-only токен.");
    this.bridge.resetHistory();
    this.bridge.update({
      loading: false,
      candles: [],
      drawings: [],
      images: [],
      selectedObject: null
    });
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
    if (!this.current(lifecycle, activation)) return;
    await client?.close();
    await this.sessionWrites;
    if (!this.current(lifecycle, activation)) return;
    await storage.clearSession();
    if (this.current(lifecycle, activation)) location.reload();
  }
}

import type { Candle, Timeframe } from "../model/types.js";
import { TIMEFRAMES, mergeCandles } from "../model/history-codec.js";
import { nativeTimeframe } from "../model/intervals/native-timeframes.js";
import { assertBankRequest } from "./market-bank-cache.js";
import { CandleLeases } from "./candle-leases.js";
import type { Cache, Subscription } from "./types.js";

export class BankCandleStream {
  private readonly leases = new CandleLeases<Subscription>((added, removed) => {
    this.sendSubscriptions("SUBSCRIPTION_ACTION_UNSUBSCRIBE", removed);
    this.sendSubscriptions("SUBSCRIPTION_ACTION_SUBSCRIBE", added);
  });
  private live = new Map<string, Subscription & { bars: Candle[] }>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly send: (body: object) => void,
    private readonly save: Cache["saveHistory"],
    private readonly owner: () => string,
    private readonly flushClient: () => Promise<void>,
    private readonly notify: () => void
  ) {}

  private sendSubscriptions(action: string, subscriptions: readonly Subscription[]): void {
    if (!subscriptions.length) return;
    this.send({
      subscribeCandlesRequest: {
        subscriptionAction: action,
        instruments: subscriptions.map(({ uid, timeframe }) => ({
          instrumentId: uid,
          interval: TIMEFRAMES[timeframe].stream
        })),
        waitingClose: false
      }
    });
  }

  open(): void {
    this.sendSubscriptions("SUBSCRIPTION_ACTION_SUBSCRIBE", this.leases.values);
  }

  select(uid: string, timeframe: Timeframe): void {
    assertBankRequest({ uid });
    this.leases.select({ uid, timeframe: nativeTimeframe(timeframe) });
  }

  clearPrimary(): void {
    this.leases.select(null);
  }

  retain(uid: string, timeframe: Timeframe): () => void {
    assertBankRequest({ uid });
    return this.leases.retain({ uid, timeframe: nativeTimeframe(timeframe) });
  }

  remove(uid: string): void {
    this.leases.remove(uid);
  }

  keepRows(ids: ReadonlySet<string>): void {
    for (const { uid } of this.leases.values) if (!ids.has(uid)) this.remove(uid);
  }

  receive(uid: string, interval: string, bar: Candle): boolean {
    const sub = this.leases.values.find(
      (record) => record.uid === uid && TIMEFRAMES[record.timeframe].stream === interval
    );
    if (!sub) return false;
    const key = `${sub.uid}:${sub.timeframe}`,
      previous = this.live.get(key) ?? { ...sub, bars: [] };
    previous.bars = mergeCandles(previous.bars, [bar]);
    this.live.set(key, previous);
    this.timer ??= setTimeout(() => {
      void this.flushClient().catch(this.notify);
    }, 1500);
    return true;
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const blocks = [...this.live.values()];
    this.live.clear();
    await Promise.all(
      blocks.map((block) => this.save(this.owner(), block.uid, block.timeframe, block.bars))
    );
  }
}

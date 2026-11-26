import { shiftUtcMonths } from "../../model/intervals/calendar.js";
import { instrumentInfo, record } from "../../model/instrument-details/data.js";
import { DAY } from "../../model/instrument-details/history.js";
import { isReservedProviderId } from "../../model/market-provider.js";
import type {
  PriceTargetForecast,
  PriceTargetReferenceClose
} from "../../model/technical-indicators/ta-batch-external.js";
import type { DetailsClient } from "./repository.js";

const PAGE_LIMIT = 100;
const MAX_PAGES = 32;
const INT32_MAX = 2_147_483_647;

export interface TbankConsensusForecast {
  readonly uid: string;
  readonly assetUid: string;
  readonly currency: string;
  readonly recordCreatedTimestamp: number;
  readonly forecastTimestamp: number;
  readonly low: number;
  readonly target: number;
  readonly high: number;
  readonly analystCount: number | null;
}

export interface TbankPriceTarget {
  readonly forecast: PriceTargetForecast;
  readonly referenceClose: PriceTargetReferenceClose;
}

const validUid = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value);
const currencyCode = (value: unknown): string | null =>
  typeof value === "string" && /^[A-Za-z]{3}$/.test(value) ? value.toUpperCase() : null;
const int32 = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= INT32_MAX
    ? value
    : null;

function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime());
}

function utcTimestamp(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T[0-2]\d:[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/.test(value)
  )
    return null;
  const time = Date.parse(value);
  return validTime(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19)
    ? time
    : null;
}

function positiveQuote(input: unknown): number | null {
  const raw = record(input);
  if (!raw || (raw.units === undefined && raw.nano === undefined)) return null;
  const units =
    typeof raw.units === "string" && /^\d+$/.test(raw.units)
      ? Number(raw.units)
      : raw.units === undefined
        ? 0
        : raw.units;
  const nano = int32(raw.nano === undefined ? 0 : raw.nano);
  if (
    typeof units !== "number" ||
    !Number.isSafeInteger(units) ||
    units < 0 ||
    nano === null ||
    nano >= 1_000_000_000
  )
    return null;
  const value = units + nano / 1_000_000_000;
  return value > 0 ? value : null;
}

export function normalizeTbankConsensusForecast(input: unknown): TbankConsensusForecast | null {
  const raw = record(input);
  if (!raw || !validUid(raw.uid) || !validUid(raw.assetUid)) return null;
  const currency = currencyCode(raw.currency),
    recordCreatedTimestamp = utcTimestamp(raw.createdAt),
    forecastTimestamp = utcTimestamp(raw.prognosisDate),
    low = positiveQuote(raw.bestTargetLow),
    target = positiveQuote(raw.bestTargetPrice),
    high = positiveQuote(raw.bestTargetHigh);
  if (
    !currency ||
    recordCreatedTimestamp === null ||
    forecastTimestamp === null ||
    low === null ||
    target === null ||
    high === null ||
    low > target ||
    target > high
  )
    return null;
  const buy = int32(raw.totalBuyRecommend),
    hold = int32(raw.totalHoldRecommend),
    sell = int32(raw.totalSellRecommend);
  const total = buy === null || hold === null || sell === null ? 0 : buy + hold + sell;
  return {
    uid: raw.uid,
    assetUid: raw.assetUid,
    currency,
    recordCreatedTimestamp,
    forecastTimestamp,
    low,
    target,
    high,
    analystCount: total > 0 ? total : null
  };
}

function session(client: DetailsClient, signal: AbortSignal) {
  const owner = client.owner;
  const assertActive = () => {
    signal.throwIfAborted();
    if (!client.authenticated || client.closed || !owner || client.owner !== owner)
      throw new DOMException("Inactive T-Bank session", "AbortError");
  };
  const request = async (
    service: "InstrumentsService" | "MarketDataService",
    method: string,
    body: object
  ) => {
    assertActive();
    const response = await client.request(service, method, body, signal);
    assertActive();
    return response;
  };
  return { assertActive, request };
}

export async function loadTbankConsensusForecasts(
  client: DetailsClient,
  signal: AbortSignal
): Promise<readonly TbankConsensusForecast[]> {
  const { request } = session(client, signal);
  const forecasts: TbankConsensusForecast[] = [];
  const seen = new Set<string>();
  let expected: { limit: number; total: number } | undefined;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
    const response = await request("InstrumentsService", "GetConsensusForecasts", {
      paging: { limit: PAGE_LIMIT, pageNumber }
    });
    const page = record(response.page);
    const rows = response.items ?? [];
    if (!page || !Array.isArray(rows) || int32(page.pageNumber ?? 0) !== pageNumber)
      throw new Error("CONSENSUS_FORECAST_PAGE");
    const limit = int32(page.limit ?? 0),
      total = int32(page.totalCount ?? 0),
      offset = limit === null ? 0 : pageNumber * limit;
    if (
      limit === null ||
      limit > PAGE_LIMIT ||
      total === null ||
      (limit === 0 && total > 0) ||
      (expected && (limit !== expected.limit || total !== expected.total)) ||
      rows.length !== Math.min(limit, Math.max(0, total - offset))
    )
      throw new Error("CONSENSUS_FORECAST_COVERAGE");
    if (total > limit * MAX_PAGES) throw new Error("CONSENSUS_FORECAST_COVERAGE");
    expected ??= { limit, total };
    for (const entry of rows as unknown[]) {
      const raw = record(entry);
      if (!raw || !validUid(raw.uid) || !validUid(raw.assetUid) || seen.has(raw.uid))
        throw new Error("CONSENSUS_FORECAST_COVERAGE");
      seen.add(raw.uid);
      const forecast = normalizeTbankConsensusForecast(raw);
      if (forecast) forecasts.push(forecast);
    }
    if (seen.size === total) return forecasts;
  }
  throw new Error("CONSENSUS_FORECAST_COVERAGE");
}

function referenceClose(
  response: Record<string, unknown>,
  instrumentKey: string,
  currency: string,
  day: number
): PriceTargetReferenceClose | null {
  if (response.priceCurrency !== undefined && currencyCode(response.priceCurrency) !== currency)
    return null;
  if (!Array.isArray(response.candles)) return null;
  let reference: PriceTargetReferenceClose | null = null;
  for (const entry of response.candles as unknown[]) {
    const candle = record(entry);
    if (candle?.isComplete !== true) continue;
    const timestamp = utcTimestamp(candle.time),
      close = positiveQuote(candle.close);
    if (timestamp === null || timestamp < day || timestamp >= day + DAY || close === null) continue;
    if (reference && (reference.timestamp !== timestamp || reference.close !== close)) return null;
    reference = { instrumentKey, currency, timestamp, close };
  }
  return reference;
}

/** Reads bank analyst consensus and a confirmed historical close without selecting a chart stream. */
export async function loadTbankPriceTarget(
  client: DetailsClient,
  instrumentUid: string,
  asOf: number,
  signal: AbortSignal
): Promise<TbankPriceTarget | null> {
  const { request, assertActive } = session(client, signal);
  assertActive();
  if (!validUid(instrumentUid) || isReservedProviderId(instrumentUid) || !validTime(asOf))
    return null;
  const info = instrumentInfo(
    await request("InstrumentsService", "GetInstrumentBy", {
      idType: "INSTRUMENT_ID_TYPE_UID",
      id: instrumentUid
    }),
    instrumentUid
  );
  const currency = currencyCode(info.currency);
  if (info.kind !== "share" || !validUid(info.assetUid) || !currency) return null;
  const forecasts = await loadTbankConsensusForecasts(client, signal);
  assertActive();
  const ordered = forecasts
    .filter(
      (entry) =>
        entry.assetUid === info.assetUid &&
        entry.currency === currency &&
        entry.forecastTimestamp <= asOf &&
        entry.recordCreatedTimestamp <= asOf
    )
    .sort(
      (left, right) =>
        right.forecastTimestamp - left.forecastTimestamp ||
        right.recordCreatedTimestamp - left.recordCreatedTimestamp
    );
  const latest = ordered[0];
  if (!latest) return null;
  const ambiguous = ordered.some(
    (entry) =>
      entry.forecastTimestamp === latest.forecastTimestamp &&
      entry.recordCreatedTimestamp === latest.recordCreatedTimestamp &&
      (entry.low !== latest.low ||
        entry.target !== latest.target ||
        entry.high !== latest.high ||
        entry.analystCount !== latest.analystCount)
  );
  if (ambiguous) return null;
  const publicationTimestamp = Math.max(latest.forecastTimestamp, latest.recordCreatedTimestamp);
  const horizonTimestamp = shiftUtcMonths(latest.forecastTimestamp, 12);
  const day = Math.floor(latest.forecastTimestamp / DAY) * DAY;
  // A daily candle gives no actual close time, so historical as-of queries must wait for the next UTC day.
  if (!validTime(horizonTimestamp) || horizonTimestamp <= asOf || day + DAY > asOf) return null;
  const close = referenceClose(
    await request("MarketDataService", "GetCandles", {
      instrumentId: instrumentUid,
      interval: "CANDLE_INTERVAL_DAY",
      from: new Date(day).toISOString(),
      to: new Date(day + DAY).toISOString(),
      candleSourceType: "CANDLE_SOURCE_EXCHANGE"
    }),
    instrumentUid,
    currency,
    day
  );
  return close
    ? {
        forecast: {
          instrumentKey: instrumentUid,
          currency,
          publicationTimestamp,
          horizonTimestamp,
          low: latest.low,
          mean: latest.target,
          high: latest.high,
          analystCount: latest.analystCount
        },
        referenceClose: close
      }
    : null;
}

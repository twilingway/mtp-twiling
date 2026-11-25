export type Raw = Record<string, unknown>;
export function record(value: unknown): Raw | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : null;
}
export function items(value: unknown): Raw[] {
  return Array.isArray(value)
    ? value.flatMap((item: unknown) => {
        const raw = record(item);
        return raw ? [raw] : [];
      })
    : [];
}
export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
export function numeric(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
export function quote(value: unknown): number | null {
  const raw = record(value);
  if (!raw) return null;
  const units = numeric(raw.units),
    nano = raw.nano === undefined ? 0 : numeric(raw.nano);
  return units === null || nano === null || Math.abs(nano) >= 1e9 ? null : units + nano / 1e9;
}
export function date(value: unknown): string | null {
  const result = text(value);
  return result && Number.isFinite(Date.parse(result)) ? result : null;
}
export interface InstrumentInfo {
  uid: string;
  assetUid: string | null;
  kind: string | null;
  currency: string | null;
  isin: string | null;
  exchange: string | null;
  country: string | null;
  lot: number | null;
}
export function instrumentInfo(value: unknown, expectedUid: string): InstrumentInfo {
  const raw = record(record(value)?.instrument);
  if (!raw || raw.uid !== expectedUid) throw new Error("INSTRUMENT_RESPONSE");
  return {
    uid: expectedUid,
    assetUid: text(raw.assetUid),
    kind: text(raw.instrumentType),
    currency: text(raw.currency),
    isin: text(raw.isin),
    exchange: text(raw.exchange),
    country: text(raw.countryOfRisk),
    lot: (numeric(raw.lot) ?? 0) > 0 ? numeric(raw.lot) : null
  };
}
export const METRICS = [
  ["marketCapitalization", "Капитализация", "Market cap", "money"],
  ["revenueTtm", "Выручка · TTM", "Revenue · TTM", "money"],
  ["ebitdaTtm", "EBITDA · TTM", "EBITDA · TTM", "money"],
  ["netIncomeTtm", "Чистая прибыль · TTM", "Net income · TTM", "money"],
  ["freeCashFlowTtm", "Свободный денежный поток · TTM", "Free cash flow · TTM", "money"],
  ["epsTtm", "EPS · TTM / акция", "EPS · TTM / share", "money"],
  ["peRatioTtm", "P/E · TTM", "P/E · TTM", "ratio"],
  ["priceToBookTtm", "P/B · TTM", "P/B · TTM", "ratio"],
  ["evToEbitdaMrq", "EV/EBITDA · MRQ", "EV/EBITDA · MRQ", "ratio"],
  ["totalDebtMrq", "Общий долг · MRQ", "Total debt · MRQ", "money"],
  ["netDebtToEbitda", "Чистый долг / EBITDA", "Net debt / EBITDA", "ratio"],
  ["forwardAnnualDividendYield", "Форвардная дивдоходность", "Forward dividend yield", "percent"],
  ["sharesOutstanding", "Акций в обращении", "Shares outstanding", "count"]
] as const;
export interface Fundamentals {
  currency: string | null;
  start: string | null;
  end: string | null;
  values: (number | null)[];
}
export function fundamentals(value: unknown, assetUid: string): Fundamentals | null {
  const raw = items(record(value)?.fundamentals).find((item) => item.assetUid === assetUid);
  if (!raw) return null;
  const numbers = METRICS.map(([key]) => numeric(raw[key]));
  return {
    currency: text(raw.currency),
    start: date(raw.fiscalPeriodStartDate),
    end: date(raw.fiscalPeriodEndDate),
    // Official head-instruments documentation defines zero fundamentals as unavailable.
    values: numbers.map((value) => (value === 0 ? null : value))
  };
}
export interface Dividend {
  amount: number | null;
  currency: string | null;
  record: string | null;
  payment: string | null;
  buy: string | null;
  type: string | null;
}
export function dividends(value: unknown): Dividend[] {
  return items(record(value)?.dividends)
    .map((raw) => ({
      amount: quote(raw.dividendNet),
      currency: text(record(raw.dividendNet)?.currency),
      record: date(raw.recordDate),
      payment: date(raw.paymentDate),
      buy: date(raw.lastBuyDate),
      type: text(raw.dividendType)
    }))
    .sort((a, b) => (b.record ?? "").localeCompare(a.record ?? ""));
}
export interface Report {
  date: string | null;
  year: number | null;
  period: number | null;
  type: string | null;
}
export function reports(value: unknown, uid: string): Report[] {
  return items(record(value)?.events)
    .filter((raw) => raw.instrumentId === uid)
    .map((raw) => ({
      date: date(raw.reportDate),
      year: (numeric(raw.periodYear) ?? 0) > 0 ? numeric(raw.periodYear) : null,
      period: (numeric(raw.periodNum) ?? 0) > 0 ? numeric(raw.periodNum) : null,
      type: text(raw.periodType)
    }))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}
export interface Forecast {
  kind: "target" | "consensus";
  company: string | null;
  date: string | null;
  currency: string | null;
  target: number | null;
  low: number | null;
  high: number | null;
  recommendation: string | null;
}
export function forecasts(value: unknown, uid: string): Forecast[] {
  const raw = record(value);
  const targets = items(raw?.targets)
    .filter((item) => item.uid === uid)
    .map((item) => ({
      kind: "target" as const,
      company: text(item.company),
      date: date(item.recommendationDate),
      currency: text(item.currency),
      target: quote(item.targetPrice),
      low: null,
      high: null,
      recommendation: text(item.recommendation)
    }));
  const consensus = record(raw?.consensus);
  return [
    ...(consensus?.uid === uid
      ? [
          {
            kind: "consensus" as const,
            company: null,
            date: null,
            currency: text(consensus.currency),
            target: quote(consensus.consensus),
            low: quote(consensus.minTarget),
            high: quote(consensus.maxTarget),
            recommendation: text(consensus.recommendation)
          }
        ]
      : []),
    ...targets
  ];
}

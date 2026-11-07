import { FMP_BASE_URL, failureReason, fetchFmp, numeric, type FmpFailureReason } from "./fmp";

// The VIX (Cboe Volatility Index) read as a fear and greed gauge: the 30-day volatility options traders
// expect from the S&P 500. High readings mean investors pay up for protection (fear); low ones mean
// they're relaxed (greed). The zones follow the usual rules of thumb, not a formula.

const QUOTE_REVALIDATE_SECONDS = 60;
// Cboe's history gains one row per trading day.
const HISTORY_REVALIDATE_SECONDS = 60 * 60 * 6;
// Cboe's free daily history, every close since 1990 (about 450 KB), no key needed.
const CBOE_HISTORY_URL = "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv";
const FMP_HISTORY_YEARS = 5;

export type VixZoneId = "extreme-fear" | "fear" | "neutral" | "greed" | "extreme-greed";

export type VixZone = {
  id: VixZoneId;
  label: string;
  // The VIX range, from (inclusive) to (exclusive); null at the open ends.
  from: number | null;
  to: number | null;
  meaning: string;
};

// From greed to fear, the gauge's left-to-right order reversed: the higher the VIX, the more fear.
export const VIX_ZONES: VixZone[] = [
  { id: "extreme-greed", label: "Extreme greed", from: null, to: 12, meaning: "Very calm markets. Protection is cheap, and complacency can precede a shock." },
  { id: "greed", label: "Greed", from: 12, to: 16, meaning: "Calm, rising markets. Below the long-run average." },
  { id: "neutral", label: "Neutral", from: 16, to: 20, meaning: "Around the long-run average of about 19." },
  { id: "fear", label: "Fear", from: 20, to: 30, meaning: "Nervous markets. Investors are paying up for protection." },
  { id: "extreme-fear", label: "Extreme fear", from: 30, to: null, meaning: "Panic or a sell-off under way. Historically rare and short-lived." },
];

// VIX → gauge position, 0 (extreme fear) to 100 (extreme greed): each zone takes a fifth of the dial,
// linear inside it, and readings beyond 10 and 40 pin to the ends.
const DIAL_POINTS: [vix: number, score: number][] = [[10, 100], [12, 80], [16, 60], [20, 40], [30, 20], [40, 0]];

export function vixScore(vix: number): number {
  if (vix <= DIAL_POINTS[0][0]) return 100;
  for (let index = 1; index < DIAL_POINTS.length; index++) {
    const [toVix, toScore] = DIAL_POINTS[index];
    const [fromVix, fromScore] = DIAL_POINTS[index - 1];
    if (vix <= toVix) return fromScore + ((vix - fromVix) / (toVix - fromVix)) * (toScore - fromScore);
  }
  return 0;
}

export function vixZone(vix: number): VixZone {
  return VIX_ZONES.find((zone) => (zone.from === null || vix >= zone.from) && (zone.to === null || vix < zone.to))!;
}

export type VixPoint = { date: string; close: number };

export type VixQuote = {
  value: number;
  change: number | null;
  changePercent: number | null;
  // The trading day the value belongs to, in New York.
  date: string;
  dayLow: number | null;
  dayHigh: number | null;
  // "cboe" when FMP's quote isn't available and the value is Cboe's latest close.
  source: "fmp" | "cboe";
};

export type VixData = {
  quote: VixQuote;
  // Daily closes, oldest first, through the quote's day.
  history: VixPoint[];
  historySource: "cboe" | "fmp";
};

export type VixResult = { ok: true; data: VixData } | { ok: false; reason: FmpFailureReason };

type Row = Record<string, unknown>;

function num(value: unknown): number | null {
  return numeric(typeof value === "number" ? value : null);
}

// "11/06/2026,27.68,27.76,23.47,25.64" → { date: "2026-11-06", close: 25.64 }
export function parseCboeHistory(csv: string): VixPoint[] {
  return csv.trim().split(/\r?\n/).slice(1).flatMap((line): VixPoint[] => {
    const cells = line.split(",");
    const date = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(cells[0]?.trim() ?? "");
    const close = Number(cells[4]);
    return date && Number.isFinite(close) && close > 0 ? [{ date: `${date[3]}-${date[1]}-${date[2]}`, close }] : [];
  });
}

async function cboeHistory(): Promise<VixPoint[]> {
  try {
    const response = await fetch(CBOE_HISTORY_URL, {
      headers: { "User-Agent": "StockPilot" },
      next: { revalidate: HISTORY_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(12_000),
    });
    return response.ok ? parseCboeHistory(await response.text()) : [];
  } catch {
    return [];
  }
}

function fmpUrl(endpoint: string, params: Record<string, string>, apiKey: string): URL {
  const url = new URL(`${FMP_BASE_URL}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("apikey", apiKey);
  return url;
}

async function fmpHistory(apiKey: string, today: Date): Promise<VixPoint[]> {
  const from = new Date(today);
  from.setUTCFullYear(from.getUTCFullYear() - FMP_HISTORY_YEARS);
  const payload = await fetchFmp(fmpUrl("historical-price-eod/light", { symbol: "^VIX", from: from.toISOString().slice(0, 10) }, apiKey), HISTORY_REVALIDATE_SECONDS);
  return (Array.isArray(payload) ? payload : []).flatMap((row: Row): VixPoint[] => {
    const close = num(row.price) ?? num(row.close);
    return typeof row.date === "string" && close !== null && close > 0 ? [{ date: row.date, close }] : [];
  });
}

function newYorkDate(unixSeconds: number): string {
  // en-CA writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(unixSeconds * 1000));
}

async function fmpQuote(apiKey: string): Promise<VixQuote | null> {
  const payload = await fetchFmp(fmpUrl("quote", { symbol: "^VIX" }, apiKey), QUOTE_REVALIDATE_SECONDS);
  const row = Array.isArray(payload) ? (payload[0] as Row | undefined) : undefined;
  const value = num(row?.price);
  const timestamp = num(row?.timestamp);
  if (!row || value === null || timestamp === null) return null;
  const percent = num(row.changePercentage);
  return {
    value,
    change: num(row.change),
    changePercent: percent === null ? null : percent / 100,
    date: newYorkDate(timestamp),
    dayLow: num(row.dayLow),
    dayHigh: num(row.dayHigh),
    source: "fmp",
  };
}

export async function getVix(today = new Date()): Promise<VixResult> {
  const apiKey = process.env.FMP_API_KEY;
  // Without FMP the page still works from Cboe; a reason is only needed when both fail.
  let failure: FmpFailureReason = apiKey ? "no-data" : "not-configured";
  const [fmp, cboe] = await Promise.all([
    apiKey ? fmpQuote(apiKey).catch((error: unknown) => { failure = failureReason(error); return null; }) : null,
    cboeHistory(),
  ]);

  let history = cboe;
  let historySource: VixData["historySource"] = "cboe";
  if (history.length === 0 && apiKey) {
    try {
      history = await fmpHistory(apiKey, today);
      historySource = "fmp";
    } catch (error) {
      failure = failureReason(error);
    }
  }
  history = [...history].sort((left, right) => left.date.localeCompare(right.date));

  const last = history.at(-1);
  const previous = history.at(-2);
  // Without FMP's quote, the latest close stands in.
  const quote: VixQuote | null = fmp ?? (last
    ? {
        value: last.close,
        change: previous ? last.close - previous.close : null,
        changePercent: previous ? last.close / previous.close - 1 : null,
        date: last.date,
        dayLow: null,
        dayHigh: null,
        source: "cboe",
      }
    : null);
  if (!quote) return { ok: false, reason: failure };

  // Today's quote is a point on the chart too, until the history catches up.
  if (!last || last.date < quote.date) history.push({ date: quote.date, close: quote.value });
  else if (last.date === quote.date) history[history.length - 1] = { date: quote.date, close: quote.value };

  return { ok: true, data: { quote, history, historySource } };
}

function shiftDate(isoDate: string, { years = 0, months = 0, days = 0 }: { years?: number; months?: number; days?: number }): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + years, date.getUTCMonth() + months, date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// The last close on or before a date.
function closeOn(history: VixPoint[], isoDate: string): VixPoint | null {
  for (let index = history.length - 1; index >= 0; index--) if (history[index].date <= isoDate) return history[index];
  return null;
}

export type VixComparison = { label: string; point: VixPoint | null };

export type VixStats = {
  // Earlier closes to compare today with, like a fear and greed index's "previous close" list.
  comparisons: VixComparison[];
  yearLow: number | null;
  yearHigh: number | null;
  yearAverage: number | null;
  // Share of the past year's closes below today's value: 0.9 means higher than 90% of them.
  yearPercentile: number | null;
  longRunAverage: number | null;
  longRunSince: string | null;
};

export function vixStats({ quote, history }: Pick<VixData, "quote" | "history">): VixStats {
  const before = history.filter((point) => point.date < quote.date);
  const yearAgo = shiftDate(quote.date, { years: -1 });
  const year = history.filter((point) => point.date > yearAgo && point.date <= quote.date).map((point) => point.close);
  const average = (values: number[]) => (values.length ? values.reduce((total, value) => total + value, 0) / values.length : null);

  return {
    comparisons: [
      { label: "Previous close", point: before.at(-1) ?? null },
      { label: "1 week ago", point: closeOn(history, shiftDate(quote.date, { days: -7 })) },
      { label: "1 month ago", point: closeOn(history, shiftDate(quote.date, { months: -1 })) },
      { label: "1 year ago", point: closeOn(history, yearAgo) },
    ],
    yearLow: year.length ? Math.min(...year) : null,
    yearHigh: year.length ? Math.max(...year) : null,
    yearAverage: average(year),
    yearPercentile: year.length > 1 ? year.filter((value) => value < quote.value).length / year.length : null,
    longRunAverage: average(history.map((point) => point.close)),
    longRunSince: history[0]?.date ?? null,
  };
}

// The closes the chart can show: the last five years, enough for its longest range.
export function chartHistory(history: VixPoint[], date: string): VixPoint[] {
  const from = shiftDate(date, { years: -5 });
  return history.filter((point) => point.date >= from);
}

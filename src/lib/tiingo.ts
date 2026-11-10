import { noteFailure, noteFallback, noteRateLimited } from "./provider-status";
import type { PricePoint } from "./technicals";

// Tiingo's free end-of-day prices: the Overview chart's five years first, any price history FMP can't give
// (its free plan covers a few dozen companies, and has a daily limit), and the Portfolio's prices, splits and
// dividends. Tiingo's free plan covers every US stock and ETF, but allows 50 requests an hour, 1,000 a day and
// 500 different tickers a month, so each ticker is asked for five years at once and the answer is kept for a
// day: the Overview chart, the one-year history used by Recommendations and the Forecast tab, and the Portfolio
// all share it.

const TIINGO_URL = "https://api.tiingo.com/tiingo/daily";
const REVALIDATE_SECONDS = 60 * 60 * 24;
// A ticker's name doesn't change from one day to the next.
const META_REVALIDATE_SECONDS = 60 * 60 * 24 * 30;
export const TIINGO_YEARS = 5;
// Everything StockPilot reads, and nothing else: five years come to about 130 KB instead of 300.
const COLUMNS = "close,adjClose,splitFactor,divCash";

export type TiingoDay = {
  date: string;
  // The close as it traded that day, before any later split.
  close: number;
  // Adjusted for later splits and dividends, so two days' ratio is the total return between them. The latest
  // adjusted close is the actual close.
  adjClose: number;
  // On a split's first day, the new shares per old share (10 for a 10-for-1 split); otherwise 1.
  splitFactor: number;
  // The dividend per share whose ex-dividend date is this day; otherwise 0.
  divCash: number;
};

export function isTiingoConfigured(): boolean {
  return Boolean(process.env.TIINGO_API_KEY);
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

// Tiingo's rows ("2026-11-06T00:00:00.000Z"), oldest first, skipping any without a price.
export function parseTiingoDays(payload: unknown): TiingoDay[] {
  return (Array.isArray(payload) ? (payload as Record<string, unknown>[]) : [])
    .flatMap((row): TiingoDay[] => {
      const date = typeof row.date === "string" ? row.date.slice(0, 10) : "";
      const close = positive(row.close) ?? positive(row.adjClose);
      const adjClose = positive(row.adjClose) ?? close;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close === null || adjClose === null) return [];
      return [{ date, close, adjClose, splitFactor: positive(row.splitFactor) ?? 1, divCash: positive(row.divCash) ?? 0 }];
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

// The closes adjusted for splits and dividends, so a split doesn't show as a crash.
export function parseTiingoPrices(payload: unknown): PricePoint[] {
  return parseTiingoDays(payload).map((day) => ({ date: day.date, close: day.adjClose }));
}

// The start of the shared five-year request, so every page asks for the same URL on a given day.
export function tiingoStartDate(now: Date): string {
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - TIINGO_YEARS);
  return start.toISOString().slice(0, 10);
}

// Why Tiingo gave nothing: no key, a ticker it doesn't know, or a limit reached or a failure.
export type TiingoMiss = "not-configured" | "unknown" | "unavailable";

type TiingoAnswer = { ok: true; payload: unknown } | { ok: false; reason: TiingoMiss };

async function tiingoFetch(path: string, revalidate: number): Promise<TiingoAnswer> {
  const apiKey = process.env.TIINGO_API_KEY;
  if (!apiKey) return { ok: false, reason: "not-configured" };
  try {
    const response = await fetch(`${TIINGO_URL}/${path}`, {
      // The key travels in a header, so it never appears in URLs or logs.
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      next: { revalidate },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      // An unknown ticker is a 404; anything else is worth knowing about.
      if (response.status === 429) noteRateLimited("tiingo");
      else if (response.status !== 404) noteFailure("tiingo", `HTTP ${response.status}`);
      return { ok: false, reason: response.status === 404 ? "unknown" : "unavailable" };
    }
    return { ok: true, payload: await response.json() };
  } catch {
    noteFailure("tiingo", "no response");
    return { ok: false, reason: "unavailable" };
  }
}

async function tiingoGet(path: string, revalidate: number): Promise<unknown | null> {
  const answer = await tiingoFetch(path, revalidate);
  return answer.ok ? answer.payload : null;
}

export type TiingoDaysResult = { ok: true; days: TiingoDay[] } | { ok: false; reason: TiingoMiss };

// Daily prices from `startDate` (YYYY-MM-DD) to the latest close, or why there are none: a ticker with no prices
// counts as unknown. Tiingo writes share classes with a dash (BRK-B), as StockPilot does.
export async function fetchTiingoDays(symbol: string, startDate: string): Promise<TiingoDaysResult> {
  const answer = await tiingoFetch(`${encodeURIComponent(symbol.toLowerCase())}/prices?startDate=${startDate}&columns=${COLUMNS}`, REVALIDATE_SECONDS);
  if (!answer.ok) return answer;
  const days = parseTiingoDays(answer.payload);
  return days.length > 0 ? { ok: true, days } : { ok: false, reason: "unknown" };
}

// The same, or null when Tiingo isn't configured, doesn't know the ticker or fails.
export async function getTiingoDays(symbol: string, startDate: string): Promise<TiingoDay[] | null> {
  const result = await fetchTiingoDays(symbol, startDate);
  return result.ok ? result.days : null;
}

// Five years of daily closes, adjusted for splits and dividends, or null (see getTiingoDays).
export async function getTiingoCloses(symbol: string, now = new Date()): Promise<PricePoint[] | null> {
  const days = await getTiingoDays(symbol, tiingoStartDate(now));
  if (!days) return null;
  noteFallback("tiingo");
  return days.map((day) => ({ date: day.date, close: day.adjClose }));
}

// Words that stay in capitals, and brands with their own spelling.
const KEEP_CAPITALS = new Set(["ETF", "ETFS", "ETN", "S&P", "US", "U.S.", "USA", "REIT", "MSCI", "ESG", "ADR", "II", "III", "IV", "AI", "LP", "LLC", "PLC"]);
const SPELLINGS: Record<string, string> = { ISHARES: "iShares", NASDAQ: "Nasdaq" };

// Tiingo writes many fund names in capitals ("SCHWAB U.S. DIVIDEND EQUITY ETF"); this gives them ordinary case,
// keeping abbreviations and words without vowels (QQQ, SPDR) as they are.
export function tidyName(name: string): string {
  if (name !== name.toUpperCase() || !/[A-Z]{4}/.test(name)) return name;
  return name
    .split(" ")
    .map((word) => SPELLINGS[word] ?? (KEEP_CAPITALS.has(word) || !/[AEIOUY]/.test(word) ? word : word.charAt(0) + word.slice(1).toLowerCase()))
    .join(" ");
}

// The ticker's name ("SPDR S&P 500 ETF Trust"), for funds that Finnhub's company profile doesn't cover.
export async function getTiingoName(symbol: string): Promise<string | null> {
  const payload = await tiingoGet(encodeURIComponent(symbol.toLowerCase()), META_REVALIDATE_SECONDS);
  const name = payload && typeof payload === "object" ? (payload as { name?: unknown }).name : null;
  return typeof name === "string" && name.trim() ? tidyName(name.trim()) : null;
}

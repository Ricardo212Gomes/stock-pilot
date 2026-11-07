import type { PricePoint } from "./technicals";

// Tiingo's free end-of-day prices, the fallback when FMP can't give a company's price history (its free plan
// covers a few dozen companies, and has a daily limit). Tiingo's free plan covers every US stock, but allows
// 50 requests an hour, 1,000 a day and 500 different stocks a month, so it's asked only when FMP fails, for
// five years at once, and the answer is kept for a day: the Overview chart and the one-year history used by
// Recommendations and the Forecast tab share it.

const TIINGO_URL = "https://api.tiingo.com/tiingo/daily";
const REVALIDATE_SECONDS = 60 * 60 * 24;
export const TIINGO_YEARS = 5;

export function isTiingoConfigured(): boolean {
  return Boolean(process.env.TIINGO_API_KEY);
}

// Tiingo's rows, oldest first: "2026-11-06T00:00:00.000Z" and the close adjusted for splits and dividends, so
// a split doesn't show as a crash. The latest adjusted close is the actual close.
export function parseTiingoPrices(payload: unknown): PricePoint[] {
  return (Array.isArray(payload) ? (payload as Record<string, unknown>[]) : [])
    .flatMap((row): PricePoint[] => {
      const date = typeof row.date === "string" ? row.date.slice(0, 10) : "";
      const value = typeof row.adjClose === "number" ? row.adjClose : row.close;
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof value === "number" && Number.isFinite(value) && value > 0 ? [{ date, close: value }] : [];
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

// Five years of daily closes, or null when Tiingo isn't configured, doesn't know the ticker or fails.
export async function getTiingoCloses(symbol: string, now = new Date()): Promise<PricePoint[] | null> {
  const apiKey = process.env.TIINGO_API_KEY;
  if (!apiKey) return null;
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - TIINGO_YEARS);
  try {
    // Tiingo writes share classes with a dash (BRK-B), as StockPilot does. Asking for the adjusted close alone
    // makes five years about 80 KB instead of 300.
    const url = `${TIINGO_URL}/${encodeURIComponent(symbol.toLowerCase())}/prices?startDate=${start.toISOString().slice(0, 10)}&columns=adjClose`;
    const response = await fetch(url, {
      // The key travels in a header, so it never appears in URLs or logs.
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const closes = parseTiingoPrices(await response.json());
    return closes.length > 0 ? closes : null;
  } catch {
    return null;
  }
}

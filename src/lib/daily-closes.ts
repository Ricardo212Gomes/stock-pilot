import { canUseFallback, failureReason, FMP_BASE_URL, fetchFmp, numeric } from "./fmp";
import type { PricePoint } from "./technicals";
import { getTiingoCloses } from "./tiingo";

// A year of daily closes from FMP's light end-of-day endpoint, cached for a day. Recommendations and the
// Forecast tab ask for the same range, so a company screened by one costs the other nothing. When FMP's plan
// doesn't cover the company, or its daily limit is reached, Tiingo's prices stand in.

const DAILY_REVALIDATE_SECONDS = 60 * 60 * 24;
// A year of sessions with room for holidays: enough for the 200-day average and the 52-week range.
export const HISTORY_DAYS = 400;

async function fmpCloses(symbol: string, from: string, apiKey: string): Promise<PricePoint[]> {
  const url = new URL(`${FMP_BASE_URL}/historical-price-eod/light`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("from", from);
  url.searchParams.set("apikey", apiKey);
  const payload = await fetchFmp(url, DAILY_REVALIDATE_SECONDS);
  return (Array.isArray(payload) ? (payload as Record<string, unknown>[]) : []).flatMap((row): PricePoint[] => {
    const close = numeric(typeof row.price === "number" ? row.price : typeof row.close === "number" ? row.close : null);
    return typeof row.date === "string" && close !== null ? [{ date: row.date, close }] : [];
  });
}

// Throws FMP's failure (see fetchFmp) when Tiingo can't stand in either, so callers can tell a limit from a
// company nobody has prices for.
export async function getDailyCloses(symbol: string, now = new Date()): Promise<PricePoint[]> {
  const from = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const apiKey = process.env.FMP_API_KEY;
  let failure: unknown = null;
  if (apiKey) {
    try {
      const closes = await fmpCloses(symbol, from, apiKey);
      if (closes.length > 0) return closes;
    } catch (error) {
      if (!canUseFallback(failureReason(error))) throw error;
      failure = error;
    }
  }
  const tiingo = await getTiingoCloses(symbol, now);
  if (tiingo) return tiingo.filter((point) => point.date >= from);
  if (failure) throw failure;
  return [];
}

import { FMP_BASE_URL, fetchFmp, numeric } from "./fmp";
import type { PricePoint } from "./technicals";

// A year of daily closes from FMP's light end-of-day endpoint, cached for a day. Recommendations and the
// Forecast tab ask for the same range, so a company screened by one costs the other nothing.

const DAILY_REVALIDATE_SECONDS = 60 * 60 * 24;
// A year of sessions with room for holidays: enough for the 200-day average and the 52-week range.
export const HISTORY_DAYS = 400;

// Throws FMP's failure (see fetchFmp) so callers can tell a limit from a company the plan doesn't cover.
export async function getDailyCloses(symbol: string, now = new Date()): Promise<PricePoint[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return [];
  const url = new URL(`${FMP_BASE_URL}/historical-price-eod/light`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("from", new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10));
  url.searchParams.set("apikey", apiKey);
  const payload = await fetchFmp(url, DAILY_REVALIDATE_SECONDS);
  return (Array.isArray(payload) ? (payload as Record<string, unknown>[]) : []).flatMap((row): PricePoint[] => {
    const close = numeric(typeof row.price === "number" ? row.price : typeof row.close === "number" ? row.close : null);
    return typeof row.date === "string" && close !== null ? [{ date: row.date, close }] : [];
  });
}

import { fetchFinnhub, finnhubSymbol } from "./finnhub";
import { numeric } from "./fmp";
import type { RatingCounts } from "./recommendation-signals";

// Finnhub's analyst rating counts by month: free for every US stock, four months on its free plan. The
// Overview, the Forecast tab and Recommendations share this one request, cached for a day, so the three show
// the same consensus.

const DAILY_REVALIDATE_SECONDS = 60 * 60 * 24;

export type RatingMonth = RatingCounts & { period: string };

// Newest first.
export function parseRatingMonths(payload: unknown): RatingMonth[] {
  const count = (value: unknown) => numeric(typeof value === "number" ? value : null) ?? 0;
  return (Array.isArray(payload) ? (payload as Record<string, unknown>[]) : [])
    .flatMap((row): RatingMonth[] => (
      typeof row.period === "string" && row.period
        ? [{ period: row.period, strongBuy: count(row.strongBuy), buy: count(row.buy), hold: count(row.hold), sell: count(row.sell), strongSell: count(row.strongSell) }]
        : []
    ))
    .sort((left, right) => right.period.localeCompare(left.period));
}

// Empty when Finnhub isn't configured, fails or has no ratings.
export async function getRatingMonths(symbol: string): Promise<RatingMonth[]> {
  const result = await fetchFinnhub("stock/recommendation", { symbol: finnhubSymbol(symbol) }, DAILY_REVALIDATE_SECONDS);
  return result.ok ? parseRatingMonths(result.payload) : [];
}

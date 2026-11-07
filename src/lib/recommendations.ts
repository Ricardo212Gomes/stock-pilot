import universe from "@/data/largest-us-companies.json";
import { FMP_BASE_URL, failureReason, fetchFmp, numeric, type FmpFailureReason } from "./fmp";
import { fetchFinnhub, finnhubSymbol } from "./finnhub";
import { summarizeRatings, type Candidate, type RatingCounts } from "./recommendation-signals";
import { optionalRows } from "./stock-overview";
import { priceTrend, type PricePoint } from "./technicals";

// The Recommendations screen's data: the largest US companies FMP's plan covers (the bundled snapshot, see
// docs/stock-overview.md), each with the analysts' consensus price target (FMP), their ratings (Finnhub) and
// a year of daily closes (FMP). Everything is cached for a day, so a screen costs about two FMP requests per
// company once a day, plus one to check which companies the plan covers.

const DAILY_REVALIDATE_SECONDS = 60 * 60 * 24;
// A year of sessions with room for holidays: enough for the 200-day average and the 52-week range.
const HISTORY_DAYS = 400;
// Companies loaded at once. Each needs one Finnhub request, and Finnhub's free plan allows 30 a second.
const CONCURRENCY = 4;

type Row = Record<string, unknown>;

function num(value: unknown): number | null {
  return numeric(typeof value === "number" ? value : null);
}

async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }));
  return results;
}

function fmpUrl(endpoint: string, params: Record<string, string>, apiKey: string): URL {
  const url = new URL(`${FMP_BASE_URL}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("apikey", apiKey);
  return url;
}

// The symbols FMP's plan has data for, with today's market cap: the batch quietly leaves out the rest.
async function coveredCompanies(symbols: string[], apiKey: string): Promise<Map<string, number | null>> {
  // Same request as the Stocks page's snapshot fallback, so the two share one cached response.
  const payload = await fetchFmp(fmpUrl("market-capitalization-batch", { symbols: symbols.join(",") }, apiKey), 60 * 60 * 6);
  const rows = Array.isArray(payload) ? (payload as Row[]) : [];
  return new Map(rows.flatMap((row) => (typeof row.symbol === "string" ? [[row.symbol, num(row.marketCap)] as const] : [])));
}

async function dailyCloses(symbol: string, apiKey: string, today: Date): Promise<PricePoint[]> {
  const from = new Date(today.getTime() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const payload = await fetchFmp(fmpUrl("historical-price-eod/light", { symbol, from }, apiKey), DAILY_REVALIDATE_SECONDS);
  return (Array.isArray(payload) ? (payload as Row[]) : []).flatMap((row): PricePoint[] => {
    const close = num(row.price) ?? num(row.close);
    return typeof row.date === "string" && close !== null ? [{ date: row.date, close }] : [];
  });
}

async function analystRatings(symbol: string) {
  const result = await fetchFinnhub("stock/recommendation", { symbol: finnhubSymbol(symbol) }, DAILY_REVALIDATE_SECONDS);
  const rows = result.ok && Array.isArray(result.payload) ? (result.payload as Row[]) : [];
  return summarizeRatings(rows.flatMap((row): (RatingCounts & { period: string })[] => (
    typeof row.period === "string"
      ? [{ period: row.period, strongBuy: num(row.strongBuy) ?? 0, buy: num(row.buy) ?? 0, hold: num(row.hold) ?? 0, sell: num(row.sell) ?? 0, strongSell: num(row.strongSell) ?? 0 }]
      : []
  )));
}

export type RecommendationScreen = {
  candidates: Candidate[];
  // Companies in the bundled list, and how many of them FMP's plan covers.
  universe: number;
  covered: number;
  // The latest close the figures use.
  asOf: string | null;
};

export type RecommendationResult = { ok: true; data: RecommendationScreen } | { ok: false; reason: FmpFailureReason };

export async function getRecommendationScreen(now = new Date()): Promise<RecommendationResult> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { ok: false, reason: "not-configured" };

  const companies = universe.companies;
  let covered: Map<string, number | null>;
  try {
    covered = await coveredCompanies(companies.map((company) => company.symbol), apiKey);
  } catch (error) {
    return { ok: false, reason: failureReason(error) };
  }

  const failures: FmpFailureReason[] = [];
  const results = await mapLimit(companies.filter((company) => covered.has(company.symbol)), CONCURRENCY, async (company): Promise<Candidate | null> => {
    const [closes, targets, ratings] = await Promise.all([
      dailyCloses(company.symbol, apiKey, now).catch((error: unknown) => {
        failures.push(failureReason(error));
        return [];
      }),
      // Same request as the overview's price target, so the two share one cached response.
      optionalRows("price-target-consensus", { symbol: company.symbol }),
      analystRatings(company.symbol),
    ]);
    const trend = priceTrend(closes);
    if (!trend) return null;
    const consensus = num(targets[0]?.targetConsensus);
    return {
      symbol: company.symbol,
      name: company.name,
      marketCap: covered.get(company.symbol) ?? company.marketCap,
      trend,
      target: consensus !== null && consensus > 0 ? { consensus, high: num(targets[0]?.targetHigh), low: num(targets[0]?.targetLow) } : null,
      ratings,
    };
  });

  const candidates = results.filter((candidate): candidate is Candidate => candidate !== null);
  if (candidates.length === 0) return { ok: false, reason: failures[0] ?? "no-data" };
  return {
    ok: true,
    data: {
      candidates,
      universe: companies.length,
      covered: covered.size,
      asOf: candidates.reduce<string | null>((latest, candidate) => (!latest || candidate.trend.date > latest ? candidate.trend.date : latest), null),
    },
  };
}

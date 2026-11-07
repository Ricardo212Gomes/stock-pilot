import snapshot from "@/data/largest-us-companies.json";
import { FMP_BASE_URL, canUseFallback, failureReason, fetchFmp, numeric, type FmpFailureReason } from "./fmp";

// The Stocks page's leaderboards: the largest US companies and today's biggest moves,
// one FMP request each.

export type LeaderboardId = "largest" | "gainers" | "losers" | "active";

export const LEADERBOARDS: { id: LeaderboardId; label: string; description: string }[] = [
  { id: "largest", label: "Largest companies", description: "US-listed companies by market capitalization." },
  { id: "gainers", label: "Top gainers", description: "Today's biggest rises in share price." },
  { id: "losers", label: "Top losers", description: "Today's biggest falls in share price." },
  { id: "active", label: "Most active", description: "Today's most traded stocks by volume." },
];

export type LeaderboardRow = {
  symbol: string;
  name: string;
  price: number | null;
  // A fraction: 0.025 is +2.5%.
  changePercent: number | null;
  marketCap: number | null;
  volume: number | null;
  sector: string | null;
};

export type LeaderboardResult =
  // `snapshotDate` is set when the largest companies come from the bundled snapshot, not FMP's screener.
  | { ok: true; rows: LeaderboardRow[]; snapshotDate?: string }
  | { ok: false; reason: FmpFailureReason };

export const LEADERBOARD_SIZE = 50;
// Prices move all day; the largest companies barely change order.
const MOVERS_REVALIDATE_SECONDS = 60 * 15;
const LARGEST_REVALIDATE_SECONDS = 60 * 60 * 6;

const REQUESTS: Record<LeaderboardId, { endpoint: string; params: Record<string, string>; revalidate: number }> = {
  largest: {
    endpoint: "company-screener",
    params: {
      marketCapMoreThan: "10000000000",
      country: "US",
      isEtf: "false",
      isFund: "false",
      isActivelyTrading: "true",
      limit: "200",
    },
    revalidate: LARGEST_REVALIDATE_SECONDS,
  },
  gainers: { endpoint: "biggest-gainers", params: {}, revalidate: MOVERS_REVALIDATE_SECONDS },
  losers: { endpoint: "biggest-losers", params: {}, revalidate: MOVERS_REVALIDATE_SECONDS },
  active: { endpoint: "most-actives", params: {}, revalidate: MOVERS_REVALIDATE_SECONDS },
};

export function isLeaderboardId(value: unknown): value is LeaderboardId {
  return LEADERBOARDS.some((board) => board.id === value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return numeric(typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : null);
}

// FMP's field names vary between endpoints (changesPercentage, changePercentage), and percentages
// are whole numbers (2.5 means 2.5%).
export function normalizeRow(row: unknown): LeaderboardRow | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const symbol = text(record.symbol);
  if (!symbol) return null;
  const percent = num(record.changesPercentage ?? record.changePercentage);
  return {
    symbol,
    name: text(record.companyName) ?? text(record.name) ?? symbol,
    price: num(record.price),
    changePercent: percent === null ? null : percent / 100,
    marketCap: num(record.marketCap),
    volume: num(record.volume),
    sector: text(record.sector),
  };
}

export function rankRows(id: LeaderboardId, rows: LeaderboardRow[]): LeaderboardRow[] {
  const sorted = [...rows];
  if (id === "largest") sorted.sort((left, right) => (right.marketCap ?? 0) - (left.marketCap ?? 0));
  if (id === "gainers") sorted.sort((left, right) => (right.changePercent ?? -Infinity) - (left.changePercent ?? -Infinity));
  if (id === "losers") sorted.sort((left, right) => (left.changePercent ?? Infinity) - (right.changePercent ?? Infinity));
  if (id === "active") sorted.sort((left, right) => (right.volume ?? 0) - (left.volume ?? 0));
  // Share classes of one company (GOOGL, GOOG) stay: they trade separately.
  const seen = new Set<string>();
  return sorted.filter((row) => !seen.has(row.symbol) && seen.add(row.symbol)).slice(0, LEADERBOARD_SIZE);
}

// Without the screener (some FMP plans don't include it, and every plan has a daily limit): the bundled
// snapshot (`npm run largest:update`), with today's market cap for the companies FMP's batch covers.
async function largestFromSnapshot(apiKey: string): Promise<LeaderboardResult> {
  const live = new Map<string, number>();
  try {
    const url = new URL(`${FMP_BASE_URL}/market-capitalization-batch`);
    url.searchParams.set("symbols", snapshot.companies.map((company) => company.symbol).join(","));
    url.searchParams.set("apikey", apiKey);
    const payload = await fetchFmp(url, LARGEST_REVALIDATE_SECONDS);
    for (const row of Array.isArray(payload) ? payload : []) {
      const parsed = normalizeRow(row);
      if (parsed?.marketCap) live.set(parsed.symbol, parsed.marketCap);
    }
  } catch {
    // The snapshot's own figures stand.
  }
  const rows = snapshot.companies.map((company): LeaderboardRow => ({
    symbol: company.symbol,
    name: company.name,
    price: null,
    changePercent: null,
    marketCap: live.get(company.symbol) ?? company.marketCap,
    volume: null,
    sector: company.sector,
  }));
  return { ok: true, rows: rankRows("largest", rows), snapshotDate: snapshot.asOf };
}

export async function getLeaderboard(id: LeaderboardId): Promise<LeaderboardResult> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { ok: false, reason: "not-configured" };
  const { endpoint, params, revalidate } = REQUESTS[id];
  const url = new URL(`${FMP_BASE_URL}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("apikey", apiKey);
  try {
    const payload = await fetchFmp(url, revalidate);
    if (!Array.isArray(payload)) return { ok: false, reason: "provider-error" };
    const rows = rankRows(id, payload.flatMap((row) => normalizeRow(row) ?? []));
    return rows.length ? { ok: true, rows } : { ok: false, reason: "no-data" };
  } catch (error) {
    const reason = failureReason(error);
    if (id === "largest" && canUseFallback(reason)) return largestFromSnapshot(apiKey);
    return { ok: false, reason };
  }
}

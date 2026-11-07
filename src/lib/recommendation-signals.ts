import type { PriceTrend } from "./technicals";

// The Recommendations screen's rules, shared by the server (which loads the figures) and the browser (which
// re-scores them as filters change): analyst upside, analyst ratings and the price trend.

export type RatingCounts = { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number };

export const RATING_KEYS = ["strongBuy", "buy", "hold", "sell", "strongSell"] as const;

export type RatingLabel = "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell";

export type AnalystRatings = RatingCounts & {
  // The month the counts are for, e.g. "2026-11-01".
  period: string;
  total: number;
  // The average rating from 1 (Strong Buy) to 5 (Strong Sell).
  mean: number;
  label: RatingLabel;
  // Share of analysts rating it Buy or Strong Buy.
  buyShare: number;
  // The same share three months earlier; null without those counts.
  buyShareBefore: number | null;
};

export type Candidate = {
  symbol: string;
  name: string;
  marketCap: number | null;
  trend: PriceTrend;
  // The analysts' consensus price target and its range.
  target: { consensus: number; high: number | null; low: number | null } | null;
  ratings: AnalystRatings | null;
};

export const DEFAULT_MIN_UPSIDE = 0.15;
export const UPSIDE_CHOICES = [0.1, 0.15, 0.2, 0.3];
export const MIN_BUY_SHARE = 0.75;
// Fewer analysts make a consensus too thin to lean on.
export const MIN_ANALYSTS = 5;
export const RSI_LOW = 40;
// A rise in the Buy share smaller than this is noise: one analyst more or less.
export const MIN_RATING_IMPROVEMENT = 0.02;

// The usual bands for an average rating: 1–1.5 Strong Buy, to 2.5 Buy, to 3.5 Hold, to 4.5 Sell.
export function ratingLabel(mean: number): RatingLabel {
  if (mean <= 1.5) return "Strong Buy";
  if (mean <= 2.5) return "Buy";
  if (mean <= 3.5) return "Hold";
  if (mean <= 4.5) return "Sell";
  return "Strong Sell";
}

function buyShare(counts: RatingCounts): number | null {
  const total = RATING_KEYS.reduce((sum, key) => sum + counts[key], 0);
  return total > 0 ? (counts.strongBuy + counts.buy) / total : null;
}

// The latest month's counts, with the trend against the month three earlier. `months` in any order.
export function summarizeRatings(months: (RatingCounts & { period: string })[]): AnalystRatings | null {
  const sorted = [...months].sort((left, right) => right.period.localeCompare(left.period));
  const latest = sorted[0];
  if (!latest) return null;
  const total = RATING_KEYS.reduce((sum, key) => sum + latest[key], 0);
  if (total === 0) return null;
  const mean = RATING_KEYS.reduce((sum, key, index) => sum + latest[key] * (index + 1), 0) / total;
  const earlier = new Date(`${latest.period.slice(0, 7)}-01T12:00:00Z`);
  earlier.setUTCMonth(earlier.getUTCMonth() - 3);
  const before = sorted.find((month) => month.period.slice(0, 7) === earlier.toISOString().slice(0, 7));
  return {
    strongBuy: latest.strongBuy,
    buy: latest.buy,
    hold: latest.hold,
    sell: latest.sell,
    strongSell: latest.strongSell,
    period: latest.period,
    total,
    mean,
    label: ratingLabel(mean),
    buyShare: (latest.strongBuy + latest.buy) / total,
    buyShareBefore: before ? buyShare(before) : null,
  };
}

export function upside(candidate: Candidate): number | null {
  return candidate.target ? candidate.target.consensus / candidate.trend.close - 1 : null;
}

// The last close against an average, as a fraction: -0.06 is 6% below it.
export function versus(close: number, average: number | null): number | null {
  return average ? close / average - 1 : null;
}

export type SignalId = "upside" | "buyRatings" | "below12Week" | "above200Day" | "rsiLow" | "ratingsImproving";

// The first three are the screen's own question: undervalued against analysts, rated Buy, and in a dip.
export const SIGNALS: { id: SignalId; label: string; core: boolean }[] = [
  { id: "upside", label: "Analyst upside", core: true },
  { id: "buyRatings", label: `${Math.round(MIN_BUY_SHARE * 100)}%+ Buy ratings`, core: true },
  { id: "below12Week", label: "Below 12-week average", core: true },
  { id: "above200Day", label: "Above 200-day average", core: false },
  { id: "rsiLow", label: `RSI under ${RSI_LOW}`, core: false },
  { id: "ratingsImproving", label: "Ratings improving", core: false },
];

export function signalHelp(id: SignalId, minUpside: number): string {
  switch (id) {
    case "upside":
      return `The analysts' consensus price target is at least ${Math.round(minUpside * 100)}% above the last close.`;
    case "buyRatings":
      return `At least ${Math.round(MIN_BUY_SHARE * 100)}% of analysts (${MIN_ANALYSTS} or more) rate it Buy or Strong Buy.`;
    case "below12Week":
      return "The last close is under the average of the last 60 sessions: the stock has pulled back.";
    case "above200Day":
      return "The last close is over the 200-day average: a dip in a long-term uptrend rather than a slide.";
    case "rsiLow":
      return `The 14-day RSI is under ${RSI_LOW}: selling has outweighed buying lately.`;
    case "ratingsImproving":
      return `The share of Buy ratings is up at least ${Math.round(MIN_RATING_IMPROVEMENT * 100)} points on three months ago.`;
  }
}

export function evaluateSignals(candidate: Candidate, minUpside = DEFAULT_MIN_UPSIDE): Record<SignalId, boolean> {
  const { trend, ratings } = candidate;
  const gain = upside(candidate);
  return {
    upside: gain !== null && gain >= minUpside,
    buyRatings: !!ratings && ratings.total >= MIN_ANALYSTS && ratings.buyShare >= MIN_BUY_SHARE,
    below12Week: trend.sma60 !== null && trend.close < trend.sma60,
    above200Day: trend.sma200 !== null && trend.close > trend.sma200,
    rsiLow: trend.rsi14 !== null && trend.rsi14 < RSI_LOW,
    ratingsImproving: !!ratings && ratings.buyShareBefore !== null && ratings.buyShare - ratings.buyShareBefore >= MIN_RATING_IMPROVEMENT,
  };
}

export type ScoredCandidate = Candidate & { upside: number | null; signals: Record<SignalId, boolean>; met: number };

// Most signals first, then the most upside.
export function scoreCandidates(candidates: Candidate[], minUpside = DEFAULT_MIN_UPSIDE): ScoredCandidate[] {
  return candidates
    .map((candidate) => {
      const signals = evaluateSignals(candidate, minUpside);
      return { ...candidate, upside: upside(candidate), signals, met: Object.values(signals).filter(Boolean).length };
    })
    .sort((left, right) => right.met - left.met || (right.upside ?? -Infinity) - (left.upside ?? -Infinity));
}

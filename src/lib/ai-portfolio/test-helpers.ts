import { scoreCandidates, type Candidate, type ScoredCandidate } from "../recommendation-signals";

// A screened company with plain figures, for the AI portfolio's tests.
export function candidate(symbol: string, close = 100): Candidate {
  return {
    symbol,
    name: `${symbol} Inc.`,
    marketCap: 500e9,
    trend: { close, date: "2026-11-13", sma60: close * 1.05, sma200: close * 0.9, rsi14: 45, high52: close * 1.2, low52: close * 0.7, return3m: 0.04 },
    target: { consensus: close * 1.25, high: close * 1.5, low: close * 0.9 },
    ratings: {
      strongBuy: 10, buy: 20, hold: 5, sell: 0, strongSell: 0, period: "2026-11-01", total: 35, mean: 1.9, label: "Buy", buyShare: 30 / 35, buyShareBefore: 0.8,
    },
  };
}

export function scored(symbols: string[]): ScoredCandidate[] {
  return scoreCandidates(symbols.map((symbol) => candidate(symbol)));
}

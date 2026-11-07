import { describe, expect, it } from "vitest";
import { evaluateSignals, ratingLabel, scoreCandidates, summarizeRatings, type Candidate } from "./recommendation-signals";
import type { PriceTrend } from "./technicals";

const months = [
  { period: "2026-11-01", strongBuy: 25, buy: 41, hold: 2, sell: 1, strongSell: 0 },
  { period: "2026-10-01", strongBuy: 25, buy: 41, hold: 2, sell: 1, strongSell: 0 },
  { period: "2026-08-01", strongBuy: 20, buy: 35, hold: 12, sell: 2, strongSell: 0 },
];

describe("summarizeRatings", () => {
  it("averages the latest month and compares it with three months earlier", () => {
    const ratings = summarizeRatings([...months].reverse())!;
    expect(ratings.period).toBe("2026-11-01");
    expect(ratings.total).toBe(69);
    expect(ratings.mean).toBeCloseTo((25 + 82 + 6 + 4) / 69);
    expect(ratings.label).toBe("Buy");
    expect(ratings.buyShare).toBeCloseTo(66 / 69);
    expect(ratings.buyShareBefore).toBeCloseTo(55 / 69);
  });

  it("has no trend without the month three back, and nothing without counts", () => {
    expect(summarizeRatings(months.slice(0, 2))!.buyShareBefore).toBeNull();
    expect(summarizeRatings([{ period: "2026-11-01", strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 }])).toBeNull();
  });
});

describe("ratingLabel", () => {
  it("uses the usual bands", () => {
    expect([1.2, 1.5, 1.7, 2.5, 3.0, 4.0, 4.8].map(ratingLabel)).toEqual(["Strong Buy", "Strong Buy", "Buy", "Buy", "Hold", "Sell", "Strong Sell"]);
  });
});

function trend(overrides: Partial<PriceTrend> = {}): PriceTrend {
  return { close: 100, date: "2026-11-06", sma60: 105, sma200: 90, rsi14: 35, high52: 125, low52: 80, return3m: -0.05, ...overrides };
}

function candidate(symbol: string, overrides: Partial<Candidate> = {}): Candidate {
  return {
    symbol,
    name: symbol,
    marketCap: null,
    trend: trend(),
    target: { consensus: 130, high: 150, low: 100 },
    ratings: summarizeRatings(months),
    ...overrides,
  };
}

describe("evaluateSignals", () => {
  it("checks upside, ratings and the price trend", () => {
    expect(evaluateSignals(candidate("A"))).toEqual({
      upside: true,
      buyRatings: true,
      below12Week: true,
      above200Day: true,
      rsiLow: true,
      ratingsImproving: true,
    });
    expect(evaluateSignals(candidate("B", { trend: trend({ close: 120, sma60: 110, sma200: 125, rsi14: 60 }), target: { consensus: 126, high: null, low: null }, ratings: null }))).toEqual({
      upside: false,
      buyRatings: false,
      below12Week: false,
      above200Day: false,
      rsiLow: false,
      ratingsImproving: false,
    });
  });

  it("follows the chosen minimum upside", () => {
    expect(evaluateSignals(candidate("A"), 0.3).upside).toBe(true);
    expect(evaluateSignals(candidate("A"), 0.31).upside).toBe(false);
  });

  it("counts ratings as improving only when the Buy share rises by 2 points or more", () => {
    const counts = (period: string, buy: number) => ({ period, strongBuy: 15, buy, hold: 7, sell: 1, strongSell: 0 });
    const flat = summarizeRatings([counts("2026-11-01", 35), counts("2026-08-01", 34)]);
    // 49 of 57 (86.0%) to 65 of 73 (89.0%).
    const rising = summarizeRatings([counts("2026-11-01", 50), counts("2026-08-01", 34)]);
    expect(evaluateSignals(candidate("A", { ratings: flat })).ratingsImproving).toBe(false);
    expect(evaluateSignals(candidate("A", { ratings: rising })).ratingsImproving).toBe(true);
  });

  it("needs enough analysts for the ratings signal", () => {
    const few = summarizeRatings([{ period: "2026-11-01", strongBuy: 3, buy: 1, hold: 0, sell: 0, strongSell: 0 }]);
    expect(evaluateSignals(candidate("A", { ratings: few })).buyRatings).toBe(false);
  });
});

describe("scoreCandidates", () => {
  it("ranks by signals met, then upside", () => {
    const ranked = scoreCandidates([
      candidate("FEW", { trend: trend({ sma60: 95, rsi14: 55 }) }),
      candidate("ALL"),
      candidate("ALL_MORE_UPSIDE", { target: { consensus: 160, high: null, low: null } }),
    ]);
    expect(ranked.map((item) => [item.symbol, item.met])).toEqual([["ALL_MORE_UPSIDE", 6], ["ALL", 6], ["FEW", 4]]);
    expect(ranked[0].upside).toBeCloseTo(0.6);
  });
});

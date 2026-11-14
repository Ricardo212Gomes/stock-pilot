import { describe, expect, it } from "vitest";
import type { Holding } from "./portfolio";
import { summarizeReviews, tradingAgentsBook, type Review } from "./portfolio-reviews";

function review(symbol: string, analysisDate: string, rating: Review["rating"]): Review {
  return { symbol, analysisDate, rating, summary: `${symbol} on ${analysisDate}`, priceTarget: null, horizon: null, shares: 1, averageCost: 100, model: null };
}

describe("summarizeReviews", () => {
  it("keeps each symbol's latest review with the rating before it, worst first", () => {
    const summaries = summarizeReviews(
      [
        review("NVDA", "2026-11-03", "Hold"),
        review("NVDA", "2026-11-12", "Underweight"),
        review("MSFT", "2026-11-10", "Buy"),
        review("AAPL", "2026-10-01", "Hold"),
      ],
      "2026-11-14",
    );
    expect(summaries.map(({ symbol, rating, previousRating, stale }) => [symbol, rating, previousRating, stale])).toEqual([
      ["NVDA", "Underweight", "Hold", false],
      ["AAPL", "Hold", null, true],
      ["MSFT", "Buy", null, false],
    ]);
  });
});

describe("tradingAgentsBook", () => {
  const holding = (symbol: string, priced: boolean, shares: number, averageCost: number) => ({ symbol, priced, shares, averageCost }) as Holding;

  it("gives each priced holding's shares and average cost, leaving out instruments without prices", () => {
    expect(tradingAgentsBook([holding("NVDA", true, 12.5, 118.123456), holding("IE00B5BMR087", false, 3, 500), holding("AAPL", true, 0, 1)], "USD")).toEqual({
      currency: "USD",
      positions: [{ ticker: "NVDA", quantity: 12.5, average_price: 118.1235 }],
    });
  });
});

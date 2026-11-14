import { describe, expect, it } from "vitest";
import type { Holding } from "./portfolio";
import { previewOf, summarizeReviews, tradingAgentsBook, type Review } from "./portfolio-reviews";

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

describe("previewOf", () => {
  it("gives a report's first sentence as plain text, without the speaker, headings or Markdown", () => {
    // Openings of the NVDA review's sections.
    expect(previewOf("Bull Analyst: Look, I know what the bears are going to say. They're going to point at the chart.")).toBe("Look, I know what the bears are going to say.");
    expect(previewOf("# Technical Analysis & Market Indicator Report: NVDA\n\n**Analysis Date:** November 14, 2026\n\n### 1. Executive Summary\n\nAs of the close on November 13, 2026, NVIDIA Corporation (`NVDA`) traded at **$162.85**, marking a sharp extension. More.")).toBe(
      "As of the close on November 13, 2026, NVIDIA Corporation (NVDA) traded at $162.85, marking a sharp extension.",
    );
    expect(previewOf("*Short-term:* hold.")).toBe("Short-term: hold.");
    expect(previewOf("**Instrument Analyzed:** NVIDIA Corporation (`NVDA`) | **Exchange:** NMS | **Sector:** Technology / Semiconductors\n\nThe second week of November 2026 marks a turn. Then more.")).toBe(
      "The second week of November 2026 marks a turn.",
    );
    // A long bold-led line is a sentence, not a header field.
    expect(previewOf("**Rationale**: The debate over NVDA presents a tight balance between tactical oversold indicators and headwinds.")).toBe(
      "Rationale: The debate over NVDA presents a tight balance between tactical oversold indicators and headwinds.",
    );
    expect(previewOf("x".repeat(300)).length).toBe(200);
  });
});

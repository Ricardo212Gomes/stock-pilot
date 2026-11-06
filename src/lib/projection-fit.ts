import type { Classification } from "./valuation/classify";

// Which of the two projections suits a company, from the stock type the Intrinsic Value tool also uses.
// Both price a stock as EPS × a P/E range and leave dividends out of the CAGR; they differ in where they
// start (this year's consensus or the last report) and in how much of the income statement they model.

export type ProjectionTool = "jeremy-projection" | "plumas-projection" | "intrinsic-value";

export type ProjectionFit = {
  tool: ProjectionTool;
  // Why, for this company, in a sentence or two.
  reason: string;
};

// What each projection is best for, shown on both pages.
export const PROJECTION_GUIDE: Record<Exclude<ProjectionTool, "intrinsic-value">, { bestFor: string; how: string }> = {
  "jeremy-projection": {
    bestFor: "Growth stocks, and banks valued on earnings",
    how: "Starts from this year's analyst consensus. Revenue and net income grow at their own rates on today's share count, in bull, base and bear cases side by side.",
  },
  "plumas-projection": {
    bestFor: "Mature, dividend, buyback, cyclical and loss-making companies",
    how: "Starts from the last report, next to four reported years. Advanced mode builds profit from cost of revenue, operating expenses, interest and taxes, and counts buybacks.",
  },
};

// A yearly fall in the share count from this level on adds visibly to EPS.
const BUYBACK_THRESHOLD = 0.015;

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function recommendProjection(
  classification: Classification,
  { buybackYield, dividendYield }: { buybackYield: number | null; dividendYield: number | null },
): ProjectionFit {
  switch (classification.type) {
    case "highGrowth":
      return {
        tool: "jeremy-projection",
        reason: "Revenue growth drives the price, and this year's analyst consensus is the best place to start: Jeremy's Projection grows revenue and net income from it.",
      };
    case "financial":
      return {
        tool: "jeremy-projection",
        reason: "Banks and insurers are valued on earnings and a P/E, and report no cost of revenue for Plumas's Advanced mode to work with. The Intrinsic Value tool's residual income model is the usual cross-check.",
      };
    case "unprofitable":
      return {
        tool: "plumas-projection",
        reason: "Net income is a loss, and a growth rate can't be applied to a loss, so Jeremy's Projection can't run. Plumas's Advanced mode builds profit from revenue and costs.",
      };
    case "cyclical":
      return {
        tool: "plumas-projection",
        reason: "Margins swing with the cycle. Plumas shows four reported years to see where the cycle stands, and its Advanced mode sets cost of revenue and operating expenses on their own.",
      };
    case "dividend":
      return {
        tool: "plumas-projection",
        reason: `Mature payers grow slowly, so returns come from margins and buybacks, which Plumas's Advanced mode models. Neither projection counts dividends: add the${dividendYield === null ? "" : ` ${percent(dividendYield)}`} yield to the CAGR.`,
      };
    case "reit":
      return {
        tool: "intrinsic-value",
        reason: "A P/E says little about a REIT: depreciation shrinks its earnings while it pays out most of its cash. The Intrinsic Value tool's dividend model fits better than either projection.",
      };
    case "stable":
      return buybackYield !== null && buybackYield >= BUYBACK_THRESHOLD
        ? {
          tool: "plumas-projection",
          reason: `It buys back about ${percent(buybackYield)} of its shares a year, which lifts EPS beyond profit growth: only Plumas's Advanced mode counts buybacks.`,
        }
        : {
          tool: "jeremy-projection",
          reason: "Steady growth with a share count that barely moves: Jeremy's simpler revenue and net income model captures it.",
        };
  }
}

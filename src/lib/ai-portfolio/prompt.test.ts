import { describe, expect, it } from "vitest";
import { buildPortfolioPrompt, parseProposal, targetMayBeStale } from "./prompt";
import { candidate, scored } from "./test-helpers";
import { scoreCandidates } from "../recommendation-signals";

describe("parseProposal", () => {
  it("reads percentages as fractions, tidies tickers and keeps the first entry for each", () => {
    const proposal = parseProposal(JSON.stringify({
      summary: "  Adding to  quality. ",
      positions: [
        { symbol: "nvda", weight: 8, reason: "Strong ratings." },
        { symbol: "BRK.B", weight: "7.5%", reason: "Cheap" },
        { symbol: "NVDA", weight: 9, reason: "Again" },
        { symbol: "", weight: 5, reason: "No ticker" },
      ],
      exits: [{ symbol: "INTC", reason: "Ratings slipping." }, { symbol: "NVDA", reason: "Contradiction" }],
    }));
    expect(proposal).toEqual({
      summary: "Adding to quality.",
      targets: [
        { symbol: "NVDA", weight: 0.08, reason: "Strong ratings." },
        { symbol: "BRK-B", weight: 0.075, reason: "Cheap" },
      ],
      exits: [{ symbol: "INTC", reason: "Ratings slipping." }],
    });
  });

  it("keeps weights already written as fractions, and reads a fenced reply", () => {
    const text = "```json\n" + JSON.stringify({ summary: "", positions: Array.from({ length: 12 }, (_, index) => ({ symbol: `S${index}`, weight: 0.075, reason: "" })), exits: [] }) + "\n```";
    expect(parseProposal(text)?.targets[0].weight).toBe(0.075);
  });

  it("returns null for anything that isn't a portfolio", () => {
    expect(parseProposal("Sure! Here's a portfolio.")).toBeNull();
    expect(parseProposal(JSON.stringify({ summary: "x" }))).toBeNull();
  });
});

describe("buildPortfolioPrompt", () => {
  it("states the portfolio and gives each candidate's figures as percentages", () => {
    const [nvda, msft] = scored(["NVDA", "MSFT"]);
    const prompt = buildPortfolioPrompt({
      date: "2026-11-16",
      equity: 100_000,
      cash: 40_000,
      candidates: [{ ...nvda, held: { weight: 0.06, gain: 0.123 }, headlines: ["Nvidia beats"] }, { ...msft, held: null, headlines: [] }],
    });
    expect(prompt).toContain("Week of 2026-11-16. The portfolio is worth $100,000, with 40% in cash and 1 holdings.");
    expect(prompt).toContain("Holdings: NVDA.");
    expect(prompt).toContain('"upsideToConsensusTargetPct":25');
    expect(prompt).toContain('"held":{"weightPct":6,"gainPct":12.3}');
    expect(prompt).toContain('"headlines":["Nvidia beats"]');
  });
});

describe("targetMayBeStale", () => {
  it("flags a large upside on a stock well under its 200-day average", () => {
    // NVDA in November 2026: $162.85, a $320 consensus, a $204 200-day average.
    const fallen = candidate("NVDA", 162.85);
    const [nvda] = scoreCandidates([{ ...fallen, trend: { ...fallen.trend, sma200: 204.19 }, target: { consensus: 320, high: 515, low: 200 } }]);
    expect(targetMayBeStale(nvda)).toBe(true);
    // The test helper's stock: 25% upside and above its 200-day average.
    expect(targetMayBeStale(scored(["MSFT"])[0])).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { cleanSummary, summaryPrompt } from "./market-valuation-summary";

describe("market valuation summary", () => {
  it("names the index and lists the facts", () => {
    expect(summaryPrompt("ndx", ["Trailing P/E: 35.1"])).toBe("Index: Nasdaq-100\n- Trailing P/E: 35.1");
  });

  it("keeps plain text on one paragraph and cuts a long one at a sentence", () => {
    expect(cleanSummary("**Stocks** are\n\n expensive.")).toBe("Stocks are expensive.");
    const long = `${"A sentence about valuations. ".repeat(40)}`;
    const cut = cleanSummary(long);
    expect(cut.length).toBeLessThanOrEqual(700);
    expect(cut.endsWith(".")).toBe(true);
  });
});

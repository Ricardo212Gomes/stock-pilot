import { describe, expect, it } from "vitest";
import type { StatementTable } from "./financial-statements";
import { THREE_YEAR_KEYS, buildThreeYearPrompt, parseThreeYearResponse } from "./three-year-autofill";

function reply(entries: { key: string; value: unknown; rationale?: string }[]) {
  return JSON.stringify({ summary: "Steady growth.", assumptions: entries.map((entry) => ({ rationale: "Because.", ...entry })) });
}

describe("parseThreeYearResponse", () => {
  it("reads suggestions, rescales whole-number percentages and clamps to range", () => {
    const parsed = parseThreeYearResponse(reply([
      { key: "high.revenueGrowth", value: 8, rationale: "Revenue grew about 8% a year." },
      { key: "high.peRatio", value: 400 },
      { key: "sharesChange", value: -0.02 },
      { key: "price", value: 1 },
    ]));
    expect(parsed?.summary).toBe("Steady growth.");
    expect(parsed?.suggestions["high.revenueGrowth"]).toEqual({ value: 0.08, rationale: "Revenue grew about 8% a year." });
    expect(parsed?.suggestions["high.peRatio"]?.value).toBe(150);
    expect(parsed?.suggestions.sharesChange?.value).toBe(-0.02);
    expect(Object.keys(parsed?.suggestions ?? {})).not.toContain("price");
  });

  it("clamps an out-of-range decimal instead of reading it as a percentage", () => {
    const parsed = parseThreeYearResponse(reply([{ key: "high.netMargin", value: 0.8 }]));
    expect(parsed?.suggestions["high.netMargin"]?.value).toBe(0.6);
  });

  it("swaps a low case that ends up above the high case", () => {
    const parsed = parseThreeYearResponse(reply([
      { key: "low.peRatio", value: 30 },
      { key: "high.peRatio", value: 20 },
    ]));
    expect(parsed?.suggestions["low.peRatio"]?.value).toBe(20);
    expect(parsed?.suggestions["high.peRatio"]?.value).toBe(30);
  });

  it("rejects unreadable replies", () => {
    expect(parseThreeYearResponse("not json")).toBeNull();
    expect(parseThreeYearResponse(reply([{ key: "madeUp", value: 1 }]))).toBeNull();
  });
});

describe("buildThreeYearPrompt", () => {
  it("includes the price, every field with its default, and the company history", () => {
    const income: StatementTable = {
      statement: "income",
      period: "annual",
      currency: "USD",
      fiscalYear: null,
      columns: [{ id: "ttm", label: "TTM", periodEnding: "2026-06-27" }],
      rows: [{ id: "revenue", label: "Revenue", format: "money", emphasis: true, section: null, help: null, values: [466e9] }],
      chart: { title: "", labels: [], series: [], defaults: [] },
    };
    const defaults = {
      price: 346, revenue: 466e9, shares: 14.75e9, years: 3, sharesChange: -0.02, targetReturn: 0.15,
      low: { revenueGrowth: 0.03, netMargin: 0.25, peRatio: 25 },
      high: { revenueGrowth: 0.07, netMargin: 0.27, peRatio: 35 },
    };
    const prompt = buildThreeYearPrompt({ symbol: "AAPL", income, ratios: null, defaults });

    expect(prompt).toContain("3-year projection assumptions for AAPL, currently priced at 346 USD");
    for (const key of THREE_YEAR_KEYS) expect(prompt).toContain(`"key":"${key}"`);
    expect(prompt).toContain('"key":"high.peRatio","min":1,"max":150,"dataDefault":35');
    expect(prompt).toContain('"revenue":[["TTM",466000000000]]');
  });
});

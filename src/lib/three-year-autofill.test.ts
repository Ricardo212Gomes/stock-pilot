import { describe, expect, it } from "vitest";
import type { StatementTable } from "./financial-statements";
import { THREE_YEAR_KEYS, buildThreeYearPrompt, parseThreeYearResponse } from "./three-year-autofill";
import { buildProjectionDefaults } from "./three-year-projection";

function reply(entries: { key: string; value: unknown; rationale?: string }[]) {
  return JSON.stringify({ summary: "Steady growth.", assumptions: entries.map((entry) => ({ rationale: "Because.", ...entry })) });
}

describe("parseThreeYearResponse", () => {
  it("reads suggestions, rescales whole-number percentages and clamps to range", () => {
    const parsed = parseThreeYearResponse(reply([
      { key: "neutral.revenueGrowth", value: 8, rationale: "Revenue grew about 8% a year." },
      { key: "neutral.peHigh", value: 400 },
      { key: "price", value: 1 },
    ]));
    expect(parsed?.summary).toBe("Steady growth.");
    expect(parsed?.suggestions["neutral.revenueGrowth"]).toEqual({ value: 0.08, rationale: "Revenue grew about 8% a year." });
    expect(parsed?.suggestions["neutral.peHigh"]?.value).toBe(150);
    expect(Object.keys(parsed?.suggestions ?? {})).not.toContain("price");
  });

  it("clamps values below the range", () => {
    const parsed = parseThreeYearResponse(reply([{ key: "ultraBearish.revenueGrowth", value: -0.8 }, { key: "bearish.peLow", value: 0 }]));
    expect(parsed?.suggestions["ultraBearish.revenueGrowth"]?.value).toBe(-0.5);
    expect(parsed?.suggestions["bearish.peLow"]?.value).toBe(1);
  });

  it("swaps a low P/E above the high P/E, and keeps the scenarios in order", () => {
    const parsed = parseThreeYearResponse(reply([
      { key: "neutral.peLow", value: 30 },
      { key: "neutral.peHigh", value: 20 },
      { key: "bearish.revenueGrowth", value: 0.09, rationale: "Higher." },
      { key: "bullish.revenueGrowth", value: 0.02, rationale: "Lower." },
    ]));
    expect([parsed?.suggestions["neutral.peLow"]?.value, parsed?.suggestions["neutral.peHigh"]?.value]).toEqual([20, 30]);
    expect(parsed?.suggestions["bearish.revenueGrowth"]).toEqual({ value: 0.02, rationale: "Lower." });
    expect(parsed?.suggestions["bullish.revenueGrowth"]).toEqual({ value: 0.09, rationale: "Higher." });
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
      source: "fmp",
      currency: "USD",
      fiscalYear: null,
      columns: [{ id: "ttm", label: "TTM", periodEnding: "2026-06-27" }, { id: "2025-09-27", label: "FY 2025", periodEnding: "2025-09-27" }],
      rows: [
        { id: "revenue", label: "Revenue", format: "money", emphasis: true, section: null, help: null, values: [466e9, 416e9] },
        { id: "netIncome", label: "Net Income", format: "money", emphasis: true, section: null, help: null, values: [129e9, 112e9] },
        { id: "shares", label: "Shares", format: "shares", emphasis: false, section: null, help: null, values: [14.75e9, 14.9e9] },
      ],
      chart: { title: "", labels: [], series: [], defaults: [] },
    };
    const defaults = buildProjectionDefaults({ income, ratios: null, price: 346, currentYear: 2026 });
    const prompt = buildThreeYearPrompt({ symbol: "AAPL", income, ratios: null, defaults });

    expect(prompt).toContain("assumptions for AAPL for fiscal years 2026 to 2030, starting from fiscal 2025. It is currently priced at 346 USD");
    expect(THREE_YEAR_KEYS).toHaveLength(20);
    for (const key of THREE_YEAR_KEYS) expect(prompt).toContain(`"key":"${key}"`);
    expect(prompt).toContain('"key":"neutral.revenueGrowth","min":-0.5,"max":1,"dataDefault":0.05');
    expect(prompt).toContain('"revenue":[["TTM",466000000000],["FY 2025",416000000000]]');
  });
});

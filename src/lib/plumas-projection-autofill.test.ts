import { describe, expect, it } from "vitest";
import type { StatementTable } from "./financial-statements";
import { buildProjectionDefaults } from "./plumas-projection";
import { PROJECTION_AI_SCHEMA, buildProjectionPrompt, parseProjectionResponse } from "./plumas-projection-autofill";

function reply(scenarios: Record<string, unknown>[], summary = "Steady growth.") {
  return JSON.stringify({ summary, scenarios });
}

describe("parseProjectionResponse", () => {
  it("reads each scenario's yearly values, rescales whole-number percentages and clamps to range", () => {
    const parsed = parseProjectionResponse(reply([{
      id: "base",
      rationale: "Revenue grew about 10% a year.",
      revenueGrowth: [10, 9, 8.5, 8.5, 8],
      buybackYield: [0.01, 0.025, 0.025, 0.025, 0.025],
      otherGrowth: [-20, 0, 0, 0, 0],
      peHigh: [400, 20, 20, 20, 20],
    }, { id: "madeUp", revenueGrowth: [0.1, 0.1, 0.1, 0.1, 0.1] }]));

    expect(parsed?.summary).toBe("Steady growth.");
    expect(Object.keys(parsed?.scenarios ?? {})).toEqual(["base"]);
    expect(parsed?.scenarios.base).toEqual({
      rationale: "Revenue grew about 10% a year.",
      inputs: {
        revenueGrowth: [0.1, 0.09, 0.085, 0.085, 0.08],
        buybackYield: [0.01, 0.025, 0.025, 0.025, 0.025],
        otherGrowth: [-0.2, 0, 0, 0, 0],
        peHigh: [150, 20, 20, 20, 20],
      },
    });
  });

  it("pads short lists with their last value and keeps each year's P/E in order", () => {
    const parsed = parseProjectionResponse(reply([{
      id: "bearish",
      rationale: "Slower.",
      revenueGrowth: [0.04, 0.03],
      peLow: [20, 14, 14, 14, 14],
      peMid: [16, 16, 16, 16, 16],
      peHigh: [18, 18, 18, 18, 18],
    }]));
    expect(parsed?.scenarios.bearish?.inputs).toEqual({
      revenueGrowth: [0.04, 0.03, 0.03, 0.03, 0.03],
      peLow: [16, 14, 14, 14, 14],
      peMid: [18, 16, 16, 16, 16],
      peHigh: [20, 18, 18, 18, 18],
    });
  });

  it("rejects unreadable replies", () => {
    expect(parseProjectionResponse("not json")).toBeNull();
    expect(parseProjectionResponse(JSON.stringify({ summary: "x" }))).toBeNull();
    expect(parseProjectionResponse(reply([{ id: "base", revenueGrowth: "fast" }]))).toBeNull();
  });
});

describe("buildProjectionPrompt", () => {
  it("includes the company and its history, without the starting values to copy", () => {
    const income: StatementTable = {
      statement: "income",
      period: "annual",
      source: "fmp",
      currency: "USD",
      fiscalYear: null,
      columns: [
        { id: "ttm", label: "TTM", periodEnding: "2026-06-27" },
        { id: "2025-09-27", label: "FY 2025", periodEnding: "2025-09-27" },
        { id: "2024-09-28", label: "FY 2024", periodEnding: "2024-09-28" },
      ],
      rows: [
        { id: "revenue", label: "Revenue", format: "money", emphasis: true, section: null, help: null, values: [480e9, 416e9, 391e9] },
        { id: "netIncome", label: "Net Income", format: "money", emphasis: true, section: null, help: null, values: [120e9, 112e9, 94e9] },
        { id: "shares", label: "Shares", format: "shares", emphasis: false, section: null, help: null, values: [14.7e9, 14.9e9, 15.4e9] },
      ],
      chart: { title: "", labels: [], series: [], defaults: [] },
    };
    const estimates = [{
      date: "2026-09-26",
      revenue: { low: 440e9, avg: 450e9, high: 460e9 },
      netIncome: { low: null, avg: 125e9, high: null },
      eps: { low: 8.1, avg: 8.4, high: 8.8 },
      analysts: 30,
    }];
    const defaults = buildProjectionDefaults({ income, ratios: null, price: 250, shares: 14.8e9, estimates, today: new Date("2026-10-01T00:00:00Z") });
    const prompt = buildProjectionPrompt({ symbol: "AAPL", defaults });

    expect(prompt).toContain("Fill in the projection for AAPL: fiscal years 2026 to 2030, starting from fiscal 2025. Figures are in USD.");
    expect(prompt).toContain('"price":250,"sharesOutstandingToday":14800000000');
    expect(prompt).toContain('"reportsCostOfRevenue":false');
    expect(prompt).toContain('{"year":2025,"revenue":416000000000,"revenueGrowth":0.0639');
    // Fiscal 2026 ended on September 27, just before October 1: today's share count already covers it.
    expect(prompt).toContain('"monthsOfFirstYearAhead":0');
    expect(prompt).not.toContain('"base":{');
    expect(prompt).toContain(`Analysts' consensus (averages): [{"year":2026,"revenue":450000000000,"netIncome":125000000000,"eps":8.4,"analysts":30}]`);
    expect(buildProjectionPrompt({ symbol: "AAPL", defaults: { ...defaults, estimates: [] } })).toContain("There are no analysts' estimates for these years.");
  });

  it("asks for five values per field in every scenario", () => {
    const item = PROJECTION_AI_SCHEMA.properties.scenarios.items;
    expect(item.required).toEqual(["id", "rationale", "revenueGrowth", "netIncomeGrowth", "costGrowth", "opexGrowth", "otherGrowth", "buybackYield", "peLow", "peMid", "peHigh"]);
    expect((item.properties as Record<string, unknown>).peMid).toMatchObject({ type: "ARRAY", minItems: 5, maxItems: 5 });
  });
});

import { describe, expect, it } from "vitest";
import { bestIndex, computeComparison, MAX_COMPARED, parseSymbols, type ComparisonInputs } from "./stock-comparison";
import type { AnalystEstimate } from "./stock-overview";

function estimate(date: string, revenue: number, eps: number): AnalystEstimate {
  return {
    date,
    revenue: { low: null, avg: revenue, high: null },
    netIncome: { low: null, avg: null, high: null },
    eps: { low: null, avg: eps, high: null },
    analysts: 10,
  };
}

const quarters = [
  { date: "2026-09-30", revenue: 30, grossProfit: 15, netIncome: 3, epsDiluted: 0.3 },
  { date: "2026-06-30", revenue: 25, grossProfit: 12, netIncome: 2, epsDiluted: 0.2 },
  { date: "2026-03-31", revenue: 25, grossProfit: 12, netIncome: 2.5, epsDiluted: 0.25 },
  { date: "2025-12-31", revenue: 20, grossProfit: 9, netIncome: 2.5, epsDiluted: 0.25 },
  { date: "2025-09-30", revenue: 18, grossProfit: 8, netIncome: 1, epsDiluted: 0.1 },
];

const base: ComparisonInputs = {
  price: 50,
  marketCap: 500,
  quarters,
  annual: [
    { date: "2024-12-31", revenue: 80, epsDiluted: 0.8 },
    { date: "2025-12-31", revenue: 90, epsDiluted: 1 },
  ],
  estimates: [
    estimate("2024-12-31", 79, 0.79),
    estimate("2025-12-31", 89, 0.98),
    estimate("2026-12-31", 108, 1.2),
    estimate("2027-12-31", 129.6, 1.5),
  ],
  finnhub: { epsGrowthTTMYoy: 25, revenueGrowthTTMYoy: 12.5, epsGrowthQuarterlyYoy: 200, revenueGrowthQuarterlyYoy: 66.7 },
  today: new Date("2026-11-07T00:00:00Z"),
};

describe("computeComparison", () => {
  it("uses the fiscal year after the last report as this year, and the one after as next", () => {
    const { currentYear, nextYear, metrics } = computeComparison(base);
    expect(currentYear).toBe(2026);
    expect(nextYear).toBe(2027);
    expect(metrics.forwardPe).toBeCloseTo(50 / 1.2);
    expect(metrics.twoYearForwardPe).toBeCloseTo(50 / 1.5);
    expect(metrics.forwardPs).toBeCloseTo(500 / 108);
  });

  it("computes trailing multiples and margins from the last four quarters", () => {
    const { metrics } = computeComparison(base);
    expect(metrics.ttmPe).toBeCloseTo(50);
    expect(metrics.ttmPs).toBeCloseTo(5);
    expect(metrics.grossMargin).toBeCloseTo(0.48);
    expect(metrics.netMargin).toBeCloseTo(0.1);
  });

  it("measures expected growth against reported and estimated years", () => {
    const { metrics } = computeComparison(base);
    expect(metrics.currentYearEpsGrowth).toBeCloseTo(0.2);
    expect(metrics.nextYearEpsGrowth).toBeCloseTo(0.25);
    expect(metrics.twoYearEpsGrowth).toBeCloseTo(0.5);
    expect(metrics.currentYearRevenueGrowth).toBeCloseTo(0.2);
    expect(metrics.twoYearRevenueGrowth).toBeCloseTo(0.44);
    expect(metrics.lastYearEpsGrowth).toBeCloseTo(0.25);
    expect(metrics.lastYearRevenueGrowth).toBeCloseTo(0.125);
  });

  it("takes trailing growth from Finnhub, and the latest quarter's from the statements", () => {
    const { metrics } = computeComparison(base);
    expect(metrics.ttmEpsGrowth).toBeCloseTo(0.25);
    expect(metrics.ttmRevenueGrowth).toBeCloseTo(0.125);
    expect(metrics.latestQuarterEpsGrowth).toBeCloseTo(2);
    expect(metrics.latestQuarterRevenueGrowth).toBeCloseTo(30 / 18 - 1);
  });

  it("falls back to Finnhub's quarterly growth without a quarter a year back", () => {
    const { metrics } = computeComparison({ ...base, quarters: quarters.slice(0, 4) });
    expect(metrics.latestQuarterEpsGrowth).toBeCloseTo(2);
    expect(metrics.latestQuarterRevenueGrowth).toBeCloseTo(0.667);
  });

  it("weights this year's and next year's estimates by the time left for the next twelve months", () => {
    const { metrics } = computeComparison(base);
    // 54 of 365 days left in fiscal 2026.
    const left = 54 / 365;
    expect(metrics.ttmVsNtmEpsGrowth).toBeCloseTo((1.2 * left + 1.5 * (1 - left)) / 1 - 1);
  });

  it("leaves multiples of a loss and growth from a loss blank", () => {
    const losing = quarters.map((row) => ({ ...row, netIncome: -1, epsDiluted: -0.1 }));
    const { metrics } = computeComparison({ ...base, quarters: losing, annual: [{ date: "2024-12-31", epsDiluted: -0.5 }, { date: "2025-12-31", epsDiluted: 1 }] });
    expect(metrics.ttmPe).toBeNull();
    expect(metrics.ttmVsNtmEpsGrowth).toBeNull();
    expect(metrics.lastYearEpsGrowth).toBeNull();
  });

  it("leaves forward rows blank without estimates, and falls back to Finnhub without statements", () => {
    const { currentYear, metrics } = computeComparison({
      ...base,
      quarters: [],
      estimates: [],
      finnhub: { peTTM: 63.4, psTTM: 2.69, grossMarginTTM: 48.76, netProfitMarginTTM: 4.24 },
    });
    expect(currentYear).toBeNull();
    expect(metrics.forwardPe).toBeNull();
    expect(metrics.currentYearEpsGrowth).toBeNull();
    expect(metrics.ttmPe).toBeCloseTo(63.4);
    expect(metrics.ttmPs).toBeCloseTo(2.69);
    expect(metrics.grossMargin).toBeCloseTo(0.4876);
    expect(metrics.netMargin).toBeCloseTo(0.0424);
  });

  it("matches estimates whose dates differ slightly from the report's", () => {
    const { currentYear } = computeComparison({
      ...base,
      annual: [{ date: "2025-09-27", revenue: 90, epsDiluted: 1 }],
      estimates: [estimate("2025-09-30", 89, 0.98), estimate("2026-09-26", 100, 1.1)],
    });
    expect(currentYear).toBe(2026);
  });
});

describe("bestIndex", () => {
  it("picks the lowest multiple and the highest growth", () => {
    expect(bestIndex([30, 20, null, 25], "multiple")).toBe(1);
    expect(bestIndex([0.1, -0.2, 0.3], "growth")).toBe(2);
    expect(bestIndex([0.4, 0.6], "margin")).toBe(1);
  });

  it("needs two values to compare", () => {
    expect(bestIndex([null, 12, null], "multiple")).toBeNull();
  });
});

describe("parseSymbols", () => {
  it("upper-cases, de-duplicates and caps the list", () => {
    expect(parseSymbols("celh, mnst,KO,celh")).toEqual(["CELH", "MNST", "KO"]);
    expect(parseSymbols(["AAPL,MSFT", "GOOGL"])).toEqual(["AAPL", "MSFT", "GOOGL"]);
    expect(parseSymbols("A,B,C,D,E,F,G")).toHaveLength(MAX_COMPARED);
    expect(parseSymbols("$$$, ,BRK-B")).toEqual(["BRK-B"]);
    expect(parseSymbols(undefined)).toEqual([]);
  });
});

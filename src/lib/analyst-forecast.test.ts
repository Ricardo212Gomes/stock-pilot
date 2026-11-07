import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEstimateYears,
  countActions,
  getAnalystForecast,
  parseFinnhubEarnings,
  parseFmpEarnings,
  parseGrades,
  parseTargets,
  parseTargetTrend,
  surprise,
  withCalendarDate,
  yearGrowth,
} from "./analyst-forecast";
import type { AnalystEstimate } from "./stock-overview";

function estimate(date: string, revenue: number, eps: number, analysts = 20): AnalystEstimate {
  return {
    date,
    revenue: { low: revenue * 0.9, avg: revenue, high: revenue * 1.1 },
    netIncome: { low: null, avg: null, high: null },
    eps: { low: eps * 0.9, avg: eps, high: eps * 1.1 },
    analysts,
  };
}

describe("price targets", () => {
  it("reads the consensus and the trend of average targets", () => {
    expect(parseTargets([{ targetConsensus: 344.46, targetMedian: 355, targetHigh: 400, targetLow: 245 }])).toEqual({ consensus: 344.46, median: 355, high: 400, low: 245 });
    expect(parseTargets([])).toBeNull();
    expect(parseTargetTrend([{ lastMonthCount: 12, lastMonthAvgPriceTarget: 349.42, lastQuarterCount: 0, lastQuarterAvgPriceTarget: 0, lastYearCount: 61, lastYearAvgPriceTarget: 330.27 }])).toEqual([
      { label: "Last month", count: 12, average: 349.42 },
      { label: "Last year", count: 61, average: 330.27 },
    ]);
  });
});

describe("buildEstimateYears", () => {
  it("puts the last two reported years before the estimates for the years after them", () => {
    const income = [
      { date: "2024-09-28", revenue: 391e9, epsDiluted: 6.08 },
      { date: "2025-09-27", revenue: 416e9, epsDiluted: 7.46 },
      { date: "2026-09-26", revenue: 479e9, epsDiluted: 8.98 },
    ];
    const years = buildEstimateYears([estimate("2026-09-26", 470e9, 8.8), estimate("2027-09-26", 526e9, 9.46), estimate("2028-09-26", 566e9, 10.46)], income);
    expect(years.map((year) => [year.year, year.reported, year.revenue, year.eps, year.analysts])).toEqual([
      [2025, true, 416e9, 7.46, null],
      [2026, true, 479e9, 8.98, null],
      [2027, false, 526e9, 9.46, 20],
      [2028, false, 566e9, 10.46, 20],
    ]);
    expect(years[2]).toMatchObject({ revenueLow: 526e9 * 0.9, epsHigh: 9.46 * 1.1 });
  });

  it("grows from one year to the next, but not from a loss", () => {
    expect(yearGrowth(110, 100)).toBeCloseTo(0.1);
    expect(yearGrowth(5, -2)).toBeNull();
    expect(yearGrowth(null, 100)).toBeNull();
  });
});

describe("rating changes", () => {
  const rows = [
    { date: "2026-10-01", gradingCompany: "Morgan Stanley", previousGrade: "Equal-Weight", newGrade: "Overweight", action: "upgrade" },
    { date: "2026-11-04", gradingCompany: "Bernstein", previousGrade: "Buy", newGrade: "Buy", action: "maintain" },
    { date: "2026-06-01", gradingCompany: "Jefferies", previousGrade: "Buy", newGrade: "Hold", action: "downgrade" },
    { date: "2026-09-15", gradingCompany: "Loop Capital", previousGrade: null, newGrade: "Buy", action: "initialise" },
    { date: "2026-09-15", gradingCompany: "", newGrade: "Buy", action: "maintain" },
  ];

  it("reads each action, newest first", () => {
    expect(parseGrades(rows).map((action) => [action.date, action.firm, action.action, action.previous, action.grade])).toEqual([
      ["2026-11-04", "Bernstein", "maintain", "Buy", "Buy"],
      ["2026-10-01", "Morgan Stanley", "upgrade", "Equal-Weight", "Overweight"],
      ["2026-09-15", "Loop Capital", "initiate", null, "Buy"],
      ["2026-06-01", "Jefferies", "downgrade", "Buy", "Hold"],
    ]);
  });

  it("counts the last 90 days", () => {
    expect(countActions(parseGrades(rows), "2026-08-09")).toEqual({ upgrades: 1, downgrades: 0, maintains: 1 });
  });
});

describe("earnings", () => {
  const fmpRows = [
    { date: "2027-02-04", epsEstimated: 2.94, epsActual: null, revenueEstimated: 156e9, revenueActual: null },
    { date: "2026-11-02", epsEstimated: 1.99, epsActual: 2.05, revenueEstimated: 113.4e9, revenueActual: 115e9 },
    { date: "2026-07-30", epsEstimated: 1.89, epsActual: 2.02, revenueEstimated: 109e9, revenueActual: 108e9 },
  ];

  it("splits FMP's rows into the next report and the reported ones", () => {
    const earnings = parseFmpEarnings(fmpRows, "2026-11-07")!;
    expect(earnings.source).toBe("fmp");
    expect(earnings.upcoming).toMatchObject({ date: "2027-02-04", epsEstimate: 2.94, revenueEstimate: 156e9 });
    expect(earnings.past.map((report) => report.date)).toEqual(["2026-11-02", "2026-07-30"]);
    expect(parseFmpEarnings([], "2026-11-07")).toBeNull();
  });

  it("reads Finnhub's quarters, which only give the quarter's end", () => {
    const earnings = parseFinnhubEarnings([
      { period: "2026-06-30", estimate: 1.93, actual: 1.91 },
      { period: "2026-09-30", estimate: 2.03, actual: 2.05 },
    ])!;
    expect(earnings.past.map((report) => [report.date, report.dateIsQuarterEnd, report.epsActual])).toEqual([
      ["2026-09-30", true, 2.05],
      ["2026-06-30", true, 1.91],
    ]);
  });

  it("dates the next report from Finnhub's calendar, as the Overview does, keeping FMP's estimates", () => {
    const fmp = parseFmpEarnings(fmpRows, "2026-11-07");
    const reports = [{ date: "2026-10-30", time: "amc" as const, year: 2026, quarter: 4 }, { date: "2027-01-27", time: "unknown" as const, year: 2027, quarter: 1 }];
    expect(withCalendarDate(fmp, reports, "2026-11-07")?.upcoming).toMatchObject({ date: "2027-01-27", epsEstimate: 2.94 });
    expect(withCalendarDate(null, reports, "2026-11-07")).toMatchObject({ upcoming: { date: "2027-01-27", epsEstimate: null }, past: [] });
    expect(withCalendarDate(fmp, null, "2026-11-07")?.upcoming?.date).toBe("2027-02-04");
  });

  it("measures the surprise against the estimate", () => {
    expect(surprise(2.05, 2)).toBeCloseTo(0.025);
    expect(surprise(-0.9, -1)).toBeCloseTo(0.1);
    expect(surprise(1, 0)).toBeNull();
  });
});

describe("getAnalystForecast", () => {
  beforeEach(() => {
    vi.stubEnv("FMP_API_KEY", "fmp-key");
    vi.stubEnv("FINNHUB_API_KEY", "finnhub-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("falls back to Finnhub for everything when FMP's plan doesn't cover the company", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      if (url.hostname === "finnhub.io") {
        return url.pathname.endsWith("/stock/recommendation")
          ? Response.json([{ period: "2026-11-01", strongBuy: 18, buy: 35, hold: 4, sell: 0, strongSell: 0 }])
          : Response.json([{ period: "2026-08-31", estimate: 1.2, actual: 1.5 }]);
      }
      return new Response("Premium Query Parameter", { status: 402 });
    }));
    const forecast = await getAnalystForecast("MU", new Date("2026-11-07T12:00:00Z"));
    expect(forecast.fmpCovered).toBe(false);
    expect(forecast.targets).toBeNull();
    expect(forecast.closes).toEqual([]);
    expect(forecast.ratings).toMatchObject({ total: 57, label: "Buy" });
    expect(forecast.earnings).toMatchObject({ source: "finnhub", upcoming: null, past: [{ date: "2026-08-31", epsActual: 1.5 }] });
  });
});

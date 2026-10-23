import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildStatementTable,
  fiscalYearLabel,
  getStatementTable,
  stripTtmSuffix,
  sumTrailingQuarters,
  type StatementTable,
} from "./financial-statements";
import { getCompanyFundamentals } from "./fmp";

type Row = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const annualIncome: Row[] = [2025, 2024, 2023].map((year, index) => ({
  date: `${year}-09-27`, fiscalYear: String(year), period: "FY", reportedCurrency: "USD",
  revenue: [416e9, 391e9, 383e9][index], grossProfit: [195e9, 180e9, 169e9][index],
  operatingIncome: [133e9, 123e9, 114e9][index], netIncome: [112e9, 93.7e9, 97e9][index],
  epsDiluted: [7.46, 6.08, 6.13][index], weightedAverageShsOutDil: [15e9, 15.4e9, 15.8e9][index],
  inventory: 0,
}));

const quarters: Row[] = [
  ["2026-06-27", "Q3", "2026", 109e9, 29.8e9, 2.03, 14.8e9],
  ["2026-03-28", "Q2", "2026", 111e9, 29.6e9, 2.01, 14.9e9],
  ["2025-12-27", "Q1", "2026", 144e9, 42.1e9, 2.84, 15e9],
  ["2025-09-27", "Q4", "2025", 102e9, 27.5e9, 1.85, 15e9],
  ["2025-06-28", "Q3", "2025", 94e9, 23.4e9, 1.57, 15.1e9],
].map(([date, period, fiscalYear, revenue, netIncome, epsDiluted, shares]) => ({
  date, period, fiscalYear, reportedCurrency: "USD", revenue, netIncome, epsDiluted, weightedAverageShsOutDil: shares,
}));

const annualBalance: Row[] = annualIncome.map((row, index) => ({
  date: row.date, fiscalYear: row.fiscalYear, period: "FY",
  cashAndShortTermInvestments: [55e9, 65e9, 61e9][index], totalDebt: [98e9, 106e9, 111e9][index],
  totalStockholdersEquity: [74e9, 57e9, 62e9][index], totalAssets: [359e9, 365e9, 352e9][index],
  inventory: 0,
}));

const quarterlyBalance: Row[] = [{ date: "2026-06-27", period: "Q3", cashAndShortTermInvestments: 50e9, totalDebt: 90e9, totalStockholdersEquity: 80e9 }];

function build(overrides: Partial<Parameters<typeof buildStatementTable>[0]> = {}): StatementTable {
  return buildStatementTable({
    statement: "income",
    period: "annual",
    income: annualIncome,
    balance: annualBalance,
    cash: [],
    ratios: [],
    quarterlyIncome: quarters,
    quarterlyBalance,
    quarterlyCash: [],
    ratiosTtm: null,
    ...overrides,
  });
}

function row(table: StatementTable, id: string) {
  const found = table.rows.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`row ${id} missing`);
  return found.values;
}

describe("sumTrailingQuarters", () => {
  it("adds up the last four quarters but keeps the latest share count", () => {
    const ttm = sumTrailingQuarters([...quarters].reverse());
    expect(ttm?.revenue).toBeCloseTo(466e9);
    expect(ttm?.epsDiluted).toBeCloseTo(8.73);
    expect(ttm?.weightedAverageShsOutDil).toBe(14.8e9);
    expect(ttm?.date).toBe("2026-06-27");
  });

  it("needs four quarters", () => {
    expect(sumTrailingQuarters(quarters.slice(0, 3))).toBeNull();
  });
});

describe("helpers", () => {
  it("strips the TTM suffix from ratio keys", () => {
    expect(stripTtmSuffix({ priceToEarningsRatioTTM: 39.5, symbol: "AAPL" })).toEqual({ priceToEarningsRatio: 39.5, symbol: "AAPL" });
    expect(stripTtmSuffix(undefined)).toBeNull();
  });

  it("describes the fiscal year from its last month", () => {
    expect(fiscalYearLabel(annualIncome)).toBe("October - September");
    expect(fiscalYearLabel(quarters)).toBe("October - September");
    expect(fiscalYearLabel([{ date: "2025-12-31", period: "FY" }])).toBe("January - December");
    expect(fiscalYearLabel([])).toBeNull();
  });
});

describe("buildStatementTable", () => {
  it("leads with TTM, then fiscal years newest first", () => {
    const table = build();
    expect(table.columns.map((column) => column.label)).toEqual(["TTM", "FY 2025", "FY 2024", "FY 2023"]);
    expect(table.columns[0].periodEnding).toBe("2026-06-27");
    expect(table.fiscalYear).toBe("October - September");
    expect(table.currency).toBe("USD");
  });

  it("computes year-over-year growth and margins", () => {
    const table = build();
    const growth = row(table, "revenueGrowth");
    expect(growth[0]).toBeNull();
    expect(growth[1]).toBeCloseTo(416 / 391 - 1);
    expect(growth[3]).toBeNull();
    expect(row(table, "revenue")[0]).toBeCloseTo(466e9);
    expect(row(table, "grossMargin")[1]).toBeCloseTo(195 / 416);
    expect(row(table, "netIncomeGrowth")[2]).toBeCloseTo(93.7 / 97 - 1);
  });

  it("drops rows a company never reports, including all-zero rows", () => {
    const ids = build().rows.map((item) => item.id);
    expect(ids).not.toContain("research");
    expect(ids).toContain("eps");
    expect(build({ statement: "balance" }).rows.map((item) => item.id)).not.toContain("inventory");
  });

  it("orders chart data oldest first with TTM last", () => {
    const { chart } = build();
    expect(chart.title).toBe("Revenue & Profits");
    expect(chart.labels).toEqual(["FY 2023", "FY 2024", "FY 2025", "TTM"]);
    expect(chart.series.find((item) => item.id === "revenue")?.values[3]).toBeCloseTo(466e9);
    expect(chart.defaults).toEqual(["revenue", "netIncome"]);
  });

  it("uses the latest quarter as the current balance sheet", () => {
    const table = build({ statement: "balance" });
    expect(table.columns[0]).toMatchObject({ label: "Current", periodEnding: "2026-06-27" });
    expect(row(table, "netCash")[0]).toBeCloseTo(-40e9);
    expect(row(table, "netCash")[1]).toBeCloseTo(-43e9);
    expect(row(table, "bookValuePerShare")[1]).toBeCloseTo(74e9 / 15e9);
  });

  it("doesn't repeat the newest quarter as Current in the quarterly balance sheet", () => {
    const table = build({ statement: "balance", period: "quarterly", income: quarters, balance: quarterlyBalance });
    expect(table.columns.map((column) => column.label)).toEqual(["Q3 2026"]);
  });

  it("compares quarters with the same quarter a year earlier", () => {
    const table = build({ period: "quarterly", income: quarters, balance: [] });
    expect(table.columns.map((column) => column.label)).toEqual(["TTM", "Q3 2026", "Q2 2026", "Q1 2026", "Q4 2025", "Q3 2025"]);
    const growth = row(table, "revenueGrowth");
    expect(growth[1]).toBeCloseTo(109 / 94 - 1);
    expect(growth.slice(2).every((value) => value === null)).toBe(true);
    // The chart leaves the TTM total out next to single quarters.
    expect(table.chart.labels).toEqual(["Q3 2025", "Q4 2025", "Q1 2026", "Q2 2026", "Q3 2026"]);
  });

  it("groups ratios into sections and fills TTM valuation from ratios-ttm", () => {
    const table = build({
      statement: "ratios",
      ratios: [{ date: "2025-09-27", priceToEarningsRatio: 31 }],
      ratiosTtm: stripTtmSuffix({ priceToEarningsRatioTTM: 39.5 }),
    });
    expect(row(table, "pe").slice(0, 2)).toEqual([39.5, 31]);
    expect(table.rows.filter((item) => item.section).map((item) => item.section)).toEqual(["Valuation", "Profitability", "Financial health"]);
    expect(row(table, "roe")[1]).toBeCloseTo(112 / 74);
  });

  it("omits the TTM column when there aren't four quarters", () => {
    expect(build({ quarterlyIncome: quarters.slice(0, 2) }).columns[0].label).toBe("FY 2025");
  });
});

describe("getStatementTable", () => {
  function mockFmp(routes: Record<string, unknown | (() => Response)>) {
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      void init;
      const url = new URL(input);
      const key = `${url.pathname.replace("/stable/", "")}:${url.searchParams.get("period") ?? ""}`;
      const route = routes[key] ?? routes[url.pathname.replace("/stable/", "")];
      if (route === undefined) return json([]);
      return typeof route === "function" ? (route as () => Response)() : json(route);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  beforeEach(() => vi.stubEnv("FMP_API_KEY", "fmp-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("builds the annual table and skips quarterly ratios", async () => {
    const fetchMock = mockFmp({
      "income-statement:annual": annualIncome,
      "income-statement:quarter": quarters,
      "ratios-ttm": [{ priceToEarningsRatioTTM: 39.5 }],
    });
    const result = await getStatementTable("AAPL", "income", "annual");
    expect(result.ok && result.data.columns[0].label).toBe("TTM");

    const quarterly = await getStatementTable("AAPL", "ratios", "quarterly");
    expect(quarterly.ok && quarterly.data.period).toBe("quarterly");
    const ratioCalls = fetchMock.mock.calls.filter(([input]) => new URL(input).pathname === "/stable/ratios");
    expect(ratioCalls.map(([input]) => new URL(input).searchParams.get("period"))).toEqual(["annual"]);
  });

  it("shares cached requests with the fundamentals loader", async () => {
    const fetchMock = mockFmp({ "income-statement:annual": annualIncome });
    await getStatementTable("AAPL", "income", "annual");
    await getCompanyFundamentals("AAPL");

    const annualUrls = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes("/income-statement") && url.includes("period=annual"));
    expect(new Set(annualUrls).size).toBe(1);
  });

  it("reports income statement failures", async () => {
    mockFmp({ "income-statement:annual": () => json({ "Error Message": "Limit Reach" }, 429) });
    await expect(getStatementTable("AAPL", "income", "annual")).resolves.toEqual({ ok: false, reason: "rate-limited" });

    mockFmp({ "income-statement:annual": [] });
    await expect(getStatementTable("AAPL", "income", "annual")).resolves.toEqual({ ok: false, reason: "no-data" });
  });
});

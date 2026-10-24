import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSecStatements, resetSecCache, statementsFromFacts } from "./sec";

// A company with a fiscal year ending January 31, like CrowdStrike, in millions to keep it readable.
const M = 1e6;
type FactInput = { start?: string; end: string; val: number; fy?: number; fp?: string; form?: string; filed: string; accn?: string };
const fact = (input: FactInput) => ({ form: "10-K", accn: `acc-${input.filed}`, ...input });

const tenK2026 = { filed: "2026-03-10", fy: 2026, fp: "FY", form: "10-K" };
const tenK2025 = { filed: "2025-03-10", fy: 2024, fp: "FY", form: "10-K" }; // The SEC's fiscal year is wrong here.
const q1 = { filed: "2025-06-01", fy: 2026, fp: "Q1", form: "10-Q" };
const q2 = { filed: "2025-09-01", fy: 2026, fp: "Q2", form: "10-Q" };
const q3 = { filed: "2025-12-01", fy: 2026, fp: "Q3", form: "10-Q" };
const q1Next = { filed: "2026-06-01", fy: 2027, fp: "Q1", form: "10-Q" };

const facts = {
  entityName: "Example Corp",
  facts: {
    "us-gaap": {
      // The company switched revenue concepts in fiscal 2026.
      Revenues: { units: { USD: [fact({ start: "2024-02-01", end: "2025-01-31", val: 3000 * M, ...tenK2025 })] } },
      RevenueFromContractWithCustomerIncludingAssessedTax: { units: { USD: [
        fact({ start: "2025-02-01", end: "2026-01-31", val: 4000 * M, ...tenK2026 }),
        fact({ start: "2025-02-01", end: "2025-04-30", val: 900 * M, ...q1 }),
        fact({ start: "2025-05-01", end: "2025-07-31", val: 950 * M, ...q2 }),
        fact({ start: "2025-08-01", end: "2025-10-31", val: 1000 * M, ...q3 }),
        fact({ start: "2025-02-01", end: "2025-10-31", val: 2850 * M, ...q3 }),
        fact({ start: "2026-02-01", end: "2026-04-30", val: 1200 * M, ...q1Next }),
      ] } },
      NetIncomeLoss: { units: { USD: [
        fact({ start: "2024-02-01", end: "2025-01-31", val: -20 * M, ...tenK2025 }),
        fact({ start: "2024-02-01", end: "2025-01-31", val: -20 * M, ...tenK2026 }),
        fact({ start: "2025-02-01", end: "2026-01-31", val: 100 * M, ...tenK2026 }),
        fact({ start: "2025-02-01", end: "2025-04-30", val: 10 * M, ...q1 }),
        fact({ start: "2025-05-01", end: "2025-07-31", val: 20 * M, ...q2 }),
        fact({ start: "2025-08-01", end: "2025-10-31", val: 30 * M, ...q3 }),
        fact({ start: "2025-02-01", end: "2025-10-31", val: 60 * M, ...q3 }),
        // Restated a year later.
        fact({ start: "2025-02-01", end: "2025-04-30", val: 12 * M, ...q1Next }),
        fact({ start: "2026-02-01", end: "2026-04-30", val: 50 * M, ...q1Next }),
      ] } },
      // A 4-for-1 split on 2026-05-15: the June 10-Q is the first filing on the new basis.
      StockholdersEquityNoteStockSplitConversionRatio1: { units: { pure: [fact({ end: "2026-05-15", val: 4, ...q1Next })] } },
      WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [
        fact({ start: "2025-02-01", end: "2026-01-31", val: 250 * M, ...tenK2026 }),
        fact({ start: "2026-02-01", end: "2026-04-30", val: 1000 * M, ...q1Next }),
      ] } },
      EarningsPerShareDiluted: { units: { "USD/shares": [
        fact({ start: "2025-02-01", end: "2026-01-31", val: 0.4, ...tenK2026 }),
        fact({ start: "2026-02-01", end: "2026-04-30", val: 0.05, ...q1Next }),
      ] } },
      PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: [fact({ start: "2025-02-01", end: "2026-01-31", val: 300 * M, ...tenK2026 })] } },
      // Cash flows come year to date in 10-Qs: three, six and nine months, then the year.
      NetCashProvidedByUsedInOperatingActivities: { units: { USD: [
        fact({ start: "2025-02-01", end: "2026-01-31", val: 1500 * M, ...tenK2026 }),
        fact({ start: "2025-02-01", end: "2025-04-30", val: 300 * M, ...q1 }),
        fact({ start: "2025-02-01", end: "2025-07-31", val: 700 * M, ...q2 }),
        fact({ start: "2025-02-01", end: "2025-10-31", val: 1100 * M, ...q3 }),
      ] } },
      CashAndCashEquivalentsAtCarryingValue: { units: { USD: [fact({ end: "2026-01-31", val: 5000 * M, ...tenK2026 })] } },
      LongTermDebtNoncurrent: { units: { USD: [fact({ end: "2026-01-31", val: 700 * M, ...tenK2026 })] } },
      LongTermDebtCurrent: { units: { USD: [fact({ end: "2026-01-31", val: 50 * M, ...tenK2026 })] } },
      // An 8-K is ignored.
      Assets: { units: { USD: [fact({ end: "2026-01-31", val: 11000 * M, ...tenK2026 }), fact({ end: "2026-01-31", val: 1, form: "8-K", filed: "2026-03-20" })] } },
    },
  },
};

describe("statementsFromFacts", () => {
  const statements = statementsFromFacts(facts)!;

  it("builds annual rows shaped like FMP's, picking each year's concept and the latest filing", () => {
    expect(statements.name).toBe("Example Corp");
    const [latest, earlier] = statements.annual.income;
    expect(latest).toMatchObject({ date: "2026-01-31", fiscalYear: "2026", period: "FY", reportedCurrency: "USD", revenue: 4000 * M, netIncome: 100 * M });
    // The fiscal year counts back from the newest 10-K, not the SEC's inconsistent field.
    expect(earlier).toMatchObject({ date: "2025-01-31", fiscalYear: "2025", revenue: 3000 * M, netIncome: -20 * M });
  });

  it("restates share counts and EPS filed before a split", () => {
    const [latest] = statements.annual.income;
    expect(latest.weightedAverageShsOutDil).toBe(1000 * M);
    expect(latest.epsDiluted).toBeCloseTo(0.1);
    expect(statements.quarterly.income[0]).toMatchObject({ date: "2026-04-30", period: "Q1", fiscalYear: "2027", weightedAverageShsOutDil: 1000 * M, epsDiluted: 0.05 });
  });

  it("derives the fourth quarter as the year minus the first nine months", () => {
    const quarters = statements.quarterly.income.map((row) => [row.period, row.fiscalYear, row.netIncome]);
    expect(quarters).toEqual([
      ["Q1", "2027", 50 * M],
      ["Q4", "2026", 40 * M],
      ["Q3", "2026", 30 * M],
      ["Q2", "2026", 20 * M],
      ["Q1", "2026", 12 * M],
    ]);
    expect(statements.quarterly.income[1].revenue).toBe(1150 * M);
    // A derived quarter has no reported EPS: net income over the year's diluted shares.
    expect(statements.quarterly.income[1].epsDiluted).toBeCloseTo(0.04);
  });

  it("turns year-to-date cash flows into quarters", () => {
    expect(statements.quarterly.cash.map((row) => [row.period, row.operatingCashFlow])).toEqual([
      ["Q1", null],
      ["Q4", 400 * M],
      ["Q3", 400 * M],
      ["Q2", 400 * M],
      ["Q1", 300 * M],
    ]);
  });

  it("signs payments as FMP does and derives totals", () => {
    expect(statements.annual.cash[0]).toMatchObject({ capitalExpenditure: -300 * M, operatingCashFlow: 1500 * M, freeCashFlow: 1200 * M });
    expect(statements.annual.balance[0]).toMatchObject({
      cashAndShortTermInvestments: 5000 * M, shortTermDebt: 50 * M, totalDebt: 750 * M, totalAssets: 11000 * M, netDebt: -4250 * M,
    });
  });

  it("returns nothing without US GAAP facts", () => {
    expect(statementsFromFacts({ facts: {} })).toBeNull();
    expect(statementsFromFacts(null)).toBeNull();
  });
});

describe("getSecStatements", () => {
  beforeEach(() => resetSecCache());
  afterEach(() => vi.unstubAllGlobals());

  it("finds the CIK, identifies itself to the SEC and caches the converted rows", async () => {
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith("company_tickers.json")) return Response.json({ 0: { cik_str: 1535527, ticker: "CRWD", title: "CrowdStrike" } });
      return Response.json(facts);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSecStatements("CRWD");
    expect(result.ok && result.data.annual.income[0].revenue).toBe(4000 * M);
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://data.sec.gov/api/xbrl/companyfacts/CIK0001535527.json");
    expect(new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers).get("User-Agent")).toMatch(/StockPilot/);

    await getSecStatements("CRWD");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(getSecStatements("ZZZZ")).resolves.toEqual({ ok: false, reason: "not-found" });
  });
});

import type { AnnualFinancialSummary, CompanyProfile } from "@/lib/fmp";
import type { Assumptions } from "./assumptions";

export function annual(overrides: Partial<AnnualFinancialSummary> = {}): AnnualFinancialSummary {
  return {
    date: "2024-12-31",
    fiscalYear: "2024",
    period: "FY",
    currency: "USD",
    revenue: 1000,
    revenueGrowth: 0.05,
    grossProfit: 400,
    grossMargin: 0.4,
    operatingIncome: 200,
    operatingMargin: 0.2,
    netIncome: 100,
    netMargin: 0.1,
    eps: 1,
    sharesDiluted: 100,
    totalDebt: 200,
    cash: 50,
    netDebt: 150,
    equity: 500,
    debtToEquity: 0.4,
    currentRatio: 1.5,
    interestCoverage: 10,
    operatingCashFlow: 150,
    freeCashFlow: 120,
    capitalExpenditure: -30,
    dividendPerShare: 0.3,
    dividendYield: 0.015,
    peRatio: 18,
    psRatio: 2,
    pfcfRatio: 15,
    ...overrides,
  };
}

// Five fiscal years, newest first, with revenue growing at `growth` a year.
export function history(growth: number, overrides: Partial<AnnualFinancialSummary> = {}): AnnualFinancialSummary[] {
  return Array.from({ length: 5 }, (_, index) => annual({
    fiscalYear: String(2024 - index),
    date: `${2024 - index}-12-31`,
    revenue: 1000 / (1 + growth) ** index,
    ...overrides,
  }));
}

export function profile(overrides: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    symbol: "TEST",
    companyName: "Test Corp",
    price: 20,
    beta: 1,
    marketCap: 2000,
    currency: "USD",
    sector: "Technology",
    industry: "Software - Application",
    exchange: "NASDAQ",
    description: null,
    website: null,
    ceo: null,
    employees: null,
    isEtf: false,
    isFund: false,
    ...overrides,
  };
}

export function assumptions(overrides: Partial<Assumptions> = {}): Assumptions {
  return {
    currentPrice: 100,
    fcfPerShare: 10,
    epsPerShare: 5,
    dividendPerShare: 2,
    bookValuePerShare: 40,
    revenuePerShare: 50,
    discountRate: 0.08,
    growthRate: 0.1,
    growthYears: 5,
    terminalGrowth: 0.02,
    revenueGrowth: 0.1,
    dividendGrowth: 0.05,
    exitPe: 15,
    payoutRatio: 0.4,
    returnOnEquity: 0.12,
    targetNetMargin: 0.1,
    bondYield: 0.05,
    marginOfSafety: 0.25,
    ...overrides,
  };
}

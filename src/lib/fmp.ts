const FMP_BASE_URL = "https://financialmodelingprep.com/stable";
const ANNUAL_PERIODS = 5;

type FmpPeriod = {
  symbol?: string;
  date?: string;
  fiscalYear?: string | number;
  period?: string;
  reportedCurrency?: string;
};

type IncomeStatement = FmpPeriod & {
  revenue?: number | null;
  grossProfit?: number | null;
  operatingIncome?: number | null;
  netIncome?: number | null;
  eps?: number | null;
};

type BalanceSheet = FmpPeriod & {
  cashAndCashEquivalents?: number | null;
  cashAndShortTermInvestments?: number | null;
  totalCurrentAssets?: number | null;
  totalCurrentLiabilities?: number | null;
  totalStockholdersEquity?: number | null;
  totalDebt?: number | null;
  netDebt?: number | null;
};

type CashFlowStatement = FmpPeriod & {
  operatingCashFlow?: number | null;
  capitalExpenditure?: number | null;
  freeCashFlow?: number | null;
};

type FinancialRatios = FmpPeriod & {
  grossProfitMargin?: number | null;
  operatingProfitMargin?: number | null;
  netProfitMargin?: number | null;
  priceToEarningsRatio?: number | null;
  priceToSalesRatio?: number | null;
  priceToFreeCashFlowRatio?: number | null;
  dividendPerShare?: number | null;
  dividendYield?: number | null;
  dividendYieldPercentage?: number | null;
  debtToEquityRatio?: number | null;
  currentRatio?: number | null;
  interestCoverageRatio?: number | null;
};

type RevenueSegmentsResponse = FmpPeriod & {
  fiscalYear?: string | number;
  data?: Record<string, unknown>;
};

type AnalystEstimate = {
  date?: string;
  epsAvg?: number | null;
};

export type AnnualFinancialSummary = {
  date: string;
  fiscalYear: string;
  period: string;
  currency: string;
  revenue: number | null;
  revenueGrowth: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  operatingIncome: number | null;
  operatingMargin: number | null;
  netIncome: number | null;
  netMargin: number | null;
  eps: number | null;
  totalDebt: number | null;
  cash: number | null;
  netDebt: number | null;
  equity: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  interestCoverage: number | null;
  operatingCashFlow: number | null;
  freeCashFlow: number | null;
  capitalExpenditure: number | null;
  dividendPerShare: number | null;
  dividendYield: number | null;
  peRatio: number | null;
  psRatio: number | null;
  pfcfRatio: number | null;
};

export type RevenueSegmentPeriod = {
  fiscalYear: string;
  segments: { name: string; revenue: number }[];
};

export type FinancialChartExtras = {
  productSegments: RevenueSegmentPeriod[];
  geographicSegments: RevenueSegmentPeriod[];
  nextYearEps: number | null;
  nextYearDate: string | null;
};

export type CompanyFundamentals = {
  symbol: string;
  annualFinancials: AnnualFinancialSummary[];
};

export type FundamentalsResult =
  | { ok: true; data: CompanyFundamentals }
  | { ok: false; reason: "not-configured" | "no-data" | "provider-error" };

export type StockPricePoint = {
  date: string;
  close: number;
};

export type StockPriceHistoryResult =
  | { ok: true; data: StockPricePoint[] }
  | { ok: false; reason: "not-configured" | "no-data" | "provider-error" };

function numeric(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function divide(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

function normalizeCurrency(value: string | undefined): string {
  return value && /^[A-Z]{3}$/.test(value) ? value : "USD";
}

function periodKey(row: FmpPeriod): string {
  return row.date ?? `${row.fiscalYear ?? "unknown"}-${row.period ?? "FY"}`;
}

async function fetchAnnualRows<T extends FmpPeriod>(
  endpoint: string,
  symbol: string,
  apiKey: string,
): Promise<T[]> {
  const url = new URL(`${FMP_BASE_URL}/${endpoint}`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("limit", String(ANNUAL_PERIODS));
  url.searchParams.set("period", "annual");
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`FMP request failed with status ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("FMP returned an unexpected response.");
  }

  return payload as T[];
}

function indexByDate<T extends FmpPeriod>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row): [string, T] => [periodKey(row), row]));
}

export function normalizeTicker(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  return /^(?=.*[A-Z0-9])[A-Z0-9.-]{1,15}$/.test(symbol) ? symbol : null;
}

export async function getCompanyFundamentals(symbol: string): Promise<FundamentalsResult> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { ok: false, reason: "not-configured" };

  try {
    const [incomeStatements, balanceSheets, cashFlowStatements, ratios] = await Promise.all([
      fetchAnnualRows<IncomeStatement>("income-statement", symbol, apiKey),
      fetchAnnualRows<BalanceSheet>("balance-sheet-statement", symbol, apiKey),
      fetchAnnualRows<CashFlowStatement>("cash-flow-statement", symbol, apiKey),
      fetchAnnualRows<FinancialRatios>("ratios", symbol, apiKey),
    ]);

    const validIncomeStatements = incomeStatements.filter(
      (row) => row.date && (numeric(row.revenue) !== null || numeric(row.netIncome) !== null),
    );
    if (validIncomeStatements.length === 0) return { ok: false, reason: "no-data" };

    const balanceByDate = indexByDate(balanceSheets);
    const cashFlowByDate = indexByDate(cashFlowStatements);
    const ratiosByDate = indexByDate(ratios);
    const sortedIncome = [...validIncomeStatements].sort((left, right) =>
      (right.date ?? "").localeCompare(left.date ?? ""),
    );

    const annualFinancials = sortedIncome.map((income, index): AnnualFinancialSummary => {
      const key = periodKey(income);
      const balance = balanceByDate.get(key);
      const cashFlow = cashFlowByDate.get(key);
      const ratio = ratiosByDate.get(key);
      const revenue = numeric(income.revenue);
      const grossProfit = numeric(income.grossProfit);
      const operatingIncome = numeric(income.operatingIncome);
      const netIncome = numeric(income.netIncome);
      const totalDebt = numeric(balance?.totalDebt);
      const cash = numeric(balance?.cashAndShortTermInvestments)
        ?? numeric(balance?.cashAndCashEquivalents);
      const equity = numeric(balance?.totalStockholdersEquity);
      const netDebt = numeric(balance?.netDebt)
        ?? (totalDebt !== null && cash !== null ? totalDebt - cash : null);
      const dividendYieldPercentage = numeric(ratio?.dividendYieldPercentage);
      const previousRevenue = numeric(sortedIncome[index + 1]?.revenue);
      const operatingCashFlow = numeric(cashFlow?.operatingCashFlow);
      const capitalExpenditure = numeric(cashFlow?.capitalExpenditure);

      return {
        date: income.date ?? "",
        fiscalYear: String(income.fiscalYear ?? income.date?.slice(0, 4) ?? "—"),
        period: income.period ?? "FY",
        currency: normalizeCurrency(income.reportedCurrency),
        revenue,
        revenueGrowth: divide(revenue !== null && previousRevenue !== null ? revenue - previousRevenue : null, previousRevenue),
        grossProfit,
        grossMargin: numeric(ratio?.grossProfitMargin) ?? divide(grossProfit, revenue),
        operatingIncome,
        operatingMargin: numeric(ratio?.operatingProfitMargin) ?? divide(operatingIncome, revenue),
        netIncome,
        netMargin: numeric(ratio?.netProfitMargin) ?? divide(netIncome, revenue),
        eps: numeric(income.eps),
        totalDebt,
        cash,
        netDebt,
        equity,
        debtToEquity: numeric(ratio?.debtToEquityRatio) ?? divide(totalDebt, equity),
        currentRatio: numeric(ratio?.currentRatio)
          ?? divide(numeric(balance?.totalCurrentAssets), numeric(balance?.totalCurrentLiabilities)),
        interestCoverage: numeric(ratio?.interestCoverageRatio),
        operatingCashFlow,
        freeCashFlow: numeric(cashFlow?.freeCashFlow)
          ?? (operatingCashFlow !== null && capitalExpenditure !== null
            ? operatingCashFlow + capitalExpenditure
            : null),
        capitalExpenditure,
        dividendPerShare: numeric(ratio?.dividendPerShare),
        dividendYield: numeric(ratio?.dividendYield)
          ?? (dividendYieldPercentage !== null
            ? dividendYieldPercentage / 100
            : null),
        peRatio: numeric(ratio?.priceToEarningsRatio),
        psRatio: numeric(ratio?.priceToSalesRatio),
        pfcfRatio: numeric(ratio?.priceToFreeCashFlowRatio),
      };
    });

    return { ok: true, data: { symbol, annualFinancials } };
  } catch {
    return { ok: false, reason: "provider-error" };
  }
}

async function fetchOptionalRows<T>(
  endpoint: string,
  symbol: string,
  apiKey: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  try {
    const url = new URL(`${FMP_BASE_URL}/${endpoint}`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("apikey", apiKey);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return [];

    const payload: unknown = await response.json();
    return Array.isArray(payload) ? payload as T[] : [];
  } catch {
    return [];
  }
}

function normalizeSegments(rows: RevenueSegmentsResponse[]): RevenueSegmentPeriod[] {
  return rows.flatMap((row): RevenueSegmentPeriod[] => {
    if (!row.data || typeof row.data !== "object") return [];

    const segments = Object.entries(row.data).flatMap(([name, value]) => {
      const revenue = numeric(typeof value === "number" ? value : null);
      return revenue === null ? [] : [{ name, revenue }];
    });
    if (segments.length === 0) return [];

    return [{
      fiscalYear: String(row.fiscalYear ?? row.date?.slice(0, 4) ?? "—"),
      segments,
    }];
  }).sort((left, right) => left.fiscalYear.localeCompare(right.fiscalYear));
}

export async function getFinancialChartExtras(symbol: string): Promise<FinancialChartExtras> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return { productSegments: [], geographicSegments: [], nextYearEps: null, nextYearDate: null };
  }

  const [productRows, geographicRows, analystEstimates] = await Promise.all([
    fetchOptionalRows<RevenueSegmentsResponse>("revenue-product-segmentation", symbol, apiKey, {
      period: "annual",
      structure: "flat",
    }),
    fetchOptionalRows<RevenueSegmentsResponse>("revenue-geographic-segmentation", symbol, apiKey, {
      period: "annual",
      structure: "flat",
    }),
    fetchOptionalRows<AnalystEstimate>("analyst-estimates", symbol, apiKey, {
      period: "annual",
      page: "0",
      limit: "10",
    }),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const nextEstimate = analystEstimates
    .filter((estimate) => estimate.date && estimate.date >= today && numeric(estimate.epsAvg) !== null)
    .sort((left, right) => (left.date ?? "").localeCompare(right.date ?? ""))[0];

  return {
    productSegments: normalizeSegments(productRows),
    geographicSegments: normalizeSegments(geographicRows),
    nextYearEps: numeric(nextEstimate?.epsAvg),
    nextYearDate: nextEstimate?.date ?? null,
  };
}

export async function getStockPriceHistory(symbol: string): Promise<StockPriceHistoryResult> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { ok: false, reason: "not-configured" };

  const from = new Date();
  from.setUTCFullYear(from.getUTCFullYear() - 5);

  const url = new URL(`${FMP_BASE_URL}/historical-price-eod/full`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("from", from.toISOString().slice(0, 10));
  url.searchParams.set("apikey", apiKey);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      throw new Error(`FMP request failed with status ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("FMP returned an unexpected response.");
    }

    const prices = payload.flatMap((row): StockPricePoint[] => {
      if (!row || typeof row !== "object") return [];
      const record = row as { date?: unknown; close?: unknown };
      const close = numeric(typeof record.close === "number" ? record.close : null);
      if (typeof record.date !== "string" || close === null) return [];
      return [{ date: record.date, close }];
    });

    if (prices.length === 0) return { ok: false, reason: "no-data" };

    prices.sort((left, right) => left.date.localeCompare(right.date));
    return { ok: true, data: prices };
  } catch {
    return { ok: false, reason: "provider-error" };
  }
}

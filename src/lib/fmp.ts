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
  debtToEquityRatio?: number | null;
  currentRatio?: number | null;
  interestCoverageRatio?: number | null;
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
};

export type CompanyFundamentals = {
  symbol: string;
  annualFinancials: AnnualFinancialSummary[];
};

export type FundamentalsResult =
  | { ok: true; data: CompanyFundamentals }
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
      };
    });

    return { ok: true, data: { symbol, annualFinancials } };
  } catch {
    return { ok: false, reason: "provider-error" };
  }
}

import {
  getCompanyFundamentals,
  getCompanyProfile,
  getRiskFreeRate,
  type CompanyFundamentals,
  type CompanyProfile,
  type FmpFailureReason,
} from "@/lib/fmp";
import { getStatementTable, type StatementTable } from "@/lib/financial-statements";
import { getAnalystEstimates, getOutstandingShares, getQuote } from "@/lib/stock-overview";
import { buildDcfDefaults, type DcfDefaults } from "@/lib/simple-dcf";
import { buildJeremyDefaults, type JeremyDefaults } from "@/lib/jeremy-projection";
import { buildProjectionDefaults, type ProjectionDefaults } from "@/lib/plumas-projection";
import { recommendProjection, type ProjectionFit } from "@/lib/projection-fit";
import { classifyStock, type Classification, type ClassifierYear } from "@/lib/valuation/classify";
import { buildDefaults, type DefaultAssumptions } from "@/lib/valuation/defaults";

export type ProjectionData = {
  fundamentals: CompanyFundamentals;
  profile: CompanyProfile | null;
  profileFailure: FmpFailureReason | null;
  riskFreeRate: number | null;
  classification: Classification;
  defaults: DefaultAssumptions;
};

export type ProjectionDataResult =
  | { ok: true; data: ProjectionData }
  | { ok: false; reason: FmpFailureReason };

// FMP responses are cached, so the page and the AI autofill share one set of requests.
export async function loadProjectionData(symbol: string): Promise<ProjectionDataResult> {
  const [fundamentals, profileResult, riskFreeRate] = await Promise.all([
    getCompanyFundamentals(symbol),
    getCompanyProfile(symbol),
    getRiskFreeRate(),
  ]);
  if (!fundamentals.ok) return fundamentals;

  const profile = profileResult.ok ? profileResult.data : null;
  const classification = classifyStock(fundamentals.data.annualFinancials, profile);
  const defaults = buildDefaults({
    financials: fundamentals.data.annualFinancials,
    profile,
    riskFreeRate,
    type: classification.type,
  });

  return {
    ok: true,
    data: {
      fundamentals: fundamentals.data,
      profile,
      profileFailure: profileResult.ok ? null : profileResult.reason,
      riskFreeRate,
      classification,
      defaults,
    },
  };
}

export type PriceProjectionData = {
  income: StatementTable;
  plumas: ProjectionDefaults;
  jeremy: JeremyDefaults;
  // The stock type, and which of the two projections suits it.
  classification: Classification;
  fit: ProjectionFit;
};

export type PriceProjectionDataResult =
  | { ok: true; data: PriceProjectionData }
  | { ok: false; reason: FmpFailureReason };

// Each fiscal year's figures for the stock classifier, newest first, from the statement tables.
function classifierYears(income: StatementTable, ratios: StatementTable | null): ClassifierYear[] {
  const value = (table: StatementTable | null, id: string, columnId: string) => {
    const index = table?.columns.findIndex((column) => column.id === columnId) ?? -1;
    return index >= 0 ? table?.rows.find((row) => row.id === id)?.values[index] ?? null : null;
  };
  return income.columns
    .filter((column) => column.id !== "ttm")
    .map((column) => ({
      fiscalYear: column.label.replace(/^FY\s*/, ""),
      revenue: value(income, "revenue", column.id),
      netIncome: value(income, "netIncome", column.id),
      eps: value(income, "eps", column.id),
      dividendYield: value(ratios, "dividendYield", column.id),
    }));
}

// Both projections, from the same cached statement tables as the Financials page (the income
// statement and the fiscal-year ratios), the quote, today's share count, analysts' estimates and the
// profile's sector, which with the history decides which projection suits the company.
export async function loadPriceProjectionData(symbol: string): Promise<PriceProjectionDataResult> {
  const [income, ratios, quote, floatShares, estimates, profile] = await Promise.all([
    getStatementTable(symbol, "income", "annual"),
    getStatementTable(symbol, "ratios", "annual"),
    getQuote(symbol),
    getOutstandingShares(symbol),
    getAnalystEstimates(symbol),
    getCompanyProfile(symbol),
  ]);
  if (!income.ok) return income;

  const ratiosTable = ratios.ok ? ratios.data : null;
  const price = quote.ok ? quote.data.price : null;
  const marketCap = quote.ok ? quote.data.marketCap : null;
  const today = new Date();
  const plumas = buildProjectionDefaults({
    income: income.data,
    ratios: ratiosTable,
    price,
    shares: floatShares ?? (marketCap !== null && price ? marketCap / price : null),
    estimates,
    today,
  });
  const years = classifierYears(income.data, ratiosTable);
  const classification = classifyStock(years, profile.ok ? profile.data : null);
  const buybacks = plumas.history.flatMap((year) => (year.buybackYield === null ? [] : [year.buybackYield]));
  return {
    ok: true,
    data: {
      income: income.data,
      plumas,
      jeremy: buildJeremyDefaults({ plumas, estimates, today }),
      classification,
      fit: recommendProjection(classification, {
        buybackYield: buybacks.length ? buybacks.reduce((sum, value) => sum + value, 0) / buybacks.length : null,
        dividendYield: years[0]?.dividendYield ?? null,
      }),
    },
  };
}

export type DcfData = {
  income: StatementTable;
  cashFlow: StatementTable | null;
  defaults: DcfDefaults;
};

export type DcfDataResult =
  | { ok: true; data: DcfData }
  | { ok: false; reason: FmpFailureReason };

// TTM free cash flow, the latest balance sheet and share count, from the cached Financials tables.
export async function loadDcfData(symbol: string): Promise<DcfDataResult> {
  const [income, cashFlow, balance, quote] = await Promise.all([
    getStatementTable(symbol, "income", "annual"),
    getStatementTable(symbol, "cash-flow", "annual"),
    getStatementTable(symbol, "balance", "annual"),
    getQuote(symbol),
  ]);
  if (!income.ok) return income;

  const cashFlowTable = cashFlow.ok ? cashFlow.data : null;
  return {
    ok: true,
    data: {
      income: income.data,
      cashFlow: cashFlowTable,
      defaults: buildDcfDefaults({
        income: income.data,
        cashFlow: cashFlowTable,
        balance: balance.ok ? balance.data : null,
        price: quote.ok ? quote.data.price : null,
      }),
    },
  };
}

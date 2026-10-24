import {
  getCompanyFundamentals,
  getCompanyProfile,
  getRiskFreeRate,
  type CompanyFundamentals,
  type CompanyProfile,
  type FmpFailureReason,
} from "@/lib/fmp";
import { getStatementTable, type StatementTable } from "@/lib/financial-statements";
import { getQuote } from "@/lib/stock-overview";
import { buildDcfDefaults, type DcfDefaults } from "@/lib/simple-dcf";
import { buildProjectionDefaults, type ProjectionDefaults } from "@/lib/three-year-projection";
import { classifyStock, type Classification } from "@/lib/valuation/classify";
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

export type ThreeYearData = {
  income: StatementTable;
  ratios: StatementTable | null;
  defaults: ProjectionDefaults;
};

export type ThreeYearDataResult =
  | { ok: true; data: ThreeYearData }
  | { ok: false; reason: FmpFailureReason };

// The same cached statement tables as the Financials page: the last fiscal year's revenue, net
// income and shares, their growth history, and the fiscal-year P/E history.
export async function loadThreeYearData(symbol: string): Promise<ThreeYearDataResult> {
  const [income, ratios, quote] = await Promise.all([
    getStatementTable(symbol, "income", "annual"),
    getStatementTable(symbol, "ratios", "annual"),
    getQuote(symbol),
  ]);
  if (!income.ok) return income;

  const ratiosTable = ratios.ok ? ratios.data : null;
  return {
    ok: true,
    data: {
      income: income.data,
      ratios: ratiosTable,
      defaults: buildProjectionDefaults({
        income: income.data,
        ratios: ratiosTable,
        price: quote.ok ? quote.data.price : null,
        currentYear: new Date().getUTCFullYear(),
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

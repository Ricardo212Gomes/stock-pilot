import { noteFailure, noteRateLimited } from "./provider-status";
import { getSecStatements } from "./sec";
import { getTiingoCloses } from "./tiingo";

export const FMP_BASE_URL = "https://financialmodelingprep.com/stable";
const ANNUAL_PERIODS = 5;
// Cache successful FMP responses to stay within the plan's daily request limit.
// Next only stores 200 responses, so errors like 429 are never cached.
const STATEMENTS_REVALIDATE_SECONDS = 60 * 60 * 24;
const PRICES_REVALIDATE_SECONDS = 60 * 60 * 6;
const PROFILE_REVALIDATE_SECONDS = 60 * 60;

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
  epsDiluted?: number | null;
  weightedAverageShsOutDil?: number | null;
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
  sharesDiluted: number | null;
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

// Where the statements came from: FMP, or SEC filings when FMP's plan doesn't cover the company.
export type StatementSource = "fmp" | "sec";

export type CompanyFundamentals = {
  symbol: string;
  annualFinancials: AnnualFinancialSummary[];
  source: StatementSource;
};

// Failures another source can stand in for: a company the plan doesn't cover, or the daily limit.
export function canUseFallback(reason: FmpFailureReason): boolean {
  return reason === "plan-restricted" || reason === "rate-limited";
}

export type FmpFailureReason =
  | "not-configured"
  | "no-data"
  | "rate-limited"
  | "invalid-key"
  | "plan-restricted"
  | "provider-error";

export type FundamentalsResult =
  | { ok: true; data: CompanyFundamentals }
  | { ok: false; reason: FmpFailureReason };

export type CompanyProfile = {
  symbol: string;
  companyName: string | null;
  price: number | null;
  beta: number | null;
  marketCap: number | null;
  currency: string;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  description: string | null;
  website: string | null;
  ceo: string | null;
  employees: number | null;
  isEtf: boolean;
  isFund: boolean;
};

export type CompanyProfileResult =
  | { ok: true; data: CompanyProfile }
  | { ok: false; reason: FmpFailureReason };

export type StockPricePoint = {
  date: string;
  close: number;
};

export type StockPriceHistoryResult =
  // "tiingo" when FMP couldn't give the prices (see docs/data-fallbacks.md).
  | { ok: true; data: StockPricePoint[]; source: "fmp" | "tiingo" }
  | { ok: false; reason: FmpFailureReason };

class FmpRequestError extends Error {
  constructor(readonly reason: FmpFailureReason, message: string) {
    super(message);
  }
}

function reasonForStatus(status: number): FmpFailureReason {
  if (status === 429) return "rate-limited";
  if (status === 401) return "invalid-key";
  if (status === 402 || status === 403) return "plan-restricted";
  return "provider-error";
}

export function failureReason(error: unknown): FmpFailureReason {
  return error instanceof FmpRequestError ? error.reason : "provider-error";
}

// FMP answers 402 for what the plan doesn't include: a whole endpoint ("Restricted Endpoint", like the company
// screener), a company outside the free plan's sample ("…value set for 'symbol' is not available…"), or a
// parameter value (a limit over 5). That holds until the plan changes, but Next only caches successful
// responses, so without a memory every visit asks again: nine refused requests on a company's Overview. Each
// refusal is remembered for a day by this server process, by endpoint, endpoint and company, or exact request.
const RESTRICTION_MS = 24 * 60 * 60 * 1000;
const MAX_RESTRICTIONS = 5000;
const restrictions = new Map<string, number>();

function restrictionKeys(url: URL): { endpoint: string; company: string | null; request: string } {
  const params = new URLSearchParams(url.searchParams);
  params.delete("apikey");
  params.sort();
  const symbol = url.searchParams.get("symbol");
  return { endpoint: url.pathname, company: symbol ? `${url.pathname}|${symbol.toUpperCase()}` : null, request: `${url.pathname}?${params}` };
}

function remember(key: string, now: number): void {
  if (restrictions.size >= MAX_RESTRICTIONS) {
    for (const [stored, until] of restrictions) if (until <= now) restrictions.delete(stored);
    if (restrictions.size >= MAX_RESTRICTIONS) restrictions.clear();
  }
  restrictions.set(key, now + RESTRICTION_MS);
}

// How many refusals are remembered now, for the Data sources card.
export function rememberedRestrictions(now = Date.now()): number {
  return [...restrictions.values()].filter((until) => until > now).length;
}

export function resetFmpRestrictions(): void {
  restrictions.clear();
}

export async function fetchFmp(url: URL, revalidate: number): Promise<unknown> {
  const keys = restrictionKeys(url);
  const now = Date.now();
  if ([keys.endpoint, keys.company, keys.request].some((key) => key && (restrictions.get(key) ?? 0) > now)) {
    throw new FmpRequestError("plan-restricted", "FMP's plan doesn't include this request (remembered from an earlier answer).");
  }

  const response = await fetch(url, {
    next: { revalidate },
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    const reason = reasonForStatus(response.status);
    if (reason === "plan-restricted") {
      const message = await response.text().catch(() => "");
      const key = /Restricted Endpoint/i.test(message) ? keys.endpoint : /'symbol'/i.test(message) && keys.company ? keys.company : keys.request;
      remember(key, now);
    } else if (reason === "rate-limited") {
      noteRateLimited("fmp", now);
    } else {
      noteFailure("fmp", reason, now);
    }
    throw new FmpRequestError(reason, `FMP request failed with status ${response.status}`);
  }

  return response.json();
}

export function numeric(value: number | null | undefined): number | null {
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

  const payload = await fetchFmp(url, STATEMENTS_REVALIDATE_SECONDS);
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
    return summarizeFundamentals(symbol, incomeStatements, balanceSheets, cashFlowStatements, ratios, "fmp");
  } catch (error) {
    const reason = failureReason(error);
    // Companies FMP's plan doesn't cover, or any company once the daily limit is reached, still
    // have SEC filings, just without the ratios.
    if (canUseFallback(reason)) {
      const sec = await getSecStatements(symbol);
      if (sec.ok) {
        const { income, balance, cash } = sec.data.annual;
        return summarizeFundamentals(symbol, income as IncomeStatement[], balance as BalanceSheet[], cash as CashFlowStatement[], [], "sec");
      }
    }
    return { ok: false, reason };
  }
}

// One summary per fiscal year, newest first, from FMP-shaped statement rows.
function summarizeFundamentals(
  symbol: string,
  incomeStatements: IncomeStatement[],
  balanceSheets: BalanceSheet[],
  cashFlowStatements: CashFlowStatement[],
  ratios: FinancialRatios[],
  source: StatementSource,
): FundamentalsResult {
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
      eps: numeric(income.epsDiluted) ?? numeric(income.eps),
      sharesDiluted: numeric(income.weightedAverageShsOutDil),
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

  return { ok: true, data: { symbol, annualFinancials, source } };
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

    const payload = await fetchFmp(url, STATEMENTS_REVALIDATE_SECONDS);
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

// Five years of daily closes for the Overview chart. Prices aren't FMP's alone, so with a Tiingo key they come
// from Tiingo first (free, every US stock, the same cached request the other price fallbacks use), keeping
// FMP's 250 daily requests for data only it has; FMP stands in when Tiingo can't, and the other way round.
export async function getStockPriceHistory(symbol: string): Promise<StockPriceHistoryResult> {
  const tiingo = await getTiingoCloses(symbol);
  if (tiingo) return { ok: true, data: tiingo, source: "tiingo" };
  return fmpPriceHistory(symbol);
}

async function fmpPriceHistory(symbol: string): Promise<StockPriceHistoryResult> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { ok: false, reason: "not-configured" };

  const from = new Date();
  from.setUTCFullYear(from.getUTCFullYear() - 5);

  const url = new URL(`${FMP_BASE_URL}/historical-price-eod/full`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("from", from.toISOString().slice(0, 10));
  url.searchParams.set("apikey", apiKey);

  try {
    const payload = await fetchFmp(url, PRICES_REVALIDATE_SECONDS);
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
    return { ok: true, data: prices, source: "fmp" };
  } catch (error) {
    return { ok: false, reason: failureReason(error) };
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function getCompanyProfile(symbol: string): Promise<CompanyProfileResult> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { ok: false, reason: "not-configured" };

  const url = new URL(`${FMP_BASE_URL}/profile`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("apikey", apiKey);

  try {
    const payload = await fetchFmp(url, PROFILE_REVALIDATE_SECONDS);
    const row: unknown = Array.isArray(payload) ? payload[0] : null;
    if (!row || typeof row !== "object") return { ok: false, reason: "no-data" };

    const record = row as Record<string, unknown>;
    const asNumber = (value: unknown) => numeric(typeof value === "number" ? value : null);
    return {
      ok: true,
      data: {
        symbol,
        companyName: text(record.companyName),
        price: asNumber(record.price),
        beta: asNumber(record.beta),
        marketCap: asNumber(record.marketCap),
        currency: normalizeCurrency(text(record.currency) ?? undefined),
        sector: text(record.sector),
        industry: text(record.industry),
        exchange: text(record.exchange),
        description: text(record.description),
        website: text(record.website),
        ceo: text(record.ceo),
        employees: asNumber(typeof record.fullTimeEmployees === "string" ? Number(record.fullTimeEmployees) : record.fullTimeEmployees),
        isEtf: record.isEtf === true,
        isFund: record.isFund === true,
      },
    };
  } catch (error) {
    return { ok: false, reason: failureReason(error) };
  }
}

// Latest 10-year US Treasury yield as a decimal (0.0425 = 4.25%), or null when unavailable.
export async function getRiskFreeRate(): Promise<number | null> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return null;

  const url = new URL(`${FMP_BASE_URL}/treasury-rates`);
  url.searchParams.set("apikey", apiKey);

  try {
    const payload = await fetchFmp(url, STATEMENTS_REVALIDATE_SECONDS);
    if (!Array.isArray(payload)) return null;

    const latest = payload
      .filter((row): row is { date: string; year10: number } =>
        !!row && typeof row === "object"
          && typeof row.date === "string"
          && numeric(typeof row.year10 === "number" ? row.year10 : null) !== null,
      )
      .sort((left, right) => right.date.localeCompare(left.date))[0];
    return latest && latest.year10 > 0 ? latest.year10 / 100 : null;
  } catch {
    return null;
  }
}

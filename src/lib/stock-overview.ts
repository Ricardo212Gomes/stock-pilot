import {
  FMP_BASE_URL,
  canUseFallback,
  failureReason,
  fetchFmp,
  getCompanyProfile,
  numeric,
  type CompanyProfile,
  type FmpFailureReason,
} from "./fmp";
import { getRatingMonths } from "./analyst-ratings";
import { getCompanyReports, type ReportTime } from "./earnings-calendar";
import { fetchFinnhub, finnhubSymbol } from "./finnhub";
import { summarizeRatings } from "./recommendation-signals";
import { getSecStatements } from "./sec";

// The quote moves all day; everything else changes at most daily.
const QUOTE_REVALIDATE_SECONDS = 60;
const DAILY_REVALIDATE_SECONDS = 60 * 60 * 24;
// The free FMP plan returns at most 5 rows per request, enough for four quarters.
const TTM_QUARTERS = 4;

export type StockOverview = {
  symbol: string;
  name: string;
  // "finnhub" when FMP's plan doesn't cover the company; its statistics then come from Finnhub and SEC filings.
  quoteSource: StockQuote["source"];
  exchange: string | null;
  currency: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  // Unix seconds of the last trade FMP reports.
  quoteTime: number | null;
  marketCap: number | null;
  revenueTtm: number | null;
  revenueGrowth: number | null;
  netIncomeTtm: number | null;
  epsTtm: number | null;
  epsGrowth: number | null;
  sharesOutstanding: number | null;
  peRatio: number | null;
  forwardPe: number | null;
  dividendPerShare: number | null;
  dividendYield: number | null;
  exDividendDate: string | null;
  volume: number | null;
  open: number | null;
  previousClose: number | null;
  dayLow: number | null;
  dayHigh: number | null;
  yearLow: number | null;
  yearHigh: number | null;
  beta: number | null;
  analystConsensus: string | null;
  analystCount: number | null;
  priceTarget: number | null;
  priceTargetUpside: number | null;
  earningsDate: string | null;
  // Before the open, during market hours or after the close, when Finnhub's calendar says.
  earningsTime: Exclude<ReportTime, "unknown"> | null;
  profile: CompanyProfile | null;
};

export type StockOverviewResult =
  | { ok: true; data: StockOverview }
  | { ok: false; reason: FmpFailureReason };

type Row = Record<string, unknown>;

function num(value: unknown): number | null {
  return numeric(typeof value === "number" ? value : null);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function fmpRows(endpoint: string, params: Record<string, string>, revalidate: number): Promise<Row[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error("FMP is not configured.");

  const url = new URL(`${FMP_BASE_URL}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("apikey", apiKey);

  const payload = await fetchFmp(url, revalidate);
  if (!Array.isArray(payload)) throw new Error("FMP returned an unexpected response.");
  return payload.filter((row): row is Row => !!row && typeof row === "object");
}

// Optional data: a failure leaves that figure blank instead of failing the page.
export async function optionalRows(endpoint: string, params: Record<string, string>, revalidate = DAILY_REVALIDATE_SECONDS): Promise<Row[]> {
  try {
    return await fmpRows(endpoint, params, revalidate);
  } catch {
    return [];
  }
}

const PAYMENTS_PER_YEAR: Record<string, number> = {
  monthly: 12,
  quarterly: 4,
  "semi-annual": 2,
  semiannual: 2,
  annual: 1,
};

// The latest dividend times its yearly frequency, like the "indicated" dividend on quote sites.
export function annualDividend(dividends: Row[]): { perShare: number | null; exDate: string | null } {
  const latest = [...dividends]
    .filter((row) => str(row.date) && num(row.dividend) !== null)
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))[0];
  if (!latest) return { perShare: null, exDate: null };

  const frequency = str(latest.frequency)?.toLowerCase() ?? "";
  const payments = PAYMENTS_PER_YEAR[frequency];
  return {
    perShare: payments ? num(latest.dividend)! * payments : null,
    exDate: str(latest.date),
  };
}

// The first scheduled report that has no reported EPS yet.
export function nextEarningsDate(earnings: Row[], today: string): string | null {
  return earnings
    .filter((row) => str(row.date) && String(row.date) >= today && row.epsActual == null)
    .map((row) => String(row.date))
    .sort()[0] ?? null;
}

export type TrailingTwelveMonths = { revenue: number | null; grossProfit: number | null; netIncome: number | null; eps: number | null };

export function trailingTwelveMonths(quarters: Row[]): TrailingTwelveMonths {
  const recent = [...quarters]
    .filter((row) => str(row.date))
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))
    .slice(0, TTM_QUARTERS);
  const sum = (field: string) => {
    if (recent.length < TTM_QUARTERS) return null;
    const values = recent.map((row) => num(row[field]));
    return values.every((value) => value !== null) ? values.reduce((total, value) => total! + value!, 0)! : null;
  };
  return { revenue: sum("revenue"), grossProfit: sum("grossProfit"), netIncome: sum("netIncome"), eps: sum("epsDiluted") ?? sum("eps") };
}

async function finnhubGrowth(symbol: string): Promise<{ revenue: number | null; eps: number | null }> {
  const result = await fetchFinnhub("stock/metric", { symbol: finnhubSymbol(symbol), metric: "all" }, DAILY_REVALIDATE_SECONDS);
  const metric = result.ok && result.payload && typeof result.payload === "object"
    ? (result.payload as { metric?: Row }).metric
    : undefined;
  const percent = (value: unknown) => {
    const parsed = num(value);
    return parsed === null ? null : parsed / 100;
  };
  return { revenue: percent(metric?.revenueGrowthTTMYoy), eps: percent(metric?.epsGrowthTTMYoy) };
}

export type StockQuote = {
  symbol: string;
  name: string;
  exchange: string | null;
  price: number;
  change: number | null;
  changePercent: number | null;
  // Unix seconds of the last trade.
  quoteTime: number | null;
  marketCap: number | null;
  // "finnhub" when FMP's plan doesn't cover the company.
  source: "fmp" | "finnhub";
  raw: Row;
};

export type StockQuoteResult =
  | { ok: true; data: StockQuote }
  | { ok: false; reason: FmpFailureReason };

// FMP first by default: its quote has the day's volume, which the Overview shows. Pages that need only the
// price, name and market cap (company headers, Favorites, Compare, the valuation tools) prefer Finnhub, whose
// free quote covers every US stock at 60 requests a minute, so FMP's 250 a day go to data only it has.
export async function getQuote(symbol: string, prefer: "fmp" | "finnhub" = "fmp"): Promise<StockQuoteResult> {
  if (prefer === "finnhub" || !process.env.FMP_API_KEY) {
    const finnhub = await finnhubQuote(symbol);
    if (finnhub) return toQuote(symbol, finnhub, "finnhub");
    if (!process.env.FMP_API_KEY) return { ok: false, reason: "not-configured" };
  }

  try {
    const quote = (await fmpRows("quote", { symbol }, QUOTE_REVALIDATE_SECONDS))[0];
    return quote ? toQuote(symbol, quote, "fmp") : { ok: false, reason: "no-data" };
  } catch (error) {
    const reason = failureReason(error);
    if (!canUseFallback(reason) || prefer === "finnhub") return { ok: false, reason };
    // Companies FMP's plan doesn't cover, or FMP's daily limit: Finnhub's free quote covers every US stock.
    const finnhub = await finnhubQuote(symbol);
    return finnhub ? toQuote(symbol, finnhub, "finnhub") : { ok: false, reason };
  }
}

// The quote for a company page's header and lists: see getQuote.
export function getHeaderQuote(symbol: string): Promise<StockQuoteResult> {
  return getQuote(symbol, "finnhub");
}

function toQuote(symbol: string, quote: Row, source: StockQuote["source"]): StockQuoteResult {
  const price = num(quote.price);
  if (price === null) return { ok: false, reason: "no-data" };

  return {
    ok: true,
    data: {
      symbol,
      name: str(quote.name) ?? symbol,
      exchange: str(quote.exchange),
      price,
      change: num(quote.change),
      changePercent: num(quote.changePercentage) !== null ? num(quote.changePercentage)! / 100 : null,
      quoteTime: num(quote.timestamp),
      marketCap: num(quote.marketCap),
      source,
      raw: quote,
    },
  };
}

function shortExchange(name: string | null): string | null {
  if (!name) return null;
  if (/nasdaq/i.test(name)) return "NASDAQ";
  if (/new york/i.test(name)) return "NYSE";
  return name;
}

// A quote shaped like FMP's, from Finnhub's quote, company profile and 52-week range. Finnhub
// reports market cap and shares in millions and has no volume.
async function finnhubQuote(symbol: string): Promise<Row | null> {
  const ticker = finnhubSymbol(symbol);
  const [quote, profile, metric] = await Promise.all([
    fetchFinnhub("quote", { symbol: ticker }, QUOTE_REVALIDATE_SECONDS),
    fetchFinnhub("stock/profile2", { symbol: ticker }, DAILY_REVALIDATE_SECONDS),
    fetchFinnhub("stock/metric", { symbol: ticker, metric: "all" }, DAILY_REVALIDATE_SECONDS),
  ]);
  const q = quote.ok ? (quote.payload as Row | null) : null;
  const price = num(q?.c);
  // Finnhub answers unknown symbols with a zero price.
  if (!q || price === null || price === 0) return null;
  const p = profile.ok ? ((profile.payload ?? {}) as Row) : {};
  const m = metric.ok ? (((metric.payload as { metric?: Row } | null)?.metric) ?? {}) : {};
  const marketCapMillions = num(p.marketCapitalization);
  return {
    symbol,
    name: str(p.name) ?? symbol,
    exchange: shortExchange(str(p.exchange)),
    price,
    change: num(q.d),
    changePercentage: num(q.dp),
    open: num(q.o),
    previousClose: num(q.pc),
    dayLow: num(q.l),
    dayHigh: num(q.h),
    yearLow: num(m["52WeekLow"]),
    yearHigh: num(m["52WeekHigh"]),
    timestamp: num(q.t),
    marketCap: marketCapMillions !== null ? marketCapMillions * 1e6 : null,
    volume: null,
  };
}

// Shares outstanding today: Finnhub's company profile first (free for every company, in millions, and the same
// cached request the Finnhub quote makes), else FMP's float data; null when neither has them.
export async function getOutstandingShares(symbol: string): Promise<number | null> {
  const profile = await fetchFinnhub("stock/profile2", { symbol: finnhubSymbol(symbol) }, DAILY_REVALIDATE_SECONDS);
  const millions = profile.ok ? num((profile.payload as Row | null)?.shareOutstanding) : null;
  if (millions !== null && millions > 0) return millions * 1e6;
  const float = await optionalRows("shares-float", { symbol });
  return num(float[0]?.outstandingShares);
}

export type EstimateRange = { low: number | null; avg: number | null; high: number | null };

// Analysts' consensus for one fiscal year: the average of their estimates and the lowest and highest.
export type AnalystEstimate = {
  // The fiscal year's end, e.g. "2026-12-31".
  date: string;
  revenue: EstimateRange;
  netIncome: EstimateRange;
  eps: EstimateRange;
  analysts: number | null;
};

// Every fiscal year FMP has estimates for, past and future, oldest first; empty when its plan doesn't
// cover them.
export async function getAnalystEstimates(symbol: string): Promise<AnalystEstimate[]> {
  // Same parameters as the financials page, so both share one cached response.
  const rows = await optionalRows("analyst-estimates", { symbol, period: "annual", page: "0", limit: "10" });
  const range = (row: Row, field: string): EstimateRange => ({
    low: num(row[`${field}Low`]),
    avg: num(row[`${field}Avg`]),
    high: num(row[`${field}High`]),
  });
  return rows
    .filter((row) => str(row.date))
    .map((row) => ({
      date: String(row.date),
      revenue: range(row, "revenue"),
      netIncome: range(row, "netIncome"),
      eps: range(row, "eps"),
      analysts: num(row.numAnalystsEps) ?? num(row.numAnalystsRevenue),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

export async function getStockOverview(symbol: string, today = new Date()): Promise<StockOverviewResult> {
  const quoteResult = await getQuote(symbol);
  if (!quoteResult.ok) return quoteResult;
  const { raw: quote, price } = quoteResult.data;

  const isoToday = today.toISOString().slice(0, 10);
  const [profileResult, quarters, floatShares, target, ratingMonths, dividends, reports, estimates, growth] = await Promise.all([
    getCompanyProfile(symbol),
    optionalRows("income-statement", { symbol, period: "quarter", limit: "5" }),
    getOutstandingShares(symbol),
    optionalRows("price-target-consensus", { symbol }),
    // Analysts' ratings and the next report date come from Finnhub, free for every company, rather than FMP's
    // grades-consensus and earnings: two fewer FMP requests a company, and the same rating as the Forecast tab.
    getRatingMonths(symbol),
    optionalRows("dividends", { symbol, limit: "5" }),
    getCompanyReports(symbol, isoToday),
    getAnalystEstimates(symbol),
    finnhubGrowth(symbol),
  ]);

  const profile = profileResult.ok ? profileResult.data : null;
  // Without FMP's quarters (a company its plan doesn't cover), the SEC's give the trailing year.
  let quarterRows = quarters;
  if (quarterRows.length === 0) {
    const sec = await getSecStatements(symbol);
    if (sec.ok) quarterRows = sec.data.quarterly.income;
  }
  const ttm = trailingTwelveMonths(quarterRows);
  const dividend = annualDividend(dividends);
  const marketCap = num(quote.marketCap);
  const sharesOutstanding = floatShares ?? (marketCap !== null ? marketCap / price : null);

  const forwardEps = estimates.find((estimate) => estimate.date >= isoToday && (estimate.eps.avg ?? 0) > 0)?.eps.avg ?? null;

  const ratings = summarizeRatings(ratingMonths);
  const nextReport = reports?.find((report) => report.date >= isoToday) ?? null;
  const priceTarget = num(target[0]?.targetConsensus);

  return {
    ok: true,
    data: {
      symbol,
      name: str(quote.name) ?? profile?.companyName ?? symbol,
      quoteSource: quoteResult.data.source,
      exchange: str(quote.exchange) ?? profile?.exchange ?? null,
      currency: profile?.currency ?? "USD",
      price,
      change: num(quote.change),
      changePercent: num(quote.changePercentage) !== null ? num(quote.changePercentage)! / 100 : null,
      quoteTime: num(quote.timestamp),
      marketCap,
      revenueTtm: ttm.revenue,
      revenueGrowth: growth.revenue,
      netIncomeTtm: ttm.netIncome,
      epsTtm: ttm.eps,
      epsGrowth: growth.eps,
      sharesOutstanding,
      peRatio: ttm.eps !== null && ttm.eps > 0 ? price / ttm.eps : null,
      forwardPe: forwardEps !== null ? price / forwardEps : null,
      dividendPerShare: dividend.perShare,
      dividendYield: dividend.perShare !== null ? dividend.perShare / price : null,
      exDividendDate: dividend.exDate,
      volume: num(quote.volume),
      open: num(quote.open),
      previousClose: num(quote.previousClose),
      dayLow: num(quote.dayLow),
      dayHigh: num(quote.dayHigh),
      yearLow: num(quote.yearLow),
      yearHigh: num(quote.yearHigh),
      beta: profile?.beta ?? null,
      analystConsensus: ratings?.label ?? null,
      analystCount: ratings?.total ?? null,
      priceTarget,
      priceTargetUpside: priceTarget !== null ? priceTarget / price - 1 : null,
      earningsDate: nextReport?.date ?? null,
      earningsTime: nextReport && nextReport.time !== "unknown" ? nextReport.time : null,
      profile,
    },
  };
}

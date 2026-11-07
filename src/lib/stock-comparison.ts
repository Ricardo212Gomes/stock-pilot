import { normalizeTicker, numeric, type FmpFailureReason } from "./fmp";
import { fetchFinnhub, finnhubSymbol } from "./finnhub";
import { getSecStatements } from "./sec";
import {
  getAnalystEstimates,
  getHeaderQuote,
  optionalRows,
  trailingTwelveMonths,
  type AnalystEstimate,
} from "./stock-overview";

// Side-by-side metrics modelled on Jeremy Lefebvre's (1000xStocks) comparison sheet: valuation, expected
// growth and margins for a few stocks, next to the range many established companies trade at. Forward
// figures use analysts' consensus for the fiscal year after the last annual report ("this year") and the
// one after it ("next year").

export const MAX_COMPARED = 5;

const DAILY_REVALIDATE_SECONDS = 60 * 60 * 24;
const DAY_MS = 24 * 60 * 60 * 1000;
// An estimate belongs to a later fiscal year once it ends this long after the previous year's end.
const FISCAL_YEAR_GAP_DAYS = 180;

export type MetricId =
  | "ttmPe" | "forwardPe" | "twoYearForwardPe"
  | "ttmEpsGrowth" | "currentYearEpsGrowth" | "nextYearEpsGrowth"
  | "ttmRevenueGrowth" | "currentYearRevenueGrowth" | "nextYearRevenueGrowth"
  | "grossMargin" | "netMargin" | "ttmPs" | "forwardPs"
  | "lastYearEpsGrowth" | "ttmVsNtmEpsGrowth" | "latestQuarterEpsGrowth" | "twoYearEpsGrowth"
  | "lastYearRevenueGrowth" | "ttmVsNtmRevenueGrowth" | "latestQuarterRevenueGrowth" | "twoYearRevenueGrowth";

export type MetricKind = "multiple" | "growth" | "margin";

export type MetricDefinition = {
  id: MetricId;
  label: string;
  help: string;
  kind: MetricKind;
  // Where many established companies sit, as on Jeremy's sheet: a yardstick, not a target.
  typical: [number, number];
};

export type MetricSection = { label: string; metrics: MetricDefinition[] };

const EPS_TYPICAL: [number, number] = [0.08, 0.12];
const REVENUE_TYPICAL: [number, number] = [0.045, 0.065];
const PS_TYPICAL: [number, number] = [1.8, 2.6];

export const METRIC_SECTIONS: MetricSection[] = [
  {
    label: "Valuation",
    metrics: [
      { id: "ttmPe", label: "TTM P/E", help: "Price divided by earnings per share over the last four quarters.", kind: "multiple", typical: [20, 28] },
      { id: "forwardPe", label: "Forward P/E", help: "Price divided by analysts' EPS estimate for this fiscal year.", kind: "multiple", typical: [18, 26] },
      { id: "twoYearForwardPe", label: "2-year forward P/E", help: "Price divided by analysts' EPS estimate for next fiscal year.", kind: "multiple", typical: [16, 24] },
    ],
  },
  {
    label: "EPS growth",
    metrics: [
      { id: "ttmEpsGrowth", label: "TTM EPS growth", help: "EPS over the last four quarters against the four before them.", kind: "growth", typical: EPS_TYPICAL },
      { id: "currentYearEpsGrowth", label: "This year (expected)", help: "Analysts' EPS estimate for this fiscal year against last year's reported EPS.", kind: "growth", typical: EPS_TYPICAL },
      { id: "nextYearEpsGrowth", label: "Next year (expected)", help: "Analysts' EPS estimate for next fiscal year against this year's.", kind: "growth", typical: EPS_TYPICAL },
    ],
  },
  {
    label: "Revenue growth",
    metrics: [
      { id: "ttmRevenueGrowth", label: "TTM revenue growth", help: "Revenue over the last four quarters against the four before them.", kind: "growth", typical: REVENUE_TYPICAL },
      { id: "currentYearRevenueGrowth", label: "This year (expected)", help: "Analysts' revenue estimate for this fiscal year against last year's reported revenue.", kind: "growth", typical: REVENUE_TYPICAL },
      { id: "nextYearRevenueGrowth", label: "Next year (expected)", help: "Analysts' revenue estimate for next fiscal year against this year's.", kind: "growth", typical: REVENUE_TYPICAL },
    ],
  },
  {
    label: "Margins and sales multiples",
    metrics: [
      { id: "grossMargin", label: "Gross margin", help: "Gross profit as a share of revenue, over the last four quarters.", kind: "margin", typical: [0.4, 0.48] },
      { id: "netMargin", label: "Net margin", help: "Net income as a share of revenue, over the last four quarters.", kind: "margin", typical: [0.08, 0.1] },
      { id: "ttmPs", label: "TTM P/S", help: "Market cap divided by revenue over the last four quarters.", kind: "multiple", typical: PS_TYPICAL },
      { id: "forwardPs", label: "Forward P/S", help: "Market cap divided by analysts' revenue estimate for this fiscal year.", kind: "multiple", typical: PS_TYPICAL },
    ],
  },
  {
    label: "More EPS growth",
    metrics: [
      { id: "lastYearEpsGrowth", label: "Last fiscal year", help: "Reported EPS for the last fiscal year against the year before.", kind: "growth", typical: EPS_TYPICAL },
      { id: "ttmVsNtmEpsGrowth", label: "TTM vs next 12 months", help: "Expected EPS over the next twelve months (this year's and next year's estimates, weighted by the time left) against the last four quarters.", kind: "growth", typical: EPS_TYPICAL },
      { id: "latestQuarterEpsGrowth", label: "Latest quarter vs a year ago", help: "EPS in the latest reported quarter against the same quarter a year earlier.", kind: "growth", typical: EPS_TYPICAL },
      { id: "twoYearEpsGrowth", label: "2-year expected (stacked)", help: "Analysts' EPS estimate for next fiscal year against last year's reported EPS: this year's and next year's growth combined.", kind: "growth", typical: [0.16, 0.25] },
    ],
  },
  {
    label: "More revenue growth",
    metrics: [
      { id: "lastYearRevenueGrowth", label: "Last fiscal year", help: "Reported revenue for the last fiscal year against the year before.", kind: "growth", typical: REVENUE_TYPICAL },
      { id: "ttmVsNtmRevenueGrowth", label: "TTM vs next 12 months", help: "Expected revenue over the next twelve months (this year's and next year's estimates, weighted by the time left) against the last four quarters.", kind: "growth", typical: REVENUE_TYPICAL },
      { id: "latestQuarterRevenueGrowth", label: "Latest quarter vs a year ago", help: "Revenue in the latest reported quarter against the same quarter a year earlier.", kind: "growth", typical: REVENUE_TYPICAL },
      { id: "twoYearRevenueGrowth", label: "2-year expected (stacked)", help: "Analysts' revenue estimate for next fiscal year against last year's reported revenue.", kind: "growth", typical: [0.09, 0.13] },
    ],
  },
];

export type ComparisonMetrics = Record<MetricId, number | null>;

export type ComparedStock = {
  symbol: string;
  name: string;
  price: number;
  marketCap: number | null;
  // The fiscal years "this year" and "next year" refer to, by the calendar year they end in.
  currentYear: number | null;
  nextYear: number | null;
  // Where the reported figures came from: FMP, or SEC filings when FMP's plan doesn't cover the company.
  statementSource: "fmp" | "sec" | null;
  metrics: ComparisonMetrics;
};

export type ComparedStockResult =
  | { ok: true; data: ComparedStock }
  | { ok: false; symbol: string; reason: FmpFailureReason };

type Row = Record<string, unknown>;

function num(value: unknown): number | null {
  return numeric(typeof value === "number" ? value : null);
}

// Growth from a loss or zero means nothing, so it's left blank.
function growth(to: number | null | undefined, from: number | null | undefined): number | null {
  return to == null || from == null || from <= 0 ? null : to / from - 1;
}

// A multiple of a loss means nothing either.
function multiple(value: number | null, per: number | null | undefined): number | null {
  return value === null || per == null || per <= 0 ? null : value / per;
}

function positive(value: unknown): number | null {
  const parsed = num(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function percent(value: unknown): number | null {
  const parsed = num(value);
  return parsed === null ? null : parsed / 100;
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function newestFirst(rows: Row[]): Row[] {
  return rows
    .filter((row) => typeof row.date === "string")
    .sort((left, right) => String(right.date).localeCompare(String(left.date)));
}

// The first fiscal year that ends well after `after`: the year after a report, or after another estimate.
function estimateAfter(estimates: AnalystEstimate[], after: string): AnalystEstimate | null {
  const threshold = addDays(after, FISCAL_YEAR_GAP_DAYS);
  return estimates.find((estimate) => estimate.date > threshold) ?? null;
}

// Expected value over the next twelve months: this year's estimate for the part of it still ahead, and
// next year's for the rest.
function nextTwelveMonths(current: number | null, next: number | null, currentEnd: string, today: Date): number | null {
  if (current === null || next === null) return null;
  const remaining = Math.min(Math.max((Date.parse(`${currentEnd}T00:00:00Z`) - today.getTime()) / (365 * DAY_MS), 0), 1);
  return current * remaining + next * (1 - remaining);
}

// The latest quarter and the same quarter a year earlier, when the five quarters reach back that far.
function yearAgoQuarters(quarters: Row[]): [Row, Row] | null {
  const [latest, , , , yearAgo] = newestFirst(quarters);
  if (!latest || !yearAgo) return null;
  const days = (Date.parse(String(latest.date)) - Date.parse(String(yearAgo.date))) / DAY_MS;
  return days >= 350 && days <= 380 ? [latest, yearAgo] : null;
}

export type ComparisonInputs = {
  price: number;
  marketCap: number | null;
  // FMP-shaped income statement rows, in any order.
  quarters: Row[];
  annual: Row[];
  // Oldest first, as getAnalystEstimates returns them.
  estimates: AnalystEstimate[];
  // Finnhub's `stock/metric` figures: the trailing year-over-year growth, which needs eight quarters, and
  // stand-ins for the figures the statements can't give.
  finnhub: Row;
  today: Date;
};

export function computeComparison({ price, marketCap, quarters, annual, estimates, finnhub, today }: ComparisonInputs): {
  metrics: ComparisonMetrics;
  currentYear: number | null;
  nextYear: number | null;
} {
  const ttm = trailingTwelveMonths(quarters);
  const [lastYear, yearBefore] = newestFirst(annual);
  const eps = (row: Row | undefined) => num(row?.epsDiluted) ?? num(row?.eps);
  const revenue = (row: Row | undefined) => num(row?.revenue);

  // Without a reported year, the fiscal year in progress is the first that hasn't ended.
  const isoToday = today.toISOString().slice(0, 10);
  const current = lastYear
    ? estimateAfter(estimates, String(lastYear.date))
    : estimates.find((estimate) => estimate.date >= isoToday) ?? null;
  const next = current ? estimateAfter(estimates, current.date) : null;

  const ntmEps = current ? nextTwelveMonths(current.eps.avg, next?.eps.avg ?? null, current.date, today) : null;
  const ntmRevenue = current ? nextTwelveMonths(current.revenue.avg, next?.revenue.avg ?? null, current.date, today) : null;
  const sales = ttm.revenue;
  const quarterPair = yearAgoQuarters(quarters);

  return {
    currentYear: current ? Number(current.date.slice(0, 4)) : null,
    nextYear: next ? Number(next.date.slice(0, 4)) : null,
    metrics: {
      // Finnhub's trailing figures fill in when the statements are missing, not when there's a loss.
      ttmPe: ttm.eps === null ? positive(finnhub.peTTM) : multiple(price, ttm.eps),
      forwardPe: multiple(price, current?.eps.avg),
      twoYearForwardPe: multiple(price, next?.eps.avg),

      ttmEpsGrowth: percent(finnhub.epsGrowthTTMYoy),
      currentYearEpsGrowth: growth(current?.eps.avg, eps(lastYear)),
      nextYearEpsGrowth: growth(next?.eps.avg, current?.eps.avg),

      ttmRevenueGrowth: percent(finnhub.revenueGrowthTTMYoy),
      currentYearRevenueGrowth: growth(current?.revenue.avg, revenue(lastYear)),
      nextYearRevenueGrowth: growth(next?.revenue.avg, current?.revenue.avg),

      grossMargin: sales !== null && ttm.grossProfit !== null && sales > 0 ? ttm.grossProfit / sales : percent(finnhub.grossMarginTTM),
      netMargin: sales !== null && ttm.netIncome !== null && sales > 0 ? ttm.netIncome / sales : percent(finnhub.netProfitMarginTTM),
      ttmPs: sales === null ? positive(finnhub.psTTM) : multiple(marketCap, sales),
      forwardPs: multiple(marketCap, current?.revenue.avg),

      lastYearEpsGrowth: growth(eps(lastYear), eps(yearBefore)),
      ttmVsNtmEpsGrowth: growth(ntmEps, ttm.eps),
      latestQuarterEpsGrowth: quarterPair ? growth(eps(quarterPair[0]), eps(quarterPair[1])) : percent(finnhub.epsGrowthQuarterlyYoy),
      twoYearEpsGrowth: growth(next?.eps.avg, eps(lastYear)),

      lastYearRevenueGrowth: growth(revenue(lastYear), revenue(yearBefore)),
      ttmVsNtmRevenueGrowth: growth(ntmRevenue, sales),
      latestQuarterRevenueGrowth: quarterPair ? growth(revenue(quarterPair[0]), revenue(quarterPair[1])) : percent(finnhub.revenueGrowthQuarterlyYoy),
      twoYearRevenueGrowth: growth(next?.revenue.avg, revenue(lastYear)),
    },
  };
}

// The column with the best value in a row: the lowest multiple, or the highest growth or margin. Null
// when fewer than two stocks have a value, since there's nothing to compare.
export function bestIndex(values: (number | null)[], kind: MetricKind): number | null {
  let best: number | null = null;
  let count = 0;
  values.forEach((value, index) => {
    if (value === null) return;
    count++;
    if (best === null || (kind === "multiple" ? value < values[best]! : value > values[best]!)) best = index;
  });
  return count >= 2 ? best : null;
}

// Tickers from `symbols=CELH,MNST,KO`, upper-cased, without duplicates, up to the maximum.
export function parseSymbols(value: string | string[] | undefined): string[] {
  const raw = (Array.isArray(value) ? value.join(",") : value ?? "").split(/[\s,]+/);
  const symbols = raw.map(normalizeTicker).filter((symbol): symbol is string => symbol !== null);
  return [...new Set(symbols)].slice(0, MAX_COMPARED);
}

async function finnhubMetric(symbol: string): Promise<Row> {
  // Same request as the overview's growth rates, so both share one cached response.
  const result = await fetchFinnhub("stock/metric", { symbol: finnhubSymbol(symbol), metric: "all" }, DAILY_REVALIDATE_SECONDS);
  const metric = result.ok && result.payload && typeof result.payload === "object"
    ? (result.payload as { metric?: Row }).metric
    : undefined;
  return metric ?? {};
}

export async function getComparedStock(symbol: string, today = new Date()): Promise<ComparedStockResult> {
  const quote = await getHeaderQuote(symbol);
  if (!quote.ok) return { ok: false, symbol, reason: quote.reason };

  const [fmpQuarters, fmpAnnual, estimates, finnhub] = await Promise.all([
    optionalRows("income-statement", { symbol, period: "quarter", limit: "5" }),
    // Same parameters as the Financials page's request, so both share one cached response.
    optionalRows("income-statement", { symbol, limit: "5", period: "annual" }),
    getAnalystEstimates(symbol),
    finnhubMetric(symbol),
  ]);

  // Companies FMP's plan doesn't cover still have SEC filings.
  let quarters = fmpQuarters;
  let annual = fmpAnnual;
  let statementSource: ComparedStock["statementSource"] = quarters.length > 0 || annual.length > 0 ? "fmp" : null;
  if (quarters.length === 0 || annual.length === 0) {
    const sec = await getSecStatements(symbol);
    if (sec.ok) {
      if (quarters.length === 0) quarters = sec.data.quarterly.income;
      if (annual.length === 0) annual = sec.data.annual.income;
      statementSource = "sec";
    }
  }

  const { price, marketCap } = quote.data;
  return {
    ok: true,
    data: {
      symbol,
      name: quote.data.name,
      price,
      marketCap,
      statementSource,
      ...computeComparison({ price, marketCap, quarters, annual, estimates, finnhub, today }),
    },
  };
}

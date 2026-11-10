import stocks from "@/data/us-stocks.json";
import { getAnalystForecast, surprise, yearGrowth } from "../analyst-forecast";
import { getDailyCloses } from "../daily-closes";
import { addDays, defaultWeek, getEarningsWeek, isIsoDate, REPORT_TIMES, weekStart, type ReportTime } from "../earnings-calendar";
import { listFavorites } from "../favorites";
import { formatForPrompt } from "../financial-review";
import { getStatementTable, type StatementId, type StatementPeriod } from "../financial-statements";
import { finnhubFailureMessage } from "../finnhub";
import { getCompanyNews, getMarketNews, isNewsCategory, type NewsCategory, type NewsItem } from "../finnhub-news";
import { failureReason, normalizeTicker } from "../fmp";
import { providerFailureMessage } from "../fmp-messages";
import type { GeminiFunctionDeclaration } from "../gemini";
import { getInsiderActivity } from "../insiders";
import { listedName } from "../listed-companies";
import { EVENT_CATEGORIES, easternToday, formatRange, getMarketEvents } from "../market-events";
import { ExchangeRatesUnavailable, formatShares, getPortfolio, type Currency, type Income, type PortfolioView, type Trade } from "../portfolio";
import { getPortfolioCurrency, listIncome, listTrades } from "../portfolio-trades";
import { FILING_TYPES, filingMatches, getFilings, type FilingType } from "../sec-filings";
import { getHeaderQuote, getStockOverview } from "../stock-overview";
import { indexStocks, searchStocks, type StockEntry } from "../stock-search";
import { priceTrend, type PricePoint } from "../technicals";
import { ensureTranscriptSummary } from "../transcript-summary";
import { getTranscript, isFiscalQuarter, latestReport, previousQuarter, quarterLabel, transcriptFailureMessage, type FiscalQuarter } from "../transcripts";
import { getVix, vixStats, vixZone } from "../vix";

// The look-ups the AI chat can make in StockPilot's data. Each calls the loader of the page it mirrors, with
// the same parameters, so the two share cached responses, and hands the model formatted figures ("$466.8B",
// "+6.4%") to quote, as the AI reviews do. Missing figures are left out rather than sent as null.

export type ToolContext = { userId: string | null; now: Date };

export type ToolOutcome = { ok: true; output: Record<string, unknown> } | { ok: false; error: string };

export type ToolSource = { label: string; href: string | null };

type Args = Record<string, unknown>;

export type ChatTool = {
  declaration: GeminiFunctionDeclaration;
  // Reads the signed-in user's own data, so it's offered only with an account and a database.
  personal?: boolean;
  // What the chip under the answer says and the page it opens; null for look-ups not worth a chip.
  source(args: Args): ToolSource | null;
  run(args: Args, context: ToolContext): Promise<ToolOutcome>;
};

// --- Formatting -------------------------------------------------------------------------------------------

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function currencyFormat(value: number, currency: string, options: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, ...options }).format(value);
  } catch {
    return `${new Intl.NumberFormat("en-US", options).format(value)} ${currency}`;
  }
}

// Amounts: compact from a million ("$466.82B"), exact below it.
function money(value: number | null | undefined, currency = "USD"): string | null {
  if (!finite(value)) return null;
  return Math.abs(value) >= 1e6
    ? currencyFormat(value, currency, { notation: "compact", maximumFractionDigits: 2 })
    : currencyFormat(value, currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function price(value: number | null | undefined, currency = "USD"): string | null {
  return finite(value) ? currencyFormat(value, currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;
}

function signedMoney(value: number | null | undefined, currency = "USD"): string | null {
  if (!finite(value)) return null;
  const text = money(Math.abs(value), currency)!;
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
}

function percent(value: number | null | undefined, digits = 1): string | null {
  return finite(value) ? `${(value * 100).toFixed(digits)}%` : null;
}

function signedPercent(value: number | null | undefined, digits = 1): string | null {
  return finite(value) ? `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%` : null;
}

function ratio(value: number | null | undefined, digits = 1): string | null {
  return finite(value) ? value.toFixed(digits) : null;
}

function count(value: number | null | undefined): string | null {
  if (!finite(value)) return null;
  return new Intl.NumberFormat("en-US", Math.abs(value) >= 1e6 ? { notation: "compact", maximumFractionDigits: 2 } : { maximumFractionDigits: 0 }).format(value);
}

function priceRange(low: number | null | undefined, high: number | null | undefined, currency = "USD"): string | null {
  return finite(low) && finite(high) ? `${price(low, currency)} – ${price(high, currency)}` : null;
}

function moneyRange(low: number | null | undefined, high: number | null | undefined): string | null {
  return finite(low) && finite(high) ? `${money(low)} – ${money(high)}` : null;
}

function truncate(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trimEnd()}…`;
}

// Unix seconds, as New York time, where US stocks trade.
function newYorkTime(seconds: number | null): string | null {
  if (!finite(seconds)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(seconds * 1000));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")} ET`;
}

function utcTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function reportTime(time: ReportTime | null): string | null {
  return time && time !== "unknown" ? REPORT_TIMES.find((item) => item.id === time)!.label.toLowerCase() : null;
}

// Drops null and undefined fields (and objects left empty), so the model only reads what's known. Arrays keep
// their nulls: a blank in a statement's row is a period without the figure.
export function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => (item && typeof item === "object" ? compact(item) : item));
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, item]): [string, unknown][] => {
    if (item === null || item === undefined) return [];
    const cleaned = compact(item);
    if (cleaned && typeof cleaned === "object" && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0) return [];
    return [[key, cleaned]];
  });
  return Object.fromEntries(entries);
}

function ok(output: Record<string, unknown>): ToolOutcome {
  return { ok: true, output: compact(output) as Record<string, unknown> };
}

function fail(error: string): ToolOutcome {
  return { ok: false, error };
}

// --- Arguments --------------------------------------------------------------------------------------------

const SYMBOL_PARAMETER = { type: "STRING", description: "The US ticker, e.g. AAPL or BRK-B." };

// StockPilot writes share classes with a dash (BRK-B), as its stock list does.
function symbolArg(args: Args): string | null {
  return typeof args.symbol === "string" ? normalizeTicker(args.symbol.replace(/\./g, "-")) : null;
}

const NO_SYMBOL = fail("That isn't a valid ticker. Give one such as AAPL, or find it with find_stock.");

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

function params(path: string, values: Record<string, string | null>): string {
  const query = new URLSearchParams(Object.entries(values).flatMap(([key, value]) => (value ? [[key, value]] : []))).toString();
  return query ? `${path}?${query}` : path;
}

// --- Stock list -------------------------------------------------------------------------------------------

let stockIndex: ReturnType<typeof indexStocks> | null = null;

function findStocks(query: string) {
  stockIndex ??= indexStocks(stocks as StockEntry[]);
  return searchStocks(stockIndex, query, 6);
}

// --- Prices -----------------------------------------------------------------------------------------------

function shiftIso(iso: string, { months = 0, years = 0 }: { months?: number; years?: number }): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + years, date.getUTCMonth() + months, date.getUTCDate());
  return date.toISOString().slice(0, 10);
}

// The last close on or before a day; null when the history doesn't reach back that far.
function closeOn(points: PricePoint[], iso: string): PricePoint | null {
  for (let index = points.length - 1; index >= 0; index--) if (points[index].date <= iso) return points[index];
  return null;
}

export function pricePerformance(points: PricePoint[]) {
  const sorted = points.filter((point) => finite(point.close) && point.close > 0).sort((left, right) => left.date.localeCompare(right.date));
  const trend = priceTrend(sorted);
  const last = sorted.at(-1);
  if (!trend || !last) return null;
  const change = (from: PricePoint | null) => (from && from.date < last.date ? signedPercent(last.close / from.close - 1) : null);
  const year = sorted.slice(-252);
  const high = year.reduce((best, point) => (point.close > best.close ? point : best));
  const low = year.reduce((best, point) => (point.close < best.close ? point : best));
  const monthEnds = new Map<string, PricePoint>();
  for (const point of sorted) monthEnds.set(point.date.slice(0, 7), point);
  return {
    latestClose: price(last.close),
    date: last.date,
    change: {
      "1 week": change(closeOn(sorted, addDays(last.date, -7))),
      "1 month": change(closeOn(sorted, shiftIso(last.date, { months: -1 }))),
      "3 months": change(closeOn(sorted, shiftIso(last.date, { months: -3 }))),
      "6 months": change(closeOn(sorted, shiftIso(last.date, { months: -6 }))),
      "year to date": change(closeOn(sorted, `${Number(last.date.slice(0, 4)) - 1}-12-31`)),
      "1 year": change(closeOn(sorted, shiftIso(last.date, { years: -1 }))),
    },
    fiftyTwoWeekHigh: `${price(high.close)} on ${high.date}`,
    fiftyTwoWeekLow: `${price(low.close)} on ${low.date}`,
    belowFiftyTwoWeekHigh: signedPercent(last.close / high.close - 1),
    movingAverage60Day: price(trend.sma60),
    movingAverage200Day: price(trend.sma200),
    versus200DayAverage: trend.sma200 ? signedPercent(last.close / trend.sma200 - 1) : null,
    rsi14Day: ratio(trend.rsi14),
    monthEndCloses: [...monthEnds.entries()].slice(-13).map(([month, point]) => `${month}: ${price(point.close)}`),
  };
}

// --- News -------------------------------------------------------------------------------------------------

const HEADLINES = 12;

function headline(item: NewsItem) {
  return {
    published: utcTime(item.publishedAt),
    source: item.source,
    title: item.title,
    summary: item.summary || null,
    tickers: item.tickers.length ? item.tickers.slice(0, 6).join(", ") : null,
  };
}

const NEWS_LABELS: Record<NewsCategory, string> = {
  general: "Market news",
  merger: "M&A news",
  forex: "Forex news",
  crypto: "Crypto news",
};

// --- Statements -------------------------------------------------------------------------------------------

const STATEMENT_IDS: StatementId[] = ["income", "balance", "cash-flow", "ratios"];

const STATEMENT_LABELS: Record<StatementId, string> = {
  income: "income statement",
  balance: "balance sheet",
  "cash-flow": "cash flow",
  ratios: "ratios",
};

// --- The tools --------------------------------------------------------------------------------------------

const findStock: ChatTool = {
  declaration: {
    name: "find_stock",
    description: "Find US-listed stocks by company name, brand or ticker in StockPilot's list of about 5,900. Use it when you aren't sure of a ticker.",
    parameters: {
      type: "OBJECT",
      properties: { query: { type: "STRING", description: "A company name, brand or ticker, e.g. \"coca cola\" or \"google\"." } },
      required: ["query"],
    },
  },
  source: () => null,
  async run(args) {
    const query = typeof args.query === "string" ? args.query.slice(0, 100) : "";
    const matches = findStocks(query);
    return ok(matches.length ? { matches } : { matches: [], note: "No US-listed company matches. StockPilot covers US listings only." });
  },
};

const stockOverview: ChatTool = {
  declaration: {
    name: "get_stock_overview",
    description: [
      "Quote and key statistics for one US stock: price and today's change, market cap, trailing-twelve-month revenue,",
      "net income and EPS with their growth, P/E and forward P/E, dividend and yield, the day's and 52-week ranges, beta,",
      "the analysts' consensus rating and average price target, the next earnings date, and the company profile",
      "(sector, industry, CEO, employees, description). Call it once per company when comparing several.",
    ].join(" "),
    parameters: { type: "OBJECT", properties: { symbol: SYMBOL_PARAMETER }, required: ["symbol"] },
  },
  source(args) {
    const symbol = symbolArg(args);
    return symbol ? { label: `${symbol} overview`, href: params("/stock", { symbol }) } : { label: "Overview", href: null };
  },
  async run(args, { now }) {
    const symbol = symbolArg(args);
    if (!symbol) return NO_SYMBOL;
    const result = await getStockOverview(symbol, now);
    if (!result.ok) {
      return fail(result.reason === "no-data"
        ? `StockPilot has no quote for ${symbol}. Check the ticker with find_stock.`
        : providerFailureMessage(result.reason, `${symbol}'s quote`));
    }
    const data = result.data;
    const currency = data.currency;
    const profile = data.profile;
    return ok({
      symbol: data.symbol,
      name: data.name,
      exchange: data.exchange,
      currency,
      price: price(data.price, currency),
      change: signedMoney(data.change, currency),
      changePercent: signedPercent(data.changePercent, 2),
      quoteTime: newYorkTime(data.quoteTime),
      marketCap: money(data.marketCap, currency),
      trailingTwelveMonths: {
        revenue: money(data.revenueTtm, currency),
        revenueGrowth: signedPercent(data.revenueGrowth),
        netIncome: money(data.netIncomeTtm, currency),
        eps: price(data.epsTtm, currency),
        epsGrowth: signedPercent(data.epsGrowth),
      },
      sharesOutstanding: count(data.sharesOutstanding),
      peRatio: ratio(data.peRatio),
      forwardPe: ratio(data.forwardPe),
      dividend: data.dividendPerShare
        ? { perShareLastYear: price(data.dividendPerShare, currency), yield: percent(data.dividendYield, 2), lastExDividendDate: data.exDividendDate }
        : null,
      volume: count(data.volume),
      open: price(data.open, currency),
      previousClose: price(data.previousClose, currency),
      dayRange: priceRange(data.dayLow, data.dayHigh, currency),
      fiftyTwoWeekRange: priceRange(data.yearLow, data.yearHigh, currency),
      beta: ratio(data.beta, 2),
      analysts: {
        consensus: data.analystConsensus,
        analysts: data.analystCount,
        averagePriceTarget: price(data.priceTarget, currency),
        upsideToTarget: signedPercent(data.priceTargetUpside),
      },
      nextEarnings: data.earningsDate ? { date: data.earningsDate, time: reportTime(data.earningsTime) } : null,
      profile: profile
        ? {
            sector: profile.sector,
            industry: profile.industry,
            ceo: profile.ceo,
            employees: count(profile.employees),
            website: profile.website,
            fund: profile.isEtf ? "ETF" : profile.isFund ? "fund" : null,
            description: truncate(profile.description, 600),
          }
        : null,
      note: data.quoteSource === "finnhub"
        ? "Quote from Finnhub: FMP's free plan doesn't cover this company, so there's no volume and the statements come from SEC filings."
        : null,
    });
  },
};

const priceHistory: ChatTool = {
  declaration: {
    name: "get_price_history",
    description: [
      "How one stock's price has moved over the last year of daily closes: the change over a week, a month, 3 and 6 months,",
      "the year to date and a year, the 52-week high and low, the 60- and 200-day moving averages, the 14-day RSI and",
      "month-end closes.",
    ].join(" "),
    parameters: { type: "OBJECT", properties: { symbol: SYMBOL_PARAMETER }, required: ["symbol"] },
  },
  source(args) {
    const symbol = symbolArg(args);
    return symbol ? { label: `${symbol} price history`, href: params("/stock", { symbol }) } : { label: "Price history", href: null };
  },
  async run(args, { now }) {
    const symbol = symbolArg(args);
    if (!symbol) return NO_SYMBOL;
    let closes: PricePoint[];
    try {
      closes = await getDailyCloses(symbol, now);
    } catch (error) {
      return fail(providerFailureMessage(failureReason(error), `${symbol}'s prices`));
    }
    const performance = pricePerformance(closes);
    if (!performance) return fail(`StockPilot has no daily prices for ${symbol}.`);
    return ok({ symbol, ...performance });
  },
};

const financialStatement: ChatTool = {
  declaration: {
    name: "get_financial_statement",
    description: [
      "A company's reported financials for its last five fiscal years (annual) or quarters (quarterly), newest first, with",
      "the trailing twelve months (TTM): the income statement (revenue, costs, margins, EPS), the balance sheet (cash, debt,",
      "equity), the cash flow statement (operating and free cash flow, capital spending, buybacks, dividends) or ratios",
      "(valuation multiples, yields, returns and financial health).",
    ].join(" "),
    parameters: {
      type: "OBJECT",
      properties: {
        symbol: SYMBOL_PARAMETER,
        statement: { type: "STRING", enum: STATEMENT_IDS, description: "Which statement." },
        period: { type: "STRING", enum: ["annual", "quarterly"], description: "Fiscal years (the default) or quarters." },
      },
      required: ["symbol", "statement"],
    },
  },
  source(args) {
    const symbol = symbolArg(args);
    const statement = oneOf(args.statement, STATEMENT_IDS, "income");
    const quarterly = args.period === "quarterly";
    const label = `${STATEMENT_LABELS[statement]}${quarterly ? " (quarterly)" : ""}`;
    return symbol
      ? { label: `${symbol} ${label}`, href: params("/stock/financials", { symbol, statement, period: quarterly ? "quarterly" : null }) }
      : { label, href: null };
  },
  async run(args) {
    const symbol = symbolArg(args);
    if (!symbol) return NO_SYMBOL;
    if (!STATEMENT_IDS.some((id) => id === args.statement)) return fail("statement must be income, balance, cash-flow or ratios.");
    const statement = args.statement as StatementId;
    const period: StatementPeriod = args.period === "quarterly" ? "quarterly" : "annual";
    const result = await getStatementTable(symbol, statement, period);
    if (!result.ok) {
      return fail(result.reason === "no-data"
        ? `StockPilot has no ${STATEMENT_LABELS[statement]} for ${symbol}.`
        : providerFailureMessage(result.reason, `${symbol}'s financial statements`));
    }
    const table = result.data;
    return ok({
      symbol,
      statement: STATEMENT_LABELS[statement],
      period,
      currency: table.currency,
      source: table.source === "sec" ? "SEC filings" : "Financial Modeling Prep",
      columns: table.columns.map((column) => `${column.label}${column.periodEnding ? ` (${column.periodEnding})` : ""}`),
      rows: table.rows
        .filter((row) => row.values.some((value) => value !== null))
        .map((row) => ({ item: row.label, values: row.values.map((value) => formatForPrompt(value, row.format, table.currency)) })),
      note: "Columns run newest first; TTM is the trailing twelve months. A null value means that period doesn't have it.",
    });
  },
};

const analystForecast: ChatTool = {
  declaration: {
    name: "get_analyst_forecast",
    description: [
      "What analysts expect for one company: price targets (average, median, low, high) and how they've moved, the",
      "consensus rating with monthly rating counts, revenue and EPS estimates for the coming fiscal years after the last",
      "reported ones, recent upgrades and downgrades, and the latest quarterly results against estimates with the next",
      "report date.",
    ].join(" "),
    parameters: { type: "OBJECT", properties: { symbol: SYMBOL_PARAMETER }, required: ["symbol"] },
  },
  source(args) {
    const symbol = symbolArg(args);
    return symbol ? { label: `${symbol} forecast`, href: params("/stock/forecast", { symbol }) } : { label: "Forecast", href: null };
  },
  async run(args, { now }) {
    const symbol = symbolArg(args);
    if (!symbol) return NO_SYMBOL;
    const forecast = await getAnalystForecast(symbol, now);
    const last = forecast.closes.at(-1) ?? null;
    const { targets, ratings, earnings } = forecast;
    if (!targets && !ratings && forecast.estimates.length === 0 && !earnings) {
      return fail(`StockPilot has no analyst data for ${symbol}.`);
    }
    return ok({
      symbol,
      latestClose: last ? `${price(last.close)} on ${last.date}` : null,
      priceTargets: targets
        ? {
            average: price(targets.consensus),
            median: price(targets.median),
            low: price(targets.low),
            high: price(targets.high),
            upsideToAverage: last ? signedPercent(targets.consensus / last.close - 1) : null,
          }
        : null,
      averageTargetSet: forecast.targetTrend.map((period) => ({ period: period.label, targets: period.count, average: price(period.average) })),
      ratings: ratings
        ? {
            consensus: ratings.label,
            month: ratings.period.slice(0, 7),
            analysts: ratings.total,
            strongBuy: ratings.strongBuy,
            buy: ratings.buy,
            hold: ratings.hold,
            sell: ratings.sell,
            strongSell: ratings.strongSell,
            buyShare: percent(ratings.buyShare, 0),
            buyShareThreeMonthsEarlier: percent(ratings.buyShareBefore, 0),
          }
        : null,
      ratingsByMonth: forecast.ratingMonths.slice(0, 4).map((month) => (
        `${month.period.slice(0, 7)}: ${month.strongBuy} strong buy, ${month.buy} buy, ${month.hold} hold, ${month.sell} sell, ${month.strongSell} strong sell`
      )),
      revenueAndEps: forecast.estimates.map((year, index, years) => ({
        fiscalYear: year.year,
        kind: year.reported ? "reported" : "estimate",
        revenue: money(year.revenue),
        revenueGrowth: signedPercent(yearGrowth(year.revenue, years[index - 1]?.revenue ?? null)),
        revenueRange: year.reported ? null : moneyRange(year.revenueLow, year.revenueHigh),
        eps: price(year.eps),
        epsGrowth: signedPercent(yearGrowth(year.eps, years[index - 1]?.eps ?? null)),
        epsRange: year.reported ? null : priceRange(year.epsLow, year.epsHigh),
        analysts: year.analysts,
      })),
      ratingChangesLast90Days: forecast.actions.length ? forecast.actionCounts : null,
      recentRatingChanges: forecast.actions.slice(0, 8).map((action) => ({
        date: action.date,
        firm: action.firm,
        action: action.action,
        rating: action.previous && action.previous !== action.grade ? `${action.previous} → ${action.grade}` : action.grade,
      })),
      earnings: earnings
        ? {
            next: earnings.upcoming
              ? { date: earnings.upcoming.date, epsEstimate: price(earnings.upcoming.epsEstimate), revenueEstimate: money(earnings.upcoming.revenueEstimate) }
              : null,
            recent: earnings.past.map((report) => ({
              [report.dateIsQuarterEnd ? "quarterEnded" : "reported"]: report.date,
              eps: price(report.epsActual),
              epsEstimate: price(report.epsEstimate),
              epsSurprise: signedPercent(surprise(report.epsActual, report.epsEstimate)),
              revenue: money(report.revenueActual),
              revenueEstimate: money(report.revenueEstimate),
              revenueSurprise: signedPercent(surprise(report.revenueActual, report.revenueEstimate)),
            })),
          }
        : null,
      note: forecast.fmpCovered
        ? null
        : "FMP's free plan doesn't cover this company, so there are no price targets, estimates or rating changes; the ratings and earnings come from Finnhub.",
    });
  },
};

const companyNews: ChatTool = {
  declaration: {
    name: "get_company_news",
    description: "Headlines that mention one company from the last 14 days, newest first, with the source, the time (UTC) and a short summary.",
    parameters: { type: "OBJECT", properties: { symbol: SYMBOL_PARAMETER }, required: ["symbol"] },
  },
  source(args) {
    const symbol = symbolArg(args);
    return symbol ? { label: `${symbol} news`, href: params("/news", { symbol }) } : { label: "News", href: null };
  },
  async run(args, { now }) {
    const symbol = symbolArg(args);
    if (!symbol) return NO_SYMBOL;
    const result = await getCompanyNews(symbol, now);
    if (!result.ok) return fail(finnhubFailureMessage(result.reason, `${symbol}'s news`));
    if (result.items.length === 0) return ok({ symbol, headlines: [], note: "No headlines mention it in the last 14 days." });
    return ok({
      symbol,
      headlines: result.items.slice(0, HEADLINES).map(headline),
      moreHeadlines: result.items.length > HEADLINES ? result.items.length - HEADLINES : null,
    });
  },
};

const marketNews: ChatTool = {
  declaration: {
    name: "get_market_news",
    description: "The latest market headlines, newest first: general market news, or mergers and acquisitions, forex or crypto.",
    parameters: {
      type: "OBJECT",
      properties: { category: { type: "STRING", enum: ["general", "merger", "forex", "crypto"], description: "general (the default), merger, forex or crypto." } },
    },
  },
  source(args) {
    const category: NewsCategory = isNewsCategory(args.category) ? args.category : "general";
    return { label: NEWS_LABELS[category], href: params("/news", { category: category === "general" ? null : category }) };
  },
  async run(args) {
    const category: NewsCategory = isNewsCategory(args.category) ? args.category : "general";
    const result = await getMarketNews(category);
    if (!result.ok) return fail(finnhubFailureMessage(result.reason, "the news"));
    return ok({ category: NEWS_LABELS[category], headlines: result.items.slice(0, HEADLINES).map(headline) });
  },
};

const earningsCall: ChatTool = {
  declaration: {
    name: "get_earnings_call_summary",
    description: [
      "An AI summary of one company's earnings call, read from the transcript: how the quarter went, the highlights,",
      "guidance, what analysts asked and management's tone. Defaults to the latest reported quarter.",
    ].join(" "),
    parameters: {
      type: "OBJECT",
      properties: {
        symbol: SYMBOL_PARAMETER,
        quarter: { type: "STRING", description: "The fiscal quarter as YYYYQn, e.g. 2026Q3. Leave it out for the latest call." },
      },
      required: ["symbol"],
    },
  },
  source(args) {
    const symbol = symbolArg(args);
    const quarter = typeof args.quarter === "string" && isFiscalQuarter(args.quarter.toUpperCase()) ? (args.quarter.toUpperCase() as FiscalQuarter) : null;
    const label = `earnings call${quarter ? ` ${quarterLabel(quarter)}` : ""}`;
    return symbol ? { label: `${symbol} ${label}`, href: params("/stock/transcripts", { symbol, quarter }) } : { label, href: null };
  },
  async run(args, { now }) {
    const symbol = symbolArg(args);
    if (!symbol) return NO_SYMBOL;
    const requested = typeof args.quarter === "string" && args.quarter.trim() ? args.quarter.trim().toUpperCase() : null;
    if (requested && !isFiscalQuarter(requested)) return fail("Give the quarter as YYYYQn, e.g. 2026Q3.");
    const company = listedName(symbol) ?? symbol;
    // The latest call is often not transcribed for some days, so the one before stands in (at most two requests).
    const latest = requested ? (requested as FiscalQuarter) : (await latestReport(symbol, now.toISOString().slice(0, 10))).quarter;
    const quarters = requested ? [latest] : [latest, previousQuarter(latest)];
    for (const [index, quarter] of quarters.entries()) {
      const transcript = await getTranscript(symbol, quarter);
      if (!transcript.ok) {
        if (transcript.reason === "unavailable" && index < quarters.length - 1) continue;
        return fail(transcriptFailureMessage(transcript.reason, quarter));
      }
      const result = await ensureTranscriptSummary(symbol, quarter, company);
      if (!result.ok) return fail(result.error);
      const { summary } = result;
      return ok({
        symbol,
        company,
        quarter: quarterLabel(quarter),
        overview: summary.overview,
        highlights: summary.highlights,
        outlook: summary.outlook,
        analystQuestions: summary.analystQuestions,
        tone: summary.tone,
        toneReason: summary.toneReason,
        note: quarter !== latest ? `The ${quarterLabel(latest)} call isn't transcribed yet, so this is the one before.` : null,
      });
    }
    return fail(`No transcript of ${symbol}'s recent calls is available yet.`);
  },
};

const insiderTrades: ChatTool = {
  declaration: {
    name: "get_insider_trades",
    description: [
      "Insider buying and selling at one company over the last 12 months, from Form 4 filings: totals bought and sold,",
      "how much of the selling was under pre-arranged 10b5-1 plans, the most active insiders with their roles, and the",
      "latest trades.",
    ].join(" "),
    parameters: { type: "OBJECT", properties: { symbol: SYMBOL_PARAMETER }, required: ["symbol"] },
  },
  source(args) {
    const symbol = symbolArg(args);
    return symbol ? { label: `${symbol} insider trades`, href: params("/stock/insiders", { symbol }) } : { label: "Insider trades", href: null };
  },
  async run(args, { now }) {
    const symbol = symbolArg(args);
    if (!symbol) return NO_SYMBOL;
    const result = await getInsiderActivity(symbol, now);
    if (!result.ok) return fail(finnhubFailureMessage(result.reason, `${symbol}'s insider trades`));
    const { summary, people, transactions, from } = result.data;
    const trades = transactions.filter((transaction) => transaction.kind === "buy" || transaction.kind === "sale");
    return ok({
      symbol,
      since: from,
      bought: summary.buys.count
        ? { trades: summary.buys.count, insiders: summary.buys.insiders, shares: count(summary.buys.shares), value: money(summary.buys.value) }
        : "none in the market",
      sold: summary.sales.count
        ? {
            trades: summary.sales.count,
            insiders: summary.sales.insiders,
            shares: count(summary.sales.shares),
            value: money(summary.sales.value),
            underPreArrangedPlans: money(summary.sales.plannedValue),
          }
        : "none in the market",
      mostActive: people.filter((person) => person.trades > 0).slice(0, 8).map((person) => ({
        name: person.name,
        role: person.role,
        bought: person.bought ? money(person.bought) : null,
        sold: person.sold ? money(person.sold) : null,
        trades: person.trades,
        lastTrade: person.lastDate,
        sharesOwnedAfter: count(person.owned),
      })),
      latestTrades: trades.slice(0, 12).map((trade) => ({
        date: trade.date,
        name: trade.name,
        role: trade.role,
        type: trade.kind === "buy" ? "buy" : "sale",
        shares: count(Math.abs(trade.shares)),
        price: price(trade.price),
        value: money(trade.value),
        plan: trade.planned === null ? null : trade.planned ? "under a 10b5-1 plan" : "not under a plan",
      })),
      otherTransactions: transactions.length - trades.length || null,
      note: transactions.length === 0 ? "No insider filings in the last 12 months." : "Awards, option exercises, gifts and tax withholding aren't counted as buys or sales.",
    });
  },
};

const FILING_TYPE_IDS = FILING_TYPES.map((type) => type.id);

const secFilings: ChatTool = {
  declaration: {
    name: "get_sec_filings",
    description: "One company's latest SEC filings, newest first, with the form (10-K, 10-Q, 8-K…), the filing date, what it is and the period it covers.",
    parameters: {
      type: "OBJECT",
      properties: {
        symbol: SYMBOL_PARAMETER,
        type: {
          type: "STRING",
          enum: FILING_TYPE_IDS,
          description: "important (the default), reports (annual and quarterly), earnings (earnings releases), events (other 8-Ks), proxy or insider.",
        },
      },
      required: ["symbol"],
    },
  },
  source(args) {
    const symbol = symbolArg(args);
    const type = oneOf<FilingType>(args.type, FILING_TYPE_IDS, "important");
    return symbol
      ? { label: `${symbol} filings`, href: params("/stock/filings", { symbol, type: type === "important" ? null : type }) }
      : { label: "Filings", href: null };
  },
  async run(args) {
    const symbol = symbolArg(args);
    if (!symbol) return NO_SYMBOL;
    const type = oneOf<FilingType>(args.type, FILING_TYPE_IDS, "important");
    const result = await getFilings(symbol);
    if (!result.ok) {
      return fail(result.reason === "not-found" ? `SEC EDGAR has no filings under ${symbol}.` : "SEC EDGAR couldn't return the filings. Try again in a moment.");
    }
    const filings = result.data.filings.filter((filing) => filingMatches(filing, type)).slice(0, 12);
    return ok({
      symbol,
      company: result.data.name,
      type: FILING_TYPES.find((item) => item.id === type)!.label,
      filings: filings.map((filing) => ({ filed: filing.filed, form: filing.form, description: filing.description, period: filing.period })),
    });
  },
};

const EARNINGS_LISTED = 60;

const earningsCalendar: ChatTool = {
  declaration: {
    name: "get_earnings_calendar",
    description: [
      "Which companies report earnings in one week (Monday to Sunday), by day, with the time (before the open or after",
      "the close), EPS and revenue estimates, and once reported the results and surprises. Lists companies expecting",
      "at least $1B of quarterly revenue unless include_small is true.",
    ].join(" "),
    parameters: {
      type: "OBJECT",
      properties: {
        week_of: { type: "STRING", description: "Any date in the week, YYYY-MM-DD. Leave it out for this week (next week at weekends)." },
        include_small: { type: "BOOLEAN", description: "Also list companies expecting less than $1B of quarterly revenue." },
      },
    },
  },
  source(args) {
    const week = isIsoDate(args.week_of) ? weekStart(args.week_of) : null;
    return { label: week ? `Earnings week of ${week}` : "Earnings calendar", href: params("/earnings", { week, all: args.include_small === true ? "1" : null }) };
  },
  async run(args, { now }) {
    const today = easternToday(now);
    const start = isIsoDate(args.week_of) ? weekStart(args.week_of) : defaultWeek(today);
    const largeOnly = args.include_small !== true;
    const result = await getEarningsWeek(start, largeOnly);
    if (!result.ok) return fail(finnhubFailureMessage(result.reason, "the earnings calendar"));
    const week = result.data;
    const days: { date: string; reports: Record<string, unknown>[] }[] = [];
    let listed = 0;
    for (const day of week.days) {
      const events = day.groups.flatMap((group) => group.events).slice(0, Math.max(0, EARNINGS_LISTED - listed));
      listed += events.length;
      if (events.length === 0) continue;
      days.push({
        date: day.date,
        reports: events.map((event) => ({
          symbol: event.symbol,
          name: event.name,
          time: reportTime(event.time),
          epsEstimate: price(event.epsEstimate),
          revenueEstimate: money(event.revenueEstimate),
          eps: price(event.epsActual),
          epsSurprise: signedPercent(event.epsSurprise),
          revenue: money(event.revenueActual),
          revenueSurprise: signedPercent(event.revenueSurprise),
        })),
      });
    }
    return ok({
      week: `${week.start} to ${week.end}`,
      today,
      companiesListed: week.shown,
      companiesReportingInAll: largeOnly ? week.total : null,
      reportedSoFar: week.reported,
      beatEpsEstimates: week.beats,
      days,
      note: week.shown > EARNINGS_LISTED ? `Only the first ${EARNINGS_LISTED} of ${week.shown} reports are listed here; the Earnings page has them all.` : null,
    });
  },
};

const marketEvents: ChatTool = {
  declaration: {
    name: "get_market_events",
    description: [
      "Market-moving events from the official calendars: Fed meetings and rate decisions with the current fed funds",
      "target range, CPI, jobs, PCE, GDP and other US releases, and US and major foreign elections, coming up and in",
      "the last three weeks.",
    ].join(" "),
    parameters: {
      type: "OBJECT",
      properties: { days_ahead: { type: "INTEGER", description: "How far ahead to look, 7 to 365 days (45 by default)." } },
    },
  },
  source: () => ({ label: "Market events", href: "/events" }),
  async run(args, { now }) {
    const daysAhead = Math.min(365, Math.max(7, typeof args.days_ahead === "number" && Number.isFinite(args.days_ahead) ? Math.round(args.days_ahead) : 45));
    const data = await getMarketEvents(now);
    const { today } = data;
    const until = addDays(today, daysAhead);
    const category = (id: string) => EVENT_CATEGORIES.find((item) => item.id === id)?.label ?? id;
    const upcoming = data.events.filter((event) => (event.endDate ?? event.date) >= today && event.date <= until).slice(0, 40);
    const recent = data.events.filter((event) => (event.endDate ?? event.date) < today && event.date >= addDays(today, -21)).slice(-12);
    if (upcoming.length === 0 && recent.length === 0 && data.missing.length > 0) {
      return fail("The official calendars couldn't be loaded. Try again in a moment.");
    }
    return ok({
      today,
      fedFundsTarget: data.fed
        ? {
            range: formatRange(data.fed.lower, data.fed.upper),
            asOf: data.fed.asOf,
            lastChange: data.fed.lastChange
              ? `${data.fed.lastChange.change > 0 ? "+" : ""}${data.fed.lastChange.change.toFixed(2)} pt on ${data.fed.lastChange.date}`
              : null,
          }
        : null,
      upcoming: upcoming.map((event) => ({
        date: event.monthOnly ? `${event.date.slice(0, 7)} (day not announced)` : event.date,
        endDate: event.endDate,
        time: event.time ? `${event.time} ET` : null,
        title: event.title,
        category: category(event.category),
        importance: event.importance,
        detail: truncate(event.detail, 200),
      })),
      recent: recent.map((event) => ({ date: event.date, title: event.title, outcome: event.outcome })),
      unavailableSources: data.missing.length ? data.missing : null,
    });
  },
};

const fearGauge: ChatTool = {
  declaration: {
    name: "get_fear_gauge",
    description: [
      "The VIX volatility index as a fear and greed gauge: today's value and change, its zone (extreme fear to extreme",
      "greed), what that zone means, and how it compares with a week, a month and a year ago and its long-run average.",
    ].join(" "),
  },
  source: () => ({ label: "Fear gauge (VIX)", href: "/vix" }),
  async run(_, { now }) {
    const result = await getVix(now);
    if (!result.ok) return fail(providerFailureMessage(result.reason, "the VIX"));
    const { quote } = result.data;
    const zone = vixZone(quote.value);
    const stats = vixStats(result.data);
    return ok({
      vix: quote.value.toFixed(2),
      date: quote.date,
      change: finite(quote.change) ? `${quote.change > 0 ? "+" : ""}${quote.change.toFixed(2)}` : null,
      changePercent: signedPercent(quote.changePercent),
      zone: zone.label,
      meaning: zone.meaning,
      zones: "Under 12 extreme greed, 12–16 greed, 16–20 neutral, 20–30 fear, 30 and over extreme fear.",
      earlier: stats.comparisons.flatMap((comparison) => (comparison.point
        ? [{ when: comparison.label, date: comparison.point.date, vix: comparison.point.close.toFixed(2), zone: vixZone(comparison.point.close).label }]
        : [])),
      pastYear: {
        low: ratio(stats.yearLow, 2),
        high: ratio(stats.yearHigh, 2),
        average: ratio(stats.yearAverage, 2),
        higherThan: stats.yearPercentile !== null ? `${percent(stats.yearPercentile, 0)} of the year's closes` : null,
      },
      longRunAverage: stats.longRunAverage !== null ? `${ratio(stats.longRunAverage, 2)} since ${stats.longRunSince}` : null,
    });
  },
};

const myPortfolio: ChatTool = {
  personal: true,
  declaration: {
    name: "get_my_portfolio",
    description: [
      "The signed-in user's own portfolio in StockPilot: its value, cost, gain and today's change, realized gains,",
      "dividends and interest, expected yearly income, its time-weighted return against the S&P 500, each holding",
      "(shares, average cost, price, value, weight, gain, industry), the weights by industry and closed positions.",
    ].join(" "),
  },
  source: () => ({ label: "Your portfolio", href: "/portfolio" }),
  async run(_, { userId, now }) {
    if (!userId) return fail("The user isn't signed in.");
    let loaded: [Trade[], Income[], Currency];
    try {
      loaded = await Promise.all([listTrades(userId), listIncome(userId), getPortfolioCurrency(userId)]);
    } catch {
      return fail("The database didn't respond, so the portfolio couldn't be loaded.");
    }
    const [trades, income, base] = loaded;
    if (trades.length === 0) {
      return ok({ holdings: [], note: "No trades are recorded yet. They can be added, or imported from a Trading 212 or Trade Republic statement, on the Portfolio page." });
    }
    let view: PortfolioView;
    try {
      view = await getPortfolio(trades, now, base, income);
    } catch (error) {
      return fail(error instanceof ExchangeRatesUnavailable
        ? "The ECB's exchange rates couldn't be loaded, so the portfolio couldn't be valued in euros. Try again in a moment."
        : "The portfolio couldn't be valued. Try again in a moment.");
    }
    const currency = view.currency;
    const { totals } = view;
    const first = view.history[0];
    const last = view.history.at(-1);
    const exact = (value: number | null) => price(value, currency);
    const signedExact = (value: number | null) => (finite(value) ? `${value > 0 ? "+" : value < 0 ? "-" : ""}${exact(Math.abs(value))}` : null);
    const realizedClosed = view.closed.reduce((sum, position) => sum + position.realized, 0);
    return ok({
      currency,
      asOf: view.today,
      totals: {
        value: exact(totals.value),
        cost: exact(totals.cost),
        gain: signedExact(totals.gain),
        gainPercent: signedPercent(totals.gainPercent),
        todayChange: signedExact(totals.dayChange),
        todayChangePercent: signedPercent(totals.dayChangePercent, 2),
        realizedGains: signedExact(totals.realized),
        dividends: exact(totals.dividends),
        interest: totals.interest ? exact(totals.interest) : null,
        totalProfit: signedExact(totals.profit),
        expectedYearlyIncome: exact(totals.annualIncome),
        incomeYield: percent(totals.incomeYield, 2),
        holdingsWithoutLivePrice: totals.stalePrices || null,
      },
      performance: first && last && last.date > first.date
        ? {
            since: first.date,
            portfolioReturn: signedPercent(last.growth / first.growth - 1),
            sp500Return: first.benchmark && last.benchmark ? signedPercent(last.benchmark / first.benchmark - 1) : null,
            note: "Time-weighted with dividends, so money added or taken out isn't counted as a gain or a loss.",
          }
        : null,
      holdings: view.holdings.map((holding) => ({
        symbol: holding.priced ? holding.symbol : null,
        label: holding.priced ? null : holding.label,
        name: holding.name,
        industry: holding.industry,
        shares: formatShares(holding.shares),
        averageCost: exact(holding.averageCost),
        price: exact(holding.price),
        priceIs: holding.priceSource === "live" ? null : holding.priceSource === "close" ? "the latest close" : "the last trade's price",
        value: exact(holding.value),
        weight: percent(holding.weight),
        gain: signedExact(holding.gain),
        gainPercent: signedPercent(holding.gainPercent),
        todayChangePercent: signedPercent(holding.dayChangePercent, 2),
        dividendsReceived: holding.dividends ? exact(holding.dividends) : null,
        expectedYearlyDividend: holding.annualDividend ? exact(holding.annualDividend) : null,
      })),
      industries: view.industries.map((industry) => `${industry.name}: ${percent(industry.weight)}`),
      closedPositions: view.closed.length
        ? {
            count: view.closed.length,
            realized: signedExact(realizedClosed),
            latest: view.closed.slice(0, 5).map((position) => ({ label: position.label, name: position.name, realized: signedExact(position.realized), soldOn: position.soldOn })),
          }
        : null,
      trades: view.trades.length,
      lastTrade: view.trades[0]?.date ?? null,
    });
  },
};

const myFavorites: ChatTool = {
  personal: true,
  declaration: {
    name: "get_my_favorites",
    description: "The companies the signed-in user follows in Favorites, newest first, with each one's price, today's change and market cap.",
  },
  source: () => ({ label: "Your favorites", href: "/favorites" }),
  async run(_, { userId }) {
    if (!userId) return fail("The user isn't signed in.");
    let favorites: Awaited<ReturnType<typeof listFavorites>>;
    try {
      favorites = await listFavorites(userId);
    } catch {
      return fail("The database didn't respond, so the favorites couldn't be loaded.");
    }
    if (favorites.length === 0) return ok({ favorites: [], note: "No favorites yet. Companies are added with Add to favorites beside their name." });
    // The same quotes as the Favorites page, cached for a minute.
    const quotes = await Promise.all(favorites.map((favorite) => getHeaderQuote(favorite.symbol)));
    return ok({
      favorites: favorites.map((favorite, index) => {
        const quote = quotes[index];
        return quote.ok
          ? { symbol: favorite.symbol, name: quote.data.name, price: price(quote.data.price), changeToday: signedPercent(quote.data.changePercent, 2), marketCap: money(quote.data.marketCap) }
          : { symbol: favorite.symbol, name: listedName(favorite.symbol), price: "unavailable" };
      }),
    });
  },
};

export const CHAT_TOOLS: ChatTool[] = [
  findStock,
  stockOverview,
  priceHistory,
  financialStatement,
  analystForecast,
  companyNews,
  earningsCall,
  insiderTrades,
  secFilings,
  marketNews,
  earningsCalendar,
  marketEvents,
  fearGauge,
  myPortfolio,
  myFavorites,
];

export function chatTools({ personal }: { personal: boolean }): ChatTool[] {
  return CHAT_TOOLS.filter((tool) => personal || !tool.personal);
}

// Never throws: a failure becomes an error the model can explain.
export async function runChatTool(tools: ChatTool[], name: string, args: Args, context: ToolContext): Promise<ToolOutcome> {
  const tool = tools.find((item) => item.declaration.name === name);
  if (!tool) return fail(`There is no ${name} look-up.`);
  try {
    return await tool.run(args, context);
  } catch (error) {
    console.error(`Chat tool ${name} failed:`, error);
    return fail("That data couldn't be loaded. Try again in a moment.");
  }
}

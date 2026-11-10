import stockList from "@/data/us-stocks.json";
import { mapLimit } from "./concurrency";
import { addDays } from "./earnings-calendar";
import { fetchFinnhub, finnhubSymbol } from "./finnhub";
import { fxFrom, getEurPerUsd, SAME_CURRENCY, type Currency, type Fx } from "./fx";
import { daysBetween, easternToday } from "./market-events";
import { getTiingoDays, getTiingoName, isTiingoConfigured, tiingoStartDate, type TiingoDay } from "./tiingo";

export type { Currency } from "./fx";

// The Portfolio: what a user owns, worked out from the trades they record (see docs/portfolio.md). Prices come
// from Finnhub's quote (live, a minute old at most) and Tiingo's daily history, which also has each split and
// dividend; a portfolio costs no FMP requests. It's kept in dollars or euros: market prices are in dollars, and
// every amount is converted at the ECB rate of its own day (lib/fx.ts), as are trades made in the other currency.

const QUOTE_REVALIDATE_SECONDS = 60;
const DAILY_REVALIDATE_SECONDS = 60 * 60 * 24;
// Tickers loaded at once: two Finnhub requests each (30 a second allowed) and one Tiingo request each.
const FINNHUB_CONCURRENCY = 3;
const TIINGO_CONCURRENCY = 4;
// Brokers count fractional shares to six decimals; anything smaller is rounding.
const SHARE_EPSILON = 1e-6;

// Each ticker with prices costs a Tiingo request a day (50 an hour on the free plan) and two Finnhub requests a
// minute. Instruments without prices, trades and payments cost nothing but the arithmetic, and a busy account's
// statement holds thousands.
export const MAX_SYMBOLS = 30;
export const MAX_TRADES = 10_000;
export const MAX_INCOME = 10_000;
// The S&P 500, through the SPDR ETF: its adjusted closes include the dividends, as the portfolio's do.
export const BENCHMARK = "SPY";

export type TradeSide = "buy" | "sell";

// A trade as the user entered or imported it: shares and the price per share as traded, before any later split,
// in the currency it was paid in.
export type Trade = {
  id: number;
  symbol: string;
  side: TradeSide;
  shares: number;
  price: number;
  currency: Currency;
  date: string;
  // Imported from a broker's statement rather than entered by hand.
  imported?: boolean;
  // False for an instrument StockPilot keeps no prices for: a company sold off before it was imported, or one
  // with no US listing. Its symbol is its ISIN, and its gains come from its trades alone.
  priced?: boolean;
  // What to call such an instrument: the broker's code ("NVD"), and its name when one is known.
  label?: string | null;
  name?: string | null;
};

export type TradeInput = Pick<Trade, "symbol" | "side" | "shares" | "currency" | "date"> & { price: number | null };

// A trade to save; an imported one carries the broker's id, so importing the same statement twice adds it once.
export type NewTrade = Omit<Trade, "id" | "imported"> & { externalId?: string | null; isin?: string | null };

// A dividend (after withholding tax) or interest payment, imported from a broker's statement. A dividend's symbol
// is its position's.
export type Income = { kind: "dividend" | "interest"; symbol: string | null; amount: number; currency: Currency; date: string };

export type NewIncome = Income & { isin: string | null; externalId: string };

// Market prices are in dollars, so a portfolio shown in euros, or holding trades made in euros, needs the ECB's
// rates; without them it can't be worked out.
export class ExchangeRatesUnavailable extends Error {
  constructor() {
    super("The euro exchange rates couldn't be loaded.");
    this.name = "ExchangeRatesUnavailable";
  }
}

export type Split = { date: string; factor: number };

export type LedgerTrade = Trade & {
  // The trade in today's shares: the shares multiplied by the splits since, and the price divided by them,
  // unless it was entered that way already. The price is in the portfolio's currency, at the trade day's rate.
  adjustedShares: number;
  adjustedPrice: number;
  // The splits applied, oldest first.
  splits: Split[];
  // For a sell: the gain over the average cost of the shares sold.
  realized: number | null;
  // A sell of more shares than were held then; only the shares held count.
  oversold: boolean;
  // The shares held and what they cost after this trade, in today's shares.
  heldAfter: number;
  costAfter: number;
};

export type Position = {
  symbol: string;
  shares: number;
  cost: number;
  realized: number;
  // Dividends earned while held, counted on each ex-dividend date.
  dividends: number;
  // Dividends per share (today's shares) with ex-dates in the last 12 months; null without Tiingo's prices.
  trailingDividend: number | null;
  trades: LedgerTrade[];
};

export function formatShares(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

export function splitsOf(days: TiingoDay[]): Split[] {
  return days.filter((day) => day.splitFactor !== 1).map((day) => ({ date: day.date, factor: day.splitFactor }));
}

// How many of today's shares one share on `date` has become: the product of the splits after that day.
export function splitFactorAfter(splits: Split[], date: string): number {
  return splits.reduce((factor, split) => (split.date > date ? factor * split.factor : factor), 1);
}

// The last trading day on or before `date`, from days sorted oldest first.
export function dayOnOrBefore(days: TiingoDay[], date: string): TiingoDay | null {
  let low = 0;
  let high = days.length - 1;
  let found: TiingoDay | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (days[middle].date <= date) {
      found = days[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

// A trade in today's shares. A trade confirmation shows the shares and price as traded, but a broker's history
// may show them after later splits; whichever the user entered, the price tells: it's closer to that day's
// close as traded, or to the close divided by the splits since. `toUsd` gives the price in dollars, which the
// closes are in, and is only asked when there's a split to check; the price returned stays in the trade's currency.
export function adjustForSplits(
  trade: Trade,
  days: TiingoDay[],
  splits: Split[],
  toUsd: (price: number) => number = (price) => price,
): { shares: number; price: number; splits: Split[] } {
  const later = splits.filter((split) => split.date > trade.date);
  const factor = later.reduce((product, split) => product * split.factor, 1);
  if (factor === 1) return { shares: trade.shares, price: trade.price, splits: [] };
  const day = dayOnOrBefore(days, trade.date);
  const usdPrice = day ? toUsd(trade.price) : 0;
  if (day && Math.abs(Math.log((usdPrice * factor) / day.close)) < Math.abs(Math.log(usdPrice / day.close))) {
    return { shares: trade.shares, price: trade.price, splits: [] };
  }
  return { shares: trade.shares * factor, price: trade.price / factor, splits: later };
}

// One ticker's trades, oldest first, at average cost: a sale takes its shares at the average cost of those held,
// and the difference from its price is the realized gain. Amounts are in `base`, each converted at its day's rate.
export function buildPosition(symbol: string, trades: Trade[], days: TiingoDay[] | null, today: string, base: Currency = "USD", fx: Fx = SAME_CURRENCY): Position {
  const splits = days ? splitsOf(days) : [];
  const dividendDays = days ? days.filter((day) => day.divCash > 0) : [];
  const ordered = [...trades].sort((left, right) => left.date.localeCompare(right.date) || left.id - right.id);
  let shares = 0;
  let cost = 0;
  let realized = 0;
  let dividends = 0;
  let paid = 0;
  // A dividend goes to the shares held the day before its ex-dividend date: a buy on that date misses it, and
  // a sale on it still gets it.
  const payThrough = (date: string) => {
    for (; paid < dividendDays.length && dividendDays[paid].date <= date; paid++) {
      const day = dividendDays[paid];
      if (shares > 0) dividends += (shares / splitFactorAfter(splits, day.date)) * fx.convert(day.divCash, "USD", base, day.date);
    }
  };

  const ledger = ordered.map((trade): LedgerTrade => {
    payThrough(trade.date);
    const adjusted = adjustForSplits(trade, days ?? [], splits, (price) => fx.convert(price, trade.currency, "USD", trade.date));
    const price = fx.convert(adjusted.price, trade.currency, base, trade.date);
    let gain: number | null = null;
    let oversold = false;
    if (trade.side === "buy") {
      shares += adjusted.shares;
      cost += adjusted.shares * price;
    } else {
      const sold = Math.min(adjusted.shares, shares);
      const average = shares > 0 ? cost / shares : 0;
      gain = sold * (price - average);
      oversold = adjusted.shares - sold > SHARE_EPSILON;
      realized += gain;
      shares -= sold;
      cost -= sold * average;
      if (shares <= SHARE_EPSILON) {
        shares = 0;
        cost = 0;
      }
    }
    return { ...trade, adjustedShares: adjusted.shares, adjustedPrice: price, splits: adjusted.splits, realized: gain, oversold, heldAfter: shares, costAfter: cost };
  });
  payThrough(today);

  const yearAgo = addDays(today, -365);
  const trailingDividend = days
    ? dividendDays
        .filter((day) => day.date > yearAgo && day.date <= today)
        .reduce((total, day) => total + fx.convert(day.divCash / splitFactorAfter(splits, day.date), "USD", base, day.date), 0)
    : null;
  return { symbol, shares, cost, realized, dividends, trailingDividend, trades: ledger };
}

export type HistoryPoint = {
  date: string;
  // The holdings at that day's close, and what they cost.
  value: number;
  cost: number;
  // The holdings' growth since the first day as a multiple (1.12 is +12%): each day's return on what was held
  // the day before, dividends included, so money put in or taken out isn't counted as a gain or a loss.
  growth: number;
  // The S&P 500's growth over the same days, dividends included; null before its first price.
  benchmark: number | null;
};

// Prices for a last point after the latest close: each ticker's live price in dollars, in today's shares.
export type LivePoint = { date: string; prices: Map<string, number>; benchmark: number | null };

// The portfolio's value, cost and growth at every close since the first trade, from each ticker's daily
// prices (all of them needed), and a last point at live prices when there is one. In `base`, so a portfolio in
// euros grows or shrinks with the dollar too, and so does the S&P 500 it's measured against.
export function buildHistory(
  positions: Position[],
  daysBySymbol: Map<string, TiingoDay[]>,
  benchmarkDays: TiingoDay[] | null,
  live?: LivePoint,
  base: Currency = "USD",
  fx: Fx = SAME_CURRENCY,
): HistoryPoint[] {
  const trades = positions.flatMap((position) => position.trades);
  if (trades.length === 0) return [];
  const first = trades.reduce((earliest, trade) => (trade.date < earliest ? trade.date : earliest), trades[0].date);
  const calendar = new Set<string>();
  for (const days of [...daysBySymbol.values(), benchmarkDays ?? []]) {
    for (const day of days) if (day.date >= first) calendar.add(day.date);
  }

  const states = positions.map((position) => {
    const days = daysBySymbol.get(position.symbol) ?? [];
    return {
      position,
      days,
      splits: splitsOf(days),
      dayIndex: 0,
      tradeIndex: 0,
      shares: 0,
      cost: 0,
      // The latest close in today's shares, and the same day's adjusted close.
      price: null as number | null,
      adjusted: null as number | null,
    };
  });
  const benchmark = { days: benchmarkDays ?? [], index: 0, last: null as TiingoDay | null, start: null as number | null };
  const inBase = (usd: number, date: string) => fx.convert(usd, "USD", base, date);
  let growth = 1;
  const points: HistoryPoint[] = [];

  const step = (date: string, livePrices?: LivePoint) => {
    let before = 0;
    let change = 0;
    for (const state of states) {
      let price = state.price;
      let adjusted = state.adjusted;
      if (livePrices) {
        const liveUsd = livePrices.prices.get(state.position.symbol);
        if (liveUsd !== undefined) {
          const livePrice = inBase(liveUsd, livePrices.date);
          adjusted = adjusted !== null && price !== null ? adjusted * (livePrice / price) : null;
          price = livePrice;
        }
      } else {
        let row: TiingoDay | null = null;
        while (state.dayIndex < state.days.length && state.days[state.dayIndex].date <= date) row = state.days[state.dayIndex++];
        if (row) {
          price = inBase(row.close / splitFactorAfter(state.splits, row.date), row.date);
          adjusted = inBase(row.adjClose, row.date);
        }
      }
      // The day's return on the shares held at the previous close.
      if (state.shares > 0 && state.price !== null && price !== null) {
        const ratio = state.adjusted !== null && adjusted !== null ? adjusted / state.adjusted : price / state.price;
        before += state.shares * state.price;
        change += state.shares * state.price * (ratio - 1);
      }
      state.price = price;
      state.adjusted = adjusted;
      // Then the day's trades.
      const ledger = state.position.trades;
      while (state.tradeIndex < ledger.length && ledger[state.tradeIndex].date <= date) {
        const trade = ledger[state.tradeIndex++];
        state.shares = trade.heldAfter;
        state.cost = trade.costAfter;
        state.price ??= trade.adjustedPrice;
      }
    }
    if (before > 0) growth *= 1 + change / before;

    let benchmarkGrowth: number | null = null;
    if (livePrices) {
      if (benchmark.last && benchmark.start && livePrices.benchmark !== null) {
        benchmarkGrowth = inBase(benchmark.last.adjClose * (livePrices.benchmark / benchmark.last.close), livePrices.date) / benchmark.start;
      }
    } else {
      while (benchmark.index < benchmark.days.length && benchmark.days[benchmark.index].date <= date) benchmark.last = benchmark.days[benchmark.index++];
      if (benchmark.last) {
        const level = inBase(benchmark.last.adjClose, benchmark.last.date);
        benchmark.start ??= level;
        benchmarkGrowth = level / benchmark.start;
      }
    }
    points.push({
      date,
      value: states.reduce((total, state) => total + state.shares * (state.price ?? 0), 0),
      cost: states.reduce((total, state) => total + state.cost, 0),
      growth,
      benchmark: benchmarkGrowth,
    });
  };

  for (const date of [...calendar].sort()) step(date);
  if (live && points.length > 0 && live.date > points[points.length - 1].date) step(live.date, live);
  // A single day isn't a history.
  return points.length > 1 ? points : [];
}

type Row = Record<string, unknown>;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type Market = {
  // "unknown" when Finnhub refuses the ticker (its free quote covers every US stock and fund, so a refusal means
  // it doesn't know it) or answers with no price.
  status: "ok" | "unknown" | "failed";
  price: number | null;
  change: number | null;
  changePercent: number | null;
  name: string | null;
  industry: string | null;
};

// The live quote and, for holdings, the company profile: the same cached requests as the company pages.
async function marketInfo(symbol: string, withProfile: boolean): Promise<Market> {
  const ticker = finnhubSymbol(symbol);
  const [quote, profile] = await Promise.all([
    fetchFinnhub("quote", { symbol: ticker }, QUOTE_REVALIDATE_SECONDS),
    withProfile ? fetchFinnhub("stock/profile2", { symbol: ticker }, DAILY_REVALIDATE_SECONDS) : null,
  ]);
  const q = quote.ok ? (quote.payload as Row | null) : null;
  const price = num(q?.c);
  const p = profile?.ok ? ((profile.payload as Row | null) ?? {}) : {};
  const changePercent = num(q?.dp);
  return {
    status: quote.ok ? (price !== null && price > 0 ? "ok" : "unknown") : quote.reason === "plan-restricted" ? "unknown" : "failed",
    price: price !== null && price > 0 ? price : null,
    change: num(q?.d),
    changePercent: changePercent === null ? null : changePercent / 100,
    name: str(p.name),
    industry: str(p.finnhubIndustry),
  };
}

let listedNames: Map<string, string> | null = null;

// Names from the bundled list of US stocks, for when Finnhub's profile is missing.
export function listedName(symbol: string): string | null {
  listedNames ??= new Map((stockList as [string, string, number][]).map(([ticker, name]) => [ticker, name]));
  return listedNames.get(symbol) ?? null;
}

// Finnhub's company profile has no industry for funds; their names give them away.
const FUND_NAME = /\b(ETF|ETN|Fund|Trust|Index|iShares|SPDR|Vanguard|Invesco|Schwab)\b/i;

function industryOf(industry: string | null, name: string | null): string {
  if (industry) return industry;
  return name && FUND_NAME.test(name) ? "Funds" : "Other";
}

export type Holding = {
  symbol: string;
  // What's shown in bold: the ticker, or the broker's code for an instrument without prices.
  label: string;
  name: string;
  priced: boolean;
  industry: string;
  shares: number;
  averageCost: number;
  cost: number;
  price: number;
  // "live" from Finnhub's quote; "close" the latest close when the quote failed; "trade" the last trade's price
  // when there's neither.
  priceSource: "live" | "close" | "trade";
  // Today's change in dollars and as a share, from the live quote.
  dayChange: number | null;
  dayChangePercent: number | null;
  value: number;
  gain: number;
  gainPercent: number | null;
  realized: number;
  dividends: number;
  // The last 12 months' dividends per share times the shares held.
  annualDividend: number | null;
  weight: number;
};

export type ClosedPosition = { symbol: string; label: string; name: string; priced: boolean; realized: number; dividends: number; soldOn: string };

export type IndustryWeight = { name: string; value: number; weight: number };

export type PortfolioTotals = {
  value: number;
  cost: number;
  gain: number;
  gainPercent: number | null;
  dayChange: number | null;
  dayChangePercent: number | null;
  // Holdings valued without a live price.
  stalePrices: number;
  // From every position, closed ones included.
  realized: number;
  dividends: number;
  // Interest on cash, imported from a statement.
  interest: number;
  // Everything made: the gain on the holdings, the realized gains, the dividends and the interest.
  profit: number;
  annualIncome: number | null;
  incomeYield: number | null;
};

export type HistoryIssue = { kind: "no-tiingo" } | { kind: "missing"; symbols: string[] } | { kind: "too-new" } | { kind: "nothing-priced" };

// Imported dividends and interest in one month (YYYY-MM).
export type IncomeMonth = { month: string; dividends: number; interest: number };

export type PortfolioView = {
  today: string;
  // What every amount is in, except each trade's own price.
  currency: Currency;
  holdings: Holding[];
  closed: ClosedPosition[];
  // Newest first.
  trades: (LedgerTrade & { label: string; name: string })[];
  totals: PortfolioTotals;
  industries: IndustryWeight[];
  // Oldest first; empty without imported income.
  income: IncomeMonth[];
  history: HistoryPoint[];
  // Why there's no history chart.
  historyIssue: HistoryIssue | null;
  // Instruments without prices, which the chart leaves out.
  unpriced: number;
};

// Today in New York, where trades are dated.
export function portfolioToday(now = new Date()): string {
  return easternToday(now);
}

// The start of a ticker's price request: the shared five years (the Overview chart asks for the same), or a
// little before its first trade when that's older.
function priceStart(firstTrade: string | undefined, now: Date): string {
  const shared = tiingoStartDate(now);
  return firstTrade && firstTrade < shared ? addDays(firstTrade, -10) : shared;
}

const NO_MARKET: Market = { status: "unknown", price: null, change: null, changePercent: null, name: null, industry: null };

// Throws ExchangeRatesUnavailable when the portfolio needs the ECB's rates and Frankfurter doesn't answer.
export async function getPortfolio(trades: Trade[], now = new Date(), base: Currency = "USD", income: Income[] = []): Promise<PortfolioView> {
  const today = easternToday(now);
  const firstTrade = new Map<string, string>();
  for (const trade of trades) {
    const earliest = firstTrade.get(trade.symbol);
    if (!earliest || trade.date < earliest) firstTrade.set(trade.symbol, trade.date);
  }
  const symbols = [...firstTrade.keys()];
  // Instruments without prices cost no requests: their trades are all there is to them.
  const pricedSymbols = new Set(trades.filter((trade) => trade.priced !== false).map((trade) => trade.symbol));
  const priced = symbols.filter((symbol) => pricedSymbols.has(symbol));
  const pricedFirst = priced.map((symbol) => firstTrade.get(symbol)!).sort()[0];
  const overallFirst = [...firstTrade.values(), ...income.map((item) => item.date)].sort()[0];

  // Market prices are in dollars; amounts in another currency than the page's need converting too.
  const needsRates = (priced.length > 0 && base !== "USD") || trades.some((trade) => trade.currency !== base) || income.some((item) => item.currency !== base);
  const [pricedDays, pricedMarkets, benchmarkDays, benchmarkMarket, rates] = await Promise.all([
    mapLimit(priced, TIINGO_CONCURRENCY, (symbol) => getTiingoDays(symbol, priceStart(firstTrade.get(symbol), now))),
    mapLimit(priced, FINNHUB_CONCURRENCY, (symbol) => marketInfo(symbol, true)),
    priced.length > 0 ? getTiingoDays(BENCHMARK, priceStart(pricedFirst, now)) : null,
    priced.length > 0 ? marketInfo(BENCHMARK, false) : null,
    needsRates ? getEurPerUsd(priceStart(overallFirst, now)) : null,
  ]);
  if (needsRates && !rates) throw new ExchangeRatesUnavailable();
  const fx = rates ? fxFrom(rates) : SAME_CURRENCY;
  const daysBySymbol = new Map<string, TiingoDay[]>();
  const marketBySymbol = new Map<string, Market>();
  priced.forEach((symbol, index) => {
    const days = pricedDays[index];
    if (days) daysBySymbol.set(symbol, days);
    marketBySymbol.set(symbol, pricedMarkets[index]);
  });
  const marketOf = (symbol: string) => marketBySymbol.get(symbol) ?? NO_MARKET;

  // An instrument without prices goes by the broker's code, with its name when known or else its ISIN.
  const described = new Map<string, { label: string; name: string }>();
  for (const trade of trades) {
    if (pricedSymbols.has(trade.symbol) || described.has(trade.symbol)) continue;
    described.set(trade.symbol, { label: trade.label ?? trade.symbol, name: trade.name ?? trade.symbol });
  }
  // Funds have no Finnhub profile and aren't in the stock list; Tiingo knows their names.
  const names = await Promise.all(
    symbols.map(async (symbol) => described.get(symbol)?.name ?? marketOf(symbol).name ?? listedName(symbol) ?? (await getTiingoName(symbol)) ?? symbol),
  );
  const labelOf = (symbol: string) => described.get(symbol)?.label ?? symbol;

  // An imported position's dividends are the ones its statements list, after withholding tax, rather than
  // Tiingo's; import a newer statement for later ones.
  const statementDividends = new Set(trades.filter((trade) => trade.imported).map((trade) => trade.symbol));
  const paidTo = new Map<string, number>();
  let otherDividends = 0;
  let interest = 0;
  const months = new Map<string, IncomeMonth>();
  for (const item of income) {
    const amount = fx.convert(item.amount, item.currency, base, item.date);
    const month = months.get(item.date.slice(0, 7)) ?? { month: item.date.slice(0, 7), dividends: 0, interest: 0 };
    months.set(month.month, month);
    if (item.kind === "interest") {
      interest += amount;
      month.interest += amount;
      continue;
    }
    month.dividends += amount;
    if (item.symbol && firstTrade.has(item.symbol)) {
      statementDividends.add(item.symbol);
      paidTo.set(item.symbol, (paidTo.get(item.symbol) ?? 0) + amount);
    } else {
      otherDividends += amount;
    }
  }

  const positions = symbols.map((symbol) => {
    const position = buildPosition(symbol, trades.filter((trade) => trade.symbol === symbol), daysBySymbol.get(symbol) ?? null, today, base, fx);
    return statementDividends.has(symbol) ? { ...position, dividends: paidTo.get(symbol) ?? 0 } : position;
  });
  const open = positions.map((position, index) => ({ position, index })).filter(({ position }) => position.shares > 0);

  const unweighted = open.map(({ position, index }): Holding => {
    const symbol = position.symbol;
    const market = marketOf(symbol);
    const latest = daysBySymbol.get(symbol)?.at(-1) ?? null;
    const lastTrade = position.trades[position.trades.length - 1];
    const usdPrice = market.price ?? latest?.close ?? null;
    const price = usdPrice === null ? lastTrade.adjustedPrice : fx.convert(usdPrice, "USD", base, today);
    const value = position.shares * price;
    const gain = value - position.cost;
    return {
      symbol,
      label: labelOf(symbol),
      name: names[index],
      priced: pricedSymbols.has(symbol),
      industry: pricedSymbols.has(symbol) ? industryOf(market.industry, names[index]) : "Other",
      shares: position.shares,
      averageCost: position.cost / position.shares,
      cost: position.cost,
      price,
      priceSource: market.price !== null ? "live" : latest ? "close" : "trade",
      dayChange: market.price !== null && market.change !== null ? position.shares * fx.convert(market.change, "USD", base, today) : null,
      dayChangePercent: market.price !== null ? market.changePercent : null,
      value,
      gain,
      gainPercent: position.cost > 0 ? gain / position.cost : null,
      realized: position.realized,
      dividends: position.dividends,
      annualDividend: position.trailingDividend === null ? null : position.trailingDividend * position.shares,
      weight: 0,
    };
  });
  const value = unweighted.reduce((total, holding) => total + holding.value, 0);
  const holdings = unweighted
    .map((holding) => ({ ...holding, weight: value > 0 ? holding.value / value : 0 }))
    .sort((left, right) => right.value - left.value);

  const cost = holdings.reduce((total, holding) => total + holding.cost, 0);
  const changed = holdings.filter((holding) => holding.dayChange !== null);
  const dayChange = changed.length > 0 ? changed.reduce((total, holding) => total + holding.dayChange!, 0) : null;
  const dayBase = changed.reduce((total, holding) => total + holding.value - holding.dayChange!, 0);
  const withIncome = holdings.filter((holding) => holding.annualDividend !== null);
  const annualIncome = withIncome.length > 0 ? withIncome.reduce((total, holding) => total + holding.annualDividend!, 0) : null;
  const realized = positions.reduce((total, position) => total + position.realized, 0);
  const dividends = positions.reduce((total, position) => total + position.dividends, 0) + otherDividends;
  const totals: PortfolioTotals = {
    value,
    cost,
    gain: value - cost,
    gainPercent: cost > 0 ? (value - cost) / cost : null,
    dayChange,
    dayChangePercent: dayChange !== null && dayBase > 0 ? dayChange / dayBase : null,
    stalePrices: holdings.filter((holding) => holding.priceSource !== "live").length,
    realized,
    dividends,
    interest,
    profit: value - cost + realized + dividends + interest,
    annualIncome,
    incomeYield: annualIncome !== null && value > 0 ? annualIncome / value : null,
  };

  const byIndustry = new Map<string, number>();
  for (const holding of holdings) byIndustry.set(holding.industry, (byIndustry.get(holding.industry) ?? 0) + holding.value);
  const industries = [...byIndustry]
    .map(([name, industryValue]) => ({ name, value: industryValue, weight: value > 0 ? industryValue / value : 0 }))
    .sort((left, right) => right.value - left.value);

  const closed = positions
    .map((position, index): ClosedPosition | null =>
      position.shares > 0
        ? null
        : {
            symbol: position.symbol,
            label: labelOf(position.symbol),
            name: names[index],
            priced: pricedSymbols.has(position.symbol),
            realized: position.realized,
            dividends: position.dividends,
            soldOn: position.trades[position.trades.length - 1].date,
          })
    .filter((position): position is ClosedPosition => position !== null)
    .sort((left, right) => right.soldOn.localeCompare(left.soldOn));

  const nameOf = new Map(symbols.map((symbol, index) => [symbol, names[index]]));
  const ledger = positions
    .flatMap((position) => position.trades)
    .map((trade) => ({ ...trade, label: labelOf(trade.symbol), name: nameOf.get(trade.symbol) ?? trade.symbol }))
    .sort((left, right) => right.date.localeCompare(left.date) || right.id - left.id);

  // The chart follows the instruments with prices; the others' gains are in the totals.
  let history: HistoryPoint[] = [];
  let historyIssue: HistoryIssue | null = null;
  const missing = priced.filter((symbol) => !daysBySymbol.has(symbol));
  if (priced.length === 0) {
    historyIssue = symbols.length > 0 ? { kind: "nothing-priced" } : null;
  } else if (!isTiingoConfigured()) {
    historyIssue = { kind: "no-tiingo" };
  } else if (missing.length > 0) {
    historyIssue = { kind: "missing", symbols: missing };
  } else {
    const prices = new Map<string, number>();
    for (const symbol of priced) {
      const price = marketOf(symbol).price;
      if (price !== null) prices.set(symbol, price);
    }
    const pricedPositions = positions.filter((position) => pricedSymbols.has(position.symbol));
    history = buildHistory(pricedPositions, daysBySymbol, benchmarkDays, { date: today, prices, benchmark: benchmarkMarket?.price ?? null }, base, fx);
    if (history.length === 0) historyIssue = { kind: "too-new" };
  }

  return {
    today,
    currency: base,
    holdings,
    closed,
    trades: ledger,
    totals,
    industries,
    income: [...months.values()].sort((left, right) => left.month.localeCompare(right.month)),
    history,
    historyIssue,
    unpriced: symbols.length - priced.length,
  };
}

export type PreparedTrade = { ok: true; trade: Omit<Trade, "id"> } | { ok: false; error: string };

// Checks a new trade against the market and the user's other trades: the ticker must have prices, a missing
// price becomes that day's close (or the live price today), and a sale can't be of more shares than were held.
export async function prepareTrade(input: TradeInput, existing: Trade[], now = new Date()): Promise<PreparedTrade> {
  const today = easternToday(now);
  const same = existing.filter((trade) => trade.symbol === input.symbol);
  const first = [input.date, ...same.map((trade) => trade.date)].sort()[0];
  const needsRates = input.currency !== "USD" || same.some((trade) => trade.currency !== "USD");
  const [days, market, rates] = await Promise.all([
    getTiingoDays(input.symbol, priceStart(first, now)),
    marketInfo(input.symbol, false),
    needsRates ? getEurPerUsd(priceStart(first, now)) : null,
  ]);
  if (!days && market.status !== "ok") {
    return market.status === "unknown"
      ? { ok: false, error: `StockPilot has no prices for ${input.symbol}. Check the ticker.` }
      : { ok: false, error: `Prices for ${input.symbol} couldn't be checked just now. Try again in a minute.` };
  }
  if (needsRates && !rates) return { ok: false, error: "The euro exchange rates couldn't be loaded just now. Try again in a minute." };
  const fx = rates ? fxFrom(rates) : SAME_CURRENCY;

  let price = input.price;
  if (price === null) {
    const day = days ? dayOnOrBefore(days, input.date) : null;
    // Closes are in dollars; a trade in euros gets the close at that day's rate.
    if (input.date === today && market.price !== null) {
      price = fx.convert(market.price, "USD", input.currency, today);
    } else if (day && daysBetween(day.date, input.date) <= 7) {
      price = fx.convert(day.close, "USD", input.currency, input.date);
    } else {
      return { ok: false, error: days ? `There's no close for ${input.symbol} on that date. Enter the price.` : "Enter the price: past closes need a Tiingo key." };
    }
  }

  const trade = { ...input, price };
  // The new trade goes after the others on its day.
  const id = Number.MAX_SAFE_INTEGER;
  const ledger = buildPosition(trade.symbol, [...same, { ...trade, id }], days, today, "USD", fx).trades;
  const index = ledger.findIndex((entry) => entry.id === id);
  const added = ledger[index];
  if (added.oversold) {
    // The shares held then, in the terms the sale was entered in.
    const held = (index > 0 ? ledger[index - 1].heldAfter : 0) * (trade.shares / added.adjustedShares);
    return {
      ok: false,
      error: held > SHARE_EPSILON
        ? `You held ${formatShares(held)} ${trade.symbol} shares then, so you can't sell ${formatShares(trade.shares)}.`
        : `You didn't hold any ${trade.symbol} shares then. Add the buy first.`,
    };
  }
  // A sale dated before others mustn't leave them selling shares that are gone.
  const alreadyShort = new Set(buildPosition(trade.symbol, same, days, today, "USD", fx).trades.filter((entry) => entry.oversold).map((entry) => entry.id));
  const shorted = ledger.find((entry) => entry.oversold && entry.id !== id && !alreadyShort.has(entry.id));
  if (shorted) {
    return { ok: false, error: `That would leave too few ${trade.symbol} shares for your sale on ${formatDay(shorted.date)}.` };
  }
  return { ok: true, trade };
}

// "Mar 3, 2026".
export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

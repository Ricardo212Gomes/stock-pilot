import { mapLimit } from "./concurrency";
import { fetchFinnhub } from "./finnhub";
import { normalizeTicker } from "./fmp";
import { isCurrency, type Currency } from "./fx";
import { dayOnOrBefore, listedName, type NewIncome, type NewTrade } from "./portfolio";
import type { ImportState, Relabel } from "./portfolio-trades";
import type { Broker, Statement, StatementTrade } from "./statements";
import { fetchTiingoDays, tiingoStartDate } from "./tiingo";

// Turns a broker's statement (Trading 212's or Trade Republic's, see lib/statements.ts) into Portfolio trades and
// payments (see docs/portfolio.md): every trade, the dividends after withholding tax and the interest, so the
// profit is all there. The companies still held, at this broker or another, are matched to US tickers and
// followed with prices. The ones sold off are kept under their ISIN without prices: the free price plans can't
// follow the hundreds a busy account has traded, and their gains need none. Each trade keeps the statement's
// total in the account's currency, fees included, so the cost matches what was paid.

// ISINs map to tickers for good, so the lookup is kept a month.
const ISIN_REVALIDATE_SECONDS = 60 * 60 * 24 * 30;
// A US listing found by its code must trade within this of the statement's price on the day.
const PRICE_TOLERANCE = Math.log(1.3);
const SHARE_EPSILON = 1e-6;

export type ImportHolding = {
  symbol: string;
  name: string;
  isin: string;
  // What the statement calls it: Trading 212's codes (a company can trade on a euro line and a dollar line,
  // "MTE" and "MU"), or Trade Republic's name.
  codes: string[];
  // New trades.
  trades: number;
  // What's held at this broker: the statement's open position, or what the trades add up to; and what the
  // statement's trades add up to, which differs when it starts after the first buys.
  shares: number;
  tradedShares: number;
  // Followed with prices; without, it's valued at its last trade's price.
  priced: boolean;
};

export type ImportPlan = {
  broker: Broker;
  from: string | null;
  to: string | null;
  currency: Currency;
  holdings: ImportHolding[];
  // Holdings imported without prices: no US listing found, or the lookup failed just now.
  unresolved: { code: string; isin: string }[];
  unchecked: { code: string; isin: string }[];
  // Companies sold off, imported without prices, and their new trades.
  sold: { instruments: number; trades: number };
  // Companies with sales of shares the statement doesn't show being bought: it starts after those buys.
  incomplete: { code: string; isin: string }[];
  // New dividends and interest payments.
  dividends: number;
  interest: number;
  // Card payments, deposits, withdrawals and transfers: not returns, so left out.
  otherCash: number;
  // Stock splits, applied to the trades before them.
  splits: number;
  // Trades and payments already imported from an earlier statement.
  duplicates: number;
  // Trades with no total in the account's currency, left out.
  withoutTotal: number;
  // The statement's realized gains after fees, as the Portfolio counts them, and the broker's own figure when it
  // gives one (Trading 212's Return column leaves out the currency conversion and government fees).
  realized: { afterFees: number; broker: number | null };
  // Instruments saved before under another symbol.
  relabels: Relabel[];
  // Oldest first, so trades on the same day keep their order.
  trades: NewTrade[];
  income: NewIncome[];
};

export type PlanResult = { ok: true; plan: ImportPlan } | { ok: false; error: string };

// The statement's times are in UTC; the Portfolio dates trades in New York, as the market does.
function easternDate(time: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(time));
}

// The same trade from any statement that includes it.
export function tradeId(trade: StatementTrade): string {
  return trade.id;
}

type Listing = { symbol: string; name: string | null };

// Found, not listed in the US, or not known yet because a lookup failed.
type Lookup = { status: "found"; listing: Listing } | { status: "unlisted" } | { status: "unavailable" };

// A US company's ISIN gives its ticker through Finnhub's profile. Foreign ones (IREN's is Australian) aren't on
// Finnhub's free plan, so a dollar line's own code is tried instead, if it traded near the statement's price that
// day. A euro line's code isn't: Trading 212 names European funds after US ones (its "SMH" is a UCITS fund, not
// the US ETF).
async function findListing(isin: string, trades: StatementTrade[], now: Date): Promise<Lookup> {
  // A limit reached or a failure on the way means the answer isn't known, rather than that there's no listing.
  let unavailable = false;
  if (isin.startsWith("US")) {
    const profile = await fetchFinnhub("stock/profile2", { isin }, ISIN_REVALIDATE_SECONDS);
    if (profile.ok) {
      const payload = profile.payload as { ticker?: unknown; name?: unknown } | null;
      const symbol = typeof payload?.ticker === "string" ? normalizeTicker(payload.ticker)?.replace(/\./g, "-") : null;
      if (symbol) return { status: "found", listing: { symbol, name: typeof payload?.name === "string" ? payload.name : null } };
    } else if (profile.reason !== "plan-restricted") {
      unavailable = true;
    }
  }
  const dollarTrades = trades.filter((trade) => trade.price.currency === "USD");
  for (const code of [...new Set(dollarTrades.map((trade) => trade.code))]) {
    const symbol = normalizeTicker(code)?.replace(/\./g, "-");
    if (!symbol) continue;
    const prices = await fetchTiingoDays(symbol, tiingoStartDate(now));
    if (!prices.ok) {
      if (prices.reason !== "unknown") unavailable = true;
      continue;
    }
    const sample = dollarTrades.find((trade) => trade.code === code)!;
    const day = dayOnOrBefore(prices.days, easternDate(sample.time));
    if (day && Math.abs(Math.log(sample.price.amount / day.close)) < PRICE_TOLERANCE) return { status: "found", listing: { symbol, name: null } };
  }
  return unavailable ? { status: "unavailable" } : { status: "unlisted" };
}

function signed(trade: { side: string; shares: number }): number {
  return trade.side === "buy" ? trade.shares : -trade.shares;
}

function isSplit(trade: StatementTrade): boolean {
  return /split/i.test(trade.orderType);
}

// Each split, from its pair of entries (the old shares out, the new ones in at the same value): the new shares
// per old one. The trades before it are put in the new shares, as Tiingo's prices would.
function splitsOf(trades: StatementTrade[]): { time: string; factor: number }[] {
  const byTime = new Map<string, { sold: number; bought: number }>();
  for (const trade of trades.filter(isSplit)) {
    const entry = byTime.get(trade.time) ?? { sold: 0, bought: 0 };
    if (trade.side === "sell") entry.sold += trade.shares;
    else entry.bought += trade.shares;
    byTime.set(trade.time, entry);
  }
  return [...byTime]
    .filter(([, entry]) => entry.sold > 0 && entry.bought > 0)
    .map(([time, entry]) => ({ time, factor: entry.bought / entry.sold }));
}

// What an instrument without prices goes by: the dollar line's code when it has one (a US ticker), with the
// bundled stock list's name for a US company; otherwise its first code or name.
function describe(isin: string, trades: StatementTrade[]): { label: string; name: string | null } {
  const dollarCode = trades.find((trade) => trade.price.currency === "USD")?.code;
  const label = dollarCode ?? trades[0]?.code ?? isin;
  return { label, name: dollarCode && isin.startsWith("US") ? listedName(dollarCode.replace(/\./g, "-")) : null };
}

// Average cost on the account's totals, as the Portfolio counts gains.
function realizedAfterFees(trades: { side: string; shares: number; total: number }[]): number {
  let shares = 0;
  let cost = 0;
  let realized = 0;
  for (const trade of trades) {
    if (trade.side === "buy") {
      shares += trade.shares;
      cost += trade.total;
      continue;
    }
    const sold = Math.min(trade.shares, shares);
    const average = shares > 0 ? cost / shares : 0;
    realized += trade.total - sold * average;
    shares -= sold;
    cost -= sold * average;
    if (shares <= SHARE_EPSILON) {
      shares = 0;
      cost = 0;
    }
  }
  return realized;
}

export async function planImport(statement: Statement, state: Pick<ImportState, "ids" | "instruments">, now = new Date()): Promise<PlanResult> {
  const currency = statement.accountCurrency;
  if (!isCurrency(currency)) {
    return { ok: false, error: `The Portfolio keeps accounts in dollars or euros, and this one is in ${currency ?? "an unknown currency"}.` };
  }
  const { broker } = statement;

  // A buy and a sale on the same day must stay in that order; the sort keeps the statement's order for a time.
  const ordered = [...statement.trades].sort((left, right) => left.time.localeCompare(right.time));
  const byIsin = new Map<string, StatementTrade[]>();
  for (const trade of ordered) byIsin.set(trade.isin, [...(byIsin.get(trade.isin) ?? []), trade]);

  // Each trade in the shares after any later split, and its total in the account's currency (null when the
  // statement has none).
  const converted = new Map<string, { trade: StatementTrade; side: StatementTrade["side"]; shares: number; total: number | null }[]>();
  let splits = 0;
  for (const [isin, own] of byIsin) {
    const isinSplits = splitsOf(own);
    splits += isinSplits.length;
    converted.set(
      isin,
      own
        .filter((trade) => !isSplit(trade))
        .map((trade) => {
          const factor = isinSplits.reduce((product, split) => (split.time > trade.time ? product * split.factor : product), 1);
          const total = trade.accountValue?.currency === currency ? Math.abs(trade.accountValue.amount) : trade.price.currency === currency ? trade.price.amount * trade.shares : null;
          return { trade, side: trade.side, shares: trade.shares * factor, total: total !== null && total > 0 ? total : null };
        }),
    );
  }

  // What's held at this broker: the statement's open positions, one per company; or, when it lists none, what
  // its trades add up to on top of this broker's earlier statements (less any trades both include).
  const savedHere = (isin: string) => state.instruments.get(isin)?.shares.get(broker) ?? 0;
  const savedElsewhere = (isin: string) => [...(state.instruments.get(isin)?.shares ?? [])].reduce((total, [other, shares]) => (other === broker ? total : total + shares), 0);
  const startOf = (isin: string) =>
    savedHere(isin) - (converted.get(isin) ?? []).reduce((total, entry) => (state.ids.has(entry.trade.id) ? total + signed(entry) : total), 0);
  const heldHere = new Map<string, { code: string; shares: number }>();
  if (statement.positions.length > 0) {
    for (const position of statement.positions) {
      const known = heldHere.get(position.isin);
      heldHere.set(position.isin, { code: known?.code ?? position.code, shares: (known?.shares ?? 0) + position.shares });
    }
  } else {
    for (const [isin, entries] of converted) {
      const shares = startOf(isin) + entries.reduce((total, entry) => total + signed(entry), 0);
      if (shares > SHARE_EPSILON) heldHere.set(isin, { code: byIsin.get(isin)![0].code, shares });
    }
  }

  // A sale of more than was held here: the statement starts after the buys.
  const incomplete: ImportPlan["incomplete"] = [];
  for (const [isin, entries] of converted) {
    let shares = startOf(isin);
    for (const entry of entries) {
      shares += signed(entry);
      if (shares < -SHARE_EPSILON) {
        incomplete.push({ code: entry.trade.code, isin });
        break;
      }
    }
  }

  // Followed with prices: what's held here, and what's sold here but still held at another broker.
  const followed = [...new Set([...heldHere.keys(), ...[...byIsin.keys()].filter((isin) => savedElsewhere(isin) > SHARE_EPSILON)])];
  // Only those are looked up, and not again once an earlier import found their ticker.
  const lookups = await mapLimit(followed, 3, async (isin): Promise<Lookup> => {
    const saved = state.instruments.get(isin);
    if (saved?.priced) return { status: "found", listing: { symbol: saved.symbol, name: null } };
    return findListing(isin, byIsin.get(isin) ?? [], now);
  });

  // What each ISIN is saved as: a ticker with prices, or the ISIN itself without.
  const instruments = new Map<string, { symbol: string; priced: boolean; label: string | null; name: string | null }>();
  const unresolved: ImportPlan["unresolved"] = [];
  const unchecked: ImportPlan["unchecked"] = [];
  const names = new Map<string, string | null>();
  followed.forEach((isin, index) => {
    const lookup = lookups[index];
    if (lookup.status === "found") {
      instruments.set(isin, { symbol: lookup.listing.symbol, priced: true, label: null, name: null });
      names.set(isin, lookup.listing.name);
      return;
    }
    const code = heldHere.get(isin)?.code ?? byIsin.get(isin)?.[0].code ?? isin;
    (lookup.status === "unavailable" ? unchecked : unresolved).push({ code, isin });
    instruments.set(isin, { symbol: isin, priced: false, ...describe(isin, byIsin.get(isin) ?? []) });
  });
  for (const [isin, trades] of byIsin) {
    if (!instruments.has(isin)) instruments.set(isin, { symbol: isin, priced: false, ...describe(isin, trades) });
  }

  const relabels: Relabel[] = [];
  for (const [isin, instrument] of instruments) {
    const saved = state.instruments.get(isin);
    if (saved && (saved.symbol !== instrument.symbol || saved.priced !== instrument.priced)) relabels.push({ isin, ...instrument });
  }

  const trades: { time: string; trade: NewTrade }[] = [];
  const newTrades = new Map<string, number>();
  let duplicates = 0;
  let withoutTotal = 0;
  let afterFees = 0;
  for (const [isin, entries] of converted) {
    const instrument = instruments.get(isin)!;
    const costed: { side: string; shares: number; total: number }[] = [];
    for (const { trade, shares, total } of entries) {
      if (total === null) {
        withoutTotal++;
        continue;
      }
      costed.push({ side: trade.side, shares, total });
      if (state.ids.has(trade.id)) {
        duplicates++;
        continue;
      }
      newTrades.set(isin, (newTrades.get(isin) ?? 0) + 1);
      trades.push({
        time: trade.time,
        trade: {
          symbol: instrument.symbol,
          side: trade.side,
          shares,
          price: total / shares,
          currency,
          date: easternDate(trade.time),
          externalId: trade.id,
          isin,
          priced: instrument.priced,
          label: instrument.label,
          name: instrument.name,
        },
      });
    }
    afterFees += realizedAfterFees(costed);
  }

  const income: NewIncome[] = [];
  let dividends = 0;
  let interest = 0;
  for (const dividend of statement.dividends) {
    if (dividend.amount.currency !== currency) continue;
    if (state.ids.has(dividend.id)) {
      duplicates++;
      continue;
    }
    dividends++;
    // A dividend on a company whose trades are all in an earlier statement goes where those were saved.
    const symbol = instruments.get(dividend.isin)?.symbol ?? state.instruments.get(dividend.isin)?.symbol ?? dividend.isin;
    income.push({ kind: "dividend", symbol, isin: dividend.isin, amount: dividend.amount.amount, currency, date: dividend.paidOn, externalId: dividend.id });
  }
  for (const payment of statement.interest) {
    if (payment.amount.currency !== currency) continue;
    if (state.ids.has(payment.id)) {
      duplicates++;
      continue;
    }
    interest++;
    income.push({ kind: "interest", symbol: null, isin: null, amount: payment.amount.amount, currency, date: payment.paidOn, externalId: payment.id });
  }

  const holdings: ImportHolding[] = [...heldHere]
    .map(([isin, position]) => {
      const instrument = instruments.get(isin)!;
      const entries = converted.get(isin) ?? [];
      return {
        symbol: instrument.priced ? instrument.symbol : (instrument.label ?? instrument.symbol),
        name: names.get(isin) ?? instrument.name ?? (instrument.priced ? instrument.symbol : isin),
        isin,
        codes: [...new Set((byIsin.get(isin) ?? []).map((trade) => trade.code))],
        trades: newTrades.get(isin) ?? 0,
        shares: position.shares,
        tradedShares: statement.positions.length > 0 ? entries.reduce((total, entry) => total + signed(entry), 0) : position.shares,
        priced: instrument.priced,
      };
    })
    .sort((left, right) => left.symbol.localeCompare(right.symbol));

  const soldIsins = [...byIsin.keys()].filter((isin) => !heldHere.has(isin));
  const results = statement.trades.filter((trade) => trade.result?.currency === currency);
  return {
    ok: true,
    plan: {
      broker,
      from: statement.from,
      to: statement.to,
      currency,
      holdings,
      unresolved,
      unchecked,
      sold: { instruments: soldIsins.length, trades: soldIsins.reduce((total, isin) => total + (newTrades.get(isin) ?? 0), 0) },
      incomplete,
      dividends,
      interest,
      otherCash: statement.otherCash,
      splits,
      duplicates,
      withoutTotal,
      realized: { afterFees, broker: results.length > 0 ? results.reduce((total, trade) => total + trade.result!.amount, 0) : null },
      relabels,
      // Across companies too, so the saved order is the statement's.
      trades: trades.sort((left, right) => left.time.localeCompare(right.time)).map((entry) => entry.trade),
      income,
    },
  };
}

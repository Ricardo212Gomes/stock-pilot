import { getSql } from "./db";
import { isIsoDate } from "./earnings-calendar";
import { normalizeTicker } from "./fmp";
import { isCurrency, type Currency } from "./fx";
import type { Income, NewIncome, NewTrade, Trade, TradeInput } from "./portfolio";
import { brokerOfId, type Broker } from "./statements";

// Each user's trades, in the portfolio_trades table (db/schema.sql), the dividends and interest imported with
// them (portfolio_income), and the currency their portfolio is shown in (portfolio_settings). Shares and prices
// are kept as entered, in the currency paid; splits are applied when the portfolio is worked out (see
// lib/portfolio.ts).

type TradeRow = {
  id: string | number;
  symbol: string;
  side: string;
  shares: string | number;
  price: string | number;
  currency: string;
  traded_on: string;
  imported: boolean;
  priced: boolean;
  label: string | null;
  name: string | null;
};

export async function listTrades(userId: string): Promise<Trade[]> {
  // The date as text, so no time zone shifts it.
  const rows = await getSql()<TradeRow[]>`
    select id, symbol, side, shares, price, currency, traded_on::text as traded_on, external_id is not null as imported, priced, label, name
    from portfolio_trades where user_id = ${userId} order by traded_on, id
  `;
  return rows.map((row) => ({
    id: Number(row.id),
    symbol: row.symbol,
    side: row.side === "sell" ? "sell" : "buy",
    shares: Number(row.shares),
    price: Number(row.price),
    currency: isCurrency(row.currency) ? row.currency : "USD",
    date: row.traded_on,
    imported: Boolean(row.imported),
    priced: row.priced !== false,
    label: row.label ?? null,
    name: row.name ?? null,
  }));
}

export async function insertTrade(userId: string, trade: NewTrade): Promise<void> {
  await getSql()`
    insert into portfolio_trades (user_id, symbol, side, shares, price, currency, traded_on, external_id)
    values (${userId}, ${trade.symbol}, ${trade.side}, ${trade.shares}, ${trade.price}, ${trade.currency}, ${trade.date}, ${trade.externalId ?? null})
  `;
}

// Saves many trades in one statement, in the order given (ids follow it, and trades on the same day are listed by
// id); a trade whose broker id is already saved for the user is left out. Returns how many were added. postgres.js
// sends an array of booleans as one boolean, so `priced` travels as text.
export async function insertTrades(userId: string, trades: NewTrade[]): Promise<number> {
  if (trades.length === 0) return 0;
  const rows = await getSql()<{ id: string }[]>`
    insert into portfolio_trades (user_id, symbol, side, shares, price, currency, traded_on, external_id, isin, priced, label, name)
    select ${userId}, symbol, side, shares, price, currency, traded_on, external_id, isin, priced::boolean, label, name
    from unnest(
      ${trades.map((trade) => trade.symbol)}::text[],
      ${trades.map((trade) => trade.side)}::text[],
      ${trades.map((trade) => trade.shares)}::numeric[],
      ${trades.map((trade) => trade.price)}::numeric[],
      ${trades.map((trade) => trade.currency)}::text[],
      ${trades.map((trade) => trade.date)}::date[],
      ${trades.map((trade) => trade.externalId ?? null)}::text[],
      ${trades.map((trade) => trade.isin ?? null)}::text[],
      ${trades.map((trade) => (trade.priced === false ? "false" : "true"))}::text[],
      ${trades.map((trade) => trade.label ?? null)}::text[],
      ${trades.map((trade) => trade.name ?? null)}::text[]
    ) with ordinality as imported(symbol, side, shares, price, currency, traded_on, external_id, isin, priced, label, name, position)
    order by position
    on conflict (user_id, external_id) where external_id is not null do nothing
    returning id
  `;
  return rows.length;
}

type IncomeRow = { kind: string; symbol: string | null; amount: string | number; currency: string; paid_on: string };

export async function listIncome(userId: string): Promise<Income[]> {
  const rows = await getSql()<IncomeRow[]>`
    select kind, symbol, amount, currency, paid_on::text as paid_on
    from portfolio_income where user_id = ${userId} order by paid_on, id
  `;
  return rows.map((row) => ({
    kind: row.kind === "interest" ? "interest" : "dividend",
    symbol: row.symbol,
    amount: Number(row.amount),
    currency: isCurrency(row.currency) ? row.currency : "USD",
    date: row.paid_on,
  }));
}

// Saves imported dividends and interest, leaving out any whose broker id is already saved. Returns how many were
// added.
export async function insertIncome(userId: string, items: NewIncome[]): Promise<number> {
  if (items.length === 0) return 0;
  const rows = await getSql()<{ id: string }[]>`
    insert into portfolio_income (user_id, kind, symbol, isin, amount, currency, paid_on, external_id)
    select ${userId}, kind, symbol, isin, amount, currency, paid_on, external_id
    from unnest(
      ${items.map((item) => item.kind)}::text[],
      ${items.map((item) => item.symbol)}::text[],
      ${items.map((item) => item.isin)}::text[],
      ${items.map((item) => item.amount)}::numeric[],
      ${items.map((item) => item.currency)}::text[],
      ${items.map((item) => item.date)}::date[],
      ${items.map((item) => item.externalId)}::text[]
    ) with ordinality as imported(kind, symbol, isin, amount, currency, paid_on, external_id, position)
    order by position
    on conflict (user_id, external_id) where external_id is not null do nothing
    returning id
  `;
  return rows.length;
}

// What earlier imports saved, for the next one: the broker ids of trades and payments (so a statement's are added
// once), the tickers with trades entered by hand (which an import adds to), and what each imported ISIN is saved
// as, a ticker with prices or the ISIN itself without, with the shares its trades add up to at each broker.
export type SavedInstrument = { symbol: string; priced: boolean; shares: Map<Broker, number> };

export type ImportState = {
  ids: Set<string>;
  handEntered: Set<string>;
  instruments: Map<string, SavedInstrument>;
  // Payments saved, for the limit on them.
  income: number;
};

export async function listImportState(userId: string): Promise<ImportState> {
  const [trades, income] = await Promise.all([
    getSql()<{ symbol: string; external_id: string | null; isin: string | null; priced: boolean; side: string; shares: string | number }[]>`
      select symbol, external_id, isin, priced, side, shares from portfolio_trades where user_id = ${userId}
    `,
    getSql()<{ external_id: string }[]>`
      select external_id from portfolio_income where user_id = ${userId} and external_id is not null
    `,
  ]);
  const state: ImportState = { ids: new Set(), handEntered: new Set(), instruments: new Map(), income: income.length };
  for (const row of trades) {
    if (!row.external_id) {
      state.handEntered.add(row.symbol);
      continue;
    }
    state.ids.add(row.external_id);
    if (!row.isin) continue;
    const saved = state.instruments.get(row.isin) ?? { symbol: row.symbol, priced: row.priced !== false, shares: new Map<Broker, number>() };
    const broker = brokerOfId(row.external_id);
    if (broker) saved.shares.set(broker, (saved.shares.get(broker) ?? 0) + (row.side === "sell" ? -1 : 1) * Number(row.shares));
    state.instruments.set(row.isin, saved);
  }
  for (const row of income) state.ids.add(row.external_id);
  return state;
}

// An instrument saved before under another symbol: a company sold off then and held now gets its ticker and
// prices, and one held then and sold off now stops costing price requests. Its dividends move with it.
export type Relabel = { isin: string; symbol: string; priced: boolean; label: string | null; name: string | null };

export async function relabelInstruments(userId: string, relabels: Relabel[]): Promise<void> {
  for (const relabel of relabels) {
    await getSql()`
      update portfolio_trades set symbol = ${relabel.symbol}, priced = ${relabel.priced}, label = ${relabel.label}, name = ${relabel.name}
      where user_id = ${userId} and isin = ${relabel.isin}
    `;
    await getSql()`update portfolio_income set symbol = ${relabel.symbol} where user_id = ${userId} and isin = ${relabel.isin} and kind = 'dividend'`;
  }
}

// Only the user's own trade: the id alone never decides.
export async function deleteTrade(userId: string, id: number): Promise<boolean> {
  const rows = await getSql()`delete from portfolio_trades where user_id = ${userId} and id = ${id} returning id`;
  return rows.length > 0;
}

// Every trade, and the dividends and interest imported with them.
export async function deleteAllTrades(userId: string): Promise<number> {
  const rows = await getSql()`delete from portfolio_trades where user_id = ${userId} returning id`;
  await getSql()`delete from portfolio_income where user_id = ${userId}`;
  return rows.length;
}

export async function getPortfolioCurrency(userId: string): Promise<Currency> {
  const rows = await getSql()<{ currency: string }[]>`select currency from portfolio_settings where user_id = ${userId}`;
  const currency = rows[0]?.currency;
  return isCurrency(currency) ? currency : "USD";
}

export async function setPortfolioCurrency(userId: string, currency: Currency): Promise<void> {
  await getSql()`
    insert into portfolio_settings (user_id, currency) values (${userId}, ${currency})
    on conflict (user_id) do update set currency = excluded.currency, updated_at = now()
  `;
}

// "1,250.5" or 1250.5; null for anything that isn't a positive number up to `max`.
function amount(value: unknown, max: number): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[,\s$€]/g, "")) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= max ? parsed : null;
}

export type ParsedTrade = { ok: true; value: TradeInput } | { ok: false; error: string };

// What the browser sent, checked field by field. An empty price means "that day's close"; the currency is the
// price's, dollars unless the form says euros.
export function parseTradeInput(raw: unknown, today: string): ParsedTrade {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  // Share classes are written with a dash (BRK-B), as everywhere in StockPilot.
  const symbol = normalizeTicker(value.symbol)?.replace(/\./g, "-");
  if (!symbol) return { ok: false, error: "Enter a ticker, like AAPL." };
  if (value.side !== "buy" && value.side !== "sell") return { ok: false, error: "Choose Buy or Sell." };
  if (!isIsoDate(value.date)) return { ok: false, error: "Enter the trade's date." };
  if (value.date > today) return { ok: false, error: "The date can't be in the future." };
  if (value.date < "1980-01-01") return { ok: false, error: "Enter a date from 1980 on." };
  const shares = amount(value.shares, 1e9);
  if (shares === null) return { ok: false, error: "Enter how many shares, more than zero." };
  const currency = value.currency === undefined || value.currency === "" ? "USD" : value.currency;
  if (!isCurrency(currency)) return { ok: false, error: "Choose dollars or euros." };
  const empty = value.price === undefined || value.price === null || (typeof value.price === "string" && value.price.trim() === "");
  const price = empty ? null : amount(value.price, 1e7);
  if (!empty && price === null) return { ok: false, error: "Enter the price per share, or leave it empty for that day's close." };
  return { ok: true, value: { symbol, side: value.side, shares, price, currency, date: value.date } };
}

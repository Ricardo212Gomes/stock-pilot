"use server";

import { refresh } from "next/cache";
import { currentUserId } from "@/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { isCurrency, type Currency } from "@/lib/fx";
import { formatShares, MAX_INCOME, MAX_SYMBOLS, MAX_TRADES, portfolioToday, prepareTrade, type Trade } from "@/lib/portfolio";
import { planImport, type ImportPlan } from "@/lib/portfolio-import";
import {
  deleteAllTrades,
  deleteTrade,
  getPortfolioCurrency,
  insertIncome,
  insertTrade,
  insertTrades,
  listImportState,
  listTrades,
  parseTradeInput,
  relabelInstruments,
  setPortfolioCurrency,
  type ImportState,
} from "@/lib/portfolio-trades";
import { parseStatement } from "@/lib/parse-statement";
import { readPdfItems } from "@/lib/statement-pdf";
import type { Statement } from "@/lib/statements";
import { formatMoney } from "@/lib/valuation/format";

export type TradeActionResult = { ok: true; message: string } | { ok: false; error: string };

const DATABASE_ERROR = "Your trades couldn't be loaded. Check the database connection and that npm run db:setup has run.";
// Statements are a couple of megabytes; next.config allows uploads up to 10.
const MAX_STATEMENT_BYTES = 9.5 * 1024 * 1024;

// Every action works on the signed-in user from the session cookie, never on ids from the browser.
async function signedIn(): Promise<string | TradeActionResult & { ok: false }> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Sign in to keep a portfolio." };
  if (!isDatabaseConfigured()) return { ok: false, error: "The portfolio needs a database. Set DATABASE_URL." };
  return userId;
}

export async function addTradeAction(raw: unknown): Promise<TradeActionResult> {
  const userId = await signedIn();
  if (typeof userId !== "string") return userId;
  const parsed = parseTradeInput(raw, portfolioToday());
  if (!parsed.ok) return parsed;

  let trades;
  try {
    trades = await listTrades(userId);
  } catch {
    return { ok: false, error: DATABASE_ERROR };
  }
  if (trades.length >= MAX_TRADES) return { ok: false, error: `A portfolio can hold up to ${MAX_TRADES.toLocaleString("en-US")} trades. Delete some first.` };
  // Only tickers with prices cost requests.
  const symbols = new Set(trades.filter((trade) => trade.priced !== false).map((trade) => trade.symbol));
  if (!symbols.has(parsed.value.symbol) && symbols.size >= MAX_SYMBOLS) {
    return { ok: false, error: `A portfolio can follow up to ${MAX_SYMBOLS} tickers.` };
  }

  const prepared = await prepareTrade(parsed.value, trades);
  if (!prepared.ok) return prepared;
  try {
    await insertTrade(userId, prepared.trade);
  } catch {
    return { ok: false, error: "The trade couldn't be saved. Check the database connection." };
  }
  refresh();
  const { side, shares, symbol, price, currency } = prepared.trade;
  return { ok: true, message: `Added: ${side === "buy" ? "bought" : "sold"} ${formatShares(shares)} ${symbol} at ${formatMoney(price, currency)}.` };
}

export async function deleteTradeAction(id: unknown): Promise<TradeActionResult> {
  const userId = await signedIn();
  if (typeof userId !== "string") return userId;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return { ok: false, error: "That trade doesn't exist." };
  try {
    const deleted = await deleteTrade(userId, id);
    refresh();
    return deleted ? { ok: true, message: "Trade deleted." } : { ok: false, error: "That trade was already deleted." };
  } catch {
    return { ok: false, error: "The trade couldn't be deleted. Check the database connection." };
  }
}

export async function deleteAllTradesAction(): Promise<TradeActionResult> {
  const userId = await signedIn();
  if (typeof userId !== "string") return userId;
  try {
    const deleted = await deleteAllTrades(userId);
    refresh();
    return { ok: true, message: `Deleted ${deleted} ${deleted === 1 ? "trade" : "trades"}.` };
  } catch {
    return { ok: false, error: "The trades couldn't be deleted. Check the database connection." };
  }
}

export async function setCurrencyAction(currency: unknown): Promise<TradeActionResult> {
  const userId = await signedIn();
  if (typeof userId !== "string") return userId;
  if (!isCurrency(currency)) return { ok: false, error: "Choose dollars or euros." };
  try {
    await setPortfolioCurrency(userId, currency);
  } catch {
    return { ok: false, error: DATABASE_ERROR };
  }
  refresh();
  return { ok: true, message: currency === "EUR" ? "Shown in euros." : "Shown in dollars." };
}

// The uploaded statement, read and parsed. The file is never kept: its trades are, once confirmed.
async function readStatement(formData: FormData): Promise<{ ok: true; statement: Statement } | { ok: false; error: string }> {
  const file = formData.get("statement");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose your Trading 212 or Trade Republic statement, a PDF." };
  if (file.size > MAX_STATEMENT_BYTES) return { ok: false, error: "That file is over 9.5 MB, much bigger than a statement." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") return { ok: false, error: "That isn't a PDF. Download the statement from your broker as a PDF." };
  let statement: Statement | null;
  try {
    statement = parseStatement(await readPdfItems(bytes));
  } catch {
    return { ok: false, error: "The PDF couldn't be read." };
  }
  return statement
    ? { ok: true, statement }
    : { ok: false, error: "This doesn't look like a Trading 212 activity statement or a Trade Republic account statement: there are no trades in it." };
}

function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

function limitError(existing: Trade[], state: ImportState, plan: ImportPlan): string | null {
  // Tickers with prices, after the import: those the statement's holdings get, and those already followed.
  const symbols = new Set([
    ...existing.filter((trade) => trade.priced !== false).map((trade) => trade.symbol),
    ...plan.trades.filter((trade) => trade.priced !== false).map((trade) => trade.symbol),
    ...plan.relabels.filter((relabel) => relabel.priced).map((relabel) => relabel.symbol),
  ]);
  if (symbols.size > MAX_SYMBOLS) return `With these the portfolio would follow ${symbols.size} tickers with prices, and it can follow up to ${MAX_SYMBOLS}.`;
  const trades = existing.length + plan.trades.length;
  if (trades > MAX_TRADES) return `With these the portfolio would hold ${formatCount(trades)} trades, and it can hold up to ${formatCount(MAX_TRADES)}.`;
  const income = state.income + plan.income.length;
  if (income > MAX_INCOME) return `With these the portfolio would hold ${formatCount(income)} dividend and interest payments, and it can hold up to ${formatCount(MAX_INCOME)}.`;
  return null;
}

type Planned = { ok: true; plan: ImportPlan; existing: Trade[]; state: ImportState; portfolioCurrency: Currency } | { ok: false; error: string };

async function planFor(userId: string, formData: FormData): Promise<Planned> {
  const read = await readStatement(formData);
  if (!read.ok) return read;
  let existing: Trade[];
  let state: ImportState;
  let portfolioCurrency: Currency;
  try {
    [existing, state, portfolioCurrency] = await Promise.all([listTrades(userId), listImportState(userId), getPortfolioCurrency(userId)]);
  } catch {
    return { ok: false, error: DATABASE_ERROR };
  }
  const planned = await planImport(read.statement, state);
  return planned.ok ? { ok: true, plan: planned.plan, existing, state, portfolioCurrency } : planned;
}

export type ImportPreview = Omit<ImportPlan, "trades" | "income" | "relabels"> & {
  newTrades: number;
  // Tickers that get new trades and have some entered by hand, which may be the same trades.
  addsTo: string[];
  portfolioCurrency: Currency;
  // Why it can't be imported: too many tickers or trades for the portfolio.
  blocked: string | null;
};

export async function previewStatementAction(formData: FormData): Promise<{ ok: true; preview: ImportPreview } | { ok: false; error: string }> {
  const userId = await signedIn();
  if (typeof userId !== "string") return userId;
  const planned = await planFor(userId, formData);
  if (!planned.ok) return planned;
  const { trades, income, relabels, ...plan } = planned.plan;
  // Only the counts go to the browser.
  void [income, relabels];
  const addsTo = [...new Set(trades.map((trade) => trade.symbol))].filter((symbol) => planned.state.handEntered.has(symbol)).sort();
  return {
    ok: true,
    preview: {
      ...plan,
      newTrades: trades.length,
      addsTo,
      portfolioCurrency: planned.portfolioCurrency,
      blocked: limitError(planned.existing, planned.state, planned.plan),
    },
  };
}

// Reads the statement again rather than trusting trades sent back from the browser.
export async function importStatementAction(formData: FormData): Promise<TradeActionResult> {
  const userId = await signedIn();
  if (typeof userId !== "string") return userId;
  const planned = await planFor(userId, formData);
  if (!planned.ok) return planned;
  const { plan, existing, state } = planned;
  const blocked = limitError(existing, state, plan);
  if (blocked) return { ok: false, error: blocked };
  try {
    // Moves earlier imports first, so the new trades join their positions.
    await relabelInstruments(userId, plan.relabels);
    const added = await insertTrades(userId, plan.trades);
    const paid = await insertIncome(userId, plan.income);
    if (formData.get("currency") === plan.currency) await setPortfolioCurrency(userId, plan.currency);
    refresh();
    const payments = paid > 0 ? ` and ${formatCount(paid)} dividend and interest ${paid === 1 ? "payment" : "payments"}` : "";
    return { ok: true, message: `Imported ${formatCount(added)} ${added === 1 ? "trade" : "trades"}${payments}.` };
  } catch {
    // Anything saved stays, and importing again adds only the rest.
    return { ok: false, error: "The import couldn't be saved. Check the database connection and that npm run db:setup has run, then import again: nothing is added twice." };
  }
}

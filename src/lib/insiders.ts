import { mapLimit } from "./concurrency";
import { fetchFinnhub, finnhubSymbol, type FinnhubFailureReason } from "./finnhub";
import { secHeaders } from "./sec";
import { getFilings } from "./sec-filings";

// A company's insider trades: every Form 4 transaction of the last year from Finnhub (one request), with
// each insider's role and whether a trade was made under a Rule 10b5-1 plan, read from the SEC filings.

const TRANSACTIONS_REVALIDATE_SECONDS = 60 * 60 * 6;
// A filing never changes once it's made.
const FORM_REVALIDATE_SECONDS = 60 * 60 * 24 * 30;
export const LOOKBACK_DAYS = 365;
// Filings read for roles and plans, newest first: enough for the trades on view, a few seconds on a first
// visit. Each is a small XML file, and the SEC allows 10 requests a second.
const FILINGS_TO_READ = 40;
const SEC_CONCURRENCY = 4;

export type TransactionKind = "buy" | "sale" | "award" | "exercise" | "tax" | "gift" | "other";

// Form 4 transaction codes. P and S are trades in the market; the rest come from pay, options and gifts.
const CODES: Record<string, { kind: TransactionKind; label: string }> = {
  P: { kind: "buy", label: "Buy" },
  S: { kind: "sale", label: "Sale" },
  A: { kind: "award", label: "Award" },
  M: { kind: "exercise", label: "Option exercise" },
  X: { kind: "exercise", label: "Option exercise" },
  C: { kind: "exercise", label: "Conversion" },
  F: { kind: "tax", label: "Tax withholding" },
  G: { kind: "gift", label: "Gift" },
  D: { kind: "other", label: "Returned to company" },
  W: { kind: "other", label: "Inheritance" },
  I: { kind: "other", label: "Discretionary trade" },
  K: { kind: "other", label: "Equity swap" },
  L: { kind: "other", label: "Small acquisition" },
};

export function describeCode(code: string): { kind: TransactionKind; label: string } {
  return CODES[code] ?? { kind: "other", label: code ? `Other (${code})` : "Other" };
}

export type InsiderTransaction = {
  id: string;
  // The SEC accession number of the Form 4.
  accession: string;
  name: string;
  // "CEO, Director", "10% owner"; null until the filing is read.
  role: string | null;
  date: string;
  filed: string;
  code: string;
  kind: TransactionKind;
  label: string;
  // Positive when the insider gained shares.
  shares: number;
  price: number | null;
  // Shares times price, for trades with a price.
  value: number | null;
  ownedAfter: number | null;
  // Made under a Rule 10b5-1 plan set up in advance; null when the filing wasn't read.
  planned: boolean | null;
  filingUrl: string | null;
};

type Row = Record<string, unknown>;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Filers write names in capitals as often as not ("LEVINSON ARTHUR D"); those read better in title case,
// keeping generation suffixes (III) and the letter after an apostrophe (O'Brien).
export function displayName(name: string): string {
  if (/[a-z]/.test(name)) return name;
  return name.toLowerCase().replace(/\b([a-z])([a-z']*)/g, (word, first: string, rest: string) => (
    /^(i{1,3}|iv|v|vi{1,3})$/.test(word) ? word.toUpperCase() : first.toUpperCase() + rest.replace(/'([a-z])/g, (_, letter: string) => `'${letter.toUpperCase()}`)
  ));
}

// Finnhub's transactions, leaving out derivative rows (the options themselves): an exercise also shows up as
// shares acquired, which is what holdings follow.
export function parseFinnhubTransactions(payload: unknown): InsiderTransaction[] {
  const rows = (payload as { data?: unknown } | null)?.data;
  return (Array.isArray(rows) ? (rows as Row[]) : []).flatMap((row, index): InsiderTransaction[] => {
    const shares = num(row.change);
    const name = typeof row.name === "string" ? displayName(row.name.trim()) : "";
    const date = typeof row.transactionDate === "string" ? row.transactionDate : "";
    if (row.isDerivative === true || !name || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !shares) return [];
    const code = typeof row.transactionCode === "string" ? row.transactionCode.trim().toUpperCase() : "";
    const price = num(row.transactionPrice);
    const accession = typeof row.id === "string" ? row.id : "";
    return [{
      id: `${accession || "row"}-${index}`,
      accession,
      name,
      role: null,
      date,
      filed: typeof row.filingDate === "string" ? row.filingDate : date,
      code,
      ...describeCode(code),
      shares,
      price: price && price > 0 ? price : null,
      value: price && price > 0 ? Math.abs(shares) * price : null,
      ownedAfter: num(row.share),
      planned: null,
      filingUrl: null,
    }];
  });
}

export type Form4Details = { role: string | null; planned: boolean };

function flag(xml: string, tag: string): boolean {
  return /^(1|true)$/i.test(new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`).exec(xml)?.[1] ?? "");
}

function text(xml: string, tag: string): string | null {
  const value = new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`).exec(xml)?.[1];
  return value ? value.replace(/&amp;/g, "&").replace(/\s+/g, " ").trim() : null;
}

// The reporting insider's role and the 10b5-1 flag from a Form 4's XML. Forms from before April 2023 have
// no flag, so a footnote naming a 10b5-1 plan counts too.
export function parseForm4(xml: string): Form4Details {
  const relationship = /<reportingOwnerRelationship>([\s\S]*?)<\/reportingOwnerRelationship>/.exec(xml)?.[1] ?? "";
  const roles = [
    flag(relationship, "isOfficer") ? text(relationship, "officerTitle") ?? "Officer" : null,
    flag(relationship, "isDirector") ? "Director" : null,
    flag(relationship, "isTenPercentOwner") ? "10% owner" : null,
    flag(relationship, "isOther") ? text(relationship, "otherText") : null,
  ].filter((role): role is string => !!role);
  const footnotes = [...xml.matchAll(/<footnote[^>]*>([\s\S]*?)<\/footnote>/g)].map((match) => match[1]).join(" ");
  return { role: roles.length > 0 ? roles.join(", ") : null, planned: flag(xml, "aff10b5One") || /10b5-1/i.test(footnotes) };
}

// The XML behind a Form 4's rendered page: EDGAR serves "xslF345X06/form4.xml" through a stylesheet.
export function rawFormUrl(documentUrl: string): string | null {
  return /\.xml$/i.test(documentUrl) ? documentUrl.replace(/\/xslF345X\d+\//, "/") : null;
}

async function readForm4(url: string): Promise<Form4Details | null> {
  try {
    const response = await fetch(url, { headers: secHeaders(), next: { revalidate: FORM_REVALIDATE_SECONDS }, signal: AbortSignal.timeout(10_000) });
    return response.ok ? parseForm4(await response.text()) : null;
  } catch {
    return null;
  }
}

// Adds each filing's link, the trades' 10b5-1 flags and the insiders' roles: the newest filings are read,
// and an insider's role from one filing fills in their others.
async function withFilingDetails(symbol: string, transactions: InsiderTransaction[]): Promise<{ transactions: InsiderTransaction[]; read: number }> {
  const filings = await getFilings(symbol);
  if (!filings.ok) return { transactions, read: 0 };
  const byAccession = new Map(filings.data.filings.map((filing) => [filing.accession, filing]));
  const accessions = [...new Set(transactions.map((transaction) => transaction.accession))].filter((accession) => byAccession.has(accession));
  const details = new Map(
    (await mapLimit(accessions.slice(0, FILINGS_TO_READ), SEC_CONCURRENCY, async (accession) => {
      const url = rawFormUrl(byAccession.get(accession)!.documentUrl);
      return [accession, url ? await readForm4(url) : null] as const;
    })).filter((entry): entry is readonly [string, Form4Details] => entry[1] !== null),
  );
  const roles = new Map<string, string>();
  for (const transaction of transactions) {
    const role = details.get(transaction.accession)?.role;
    if (role && !roles.has(transaction.name)) roles.set(transaction.name, role);
  }
  return {
    read: details.size,
    transactions: transactions.map((transaction) => ({
      ...transaction,
      role: details.get(transaction.accession)?.role ?? roles.get(transaction.name) ?? null,
      planned: details.get(transaction.accession)?.planned ?? null,
      filingUrl: byAccession.get(transaction.accession)?.documentUrl ?? null,
    })),
  };
}

// --- Summaries ---------------------------------------------------------------------------------------

const isTrade = (transaction: InsiderTransaction) => transaction.kind === "buy" || transaction.kind === "sale";

export type TradeTotals = { count: number; insiders: number; shares: number; value: number };

export type InsiderSummary = {
  buys: TradeTotals;
  sales: TradeTotals & { plannedValue: number };
};

function totals(transactions: InsiderTransaction[]): TradeTotals {
  return {
    count: transactions.length,
    insiders: new Set(transactions.map((transaction) => transaction.name)).size,
    shares: transactions.reduce((sum, transaction) => sum + Math.abs(transaction.shares), 0),
    value: transactions.reduce((sum, transaction) => sum + (transaction.value ?? 0), 0),
  };
}

// Buys and sales in the market; awards, exercises and gifts aren't a view on the price.
export function summarizeTrades(transactions: InsiderTransaction[]): InsiderSummary {
  const sales = transactions.filter((transaction) => transaction.kind === "sale");
  return {
    buys: totals(transactions.filter((transaction) => transaction.kind === "buy")),
    sales: { ...totals(sales), plannedValue: sales.reduce((sum, transaction) => sum + (transaction.planned ? transaction.value ?? 0 : 0), 0) },
  };
}

export type MonthlyFlow = { month: string; bought: number; sold: number };

// Dollars bought and sold in the market each month, over the twelve months to `today`'s.
export function monthlyFlows(transactions: InsiderTransaction[], today: string, months = 12): MonthlyFlow[] {
  const keys = Array.from({ length: months }, (_, index) => {
    const date = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - (months - 1 - index));
    return date.toISOString().slice(0, 7);
  });
  const flows = new Map(keys.map((month) => [month, { month, bought: 0, sold: 0 }]));
  for (const transaction of transactions.filter(isTrade)) {
    const flow = flows.get(transaction.date.slice(0, 7));
    if (!flow || transaction.value === null) continue;
    if (transaction.kind === "buy") flow.bought += transaction.value;
    else flow.sold += transaction.value;
  }
  return [...flows.values()];
}

export type InsiderPerson = {
  name: string;
  role: string | null;
  // Shares held after their latest transaction.
  owned: number | null;
  lastDate: string;
  bought: number;
  sold: number;
  // Their trades in the market.
  trades: number;
};

// Everyone who filed in the year, the biggest traders first.
export function insiderPeople(transactions: InsiderTransaction[]): InsiderPerson[] {
  const people = new Map<string, InsiderPerson>();
  // Newest first, so each person's first row is their latest.
  for (const transaction of [...transactions].sort((left, right) => right.date.localeCompare(left.date) || right.filed.localeCompare(left.filed))) {
    const person = people.get(transaction.name) ?? { name: transaction.name, role: transaction.role, owned: transaction.ownedAfter, lastDate: transaction.date, bought: 0, sold: 0, trades: 0 };
    person.role ??= transaction.role;
    if (transaction.kind === "buy") person.bought += transaction.value ?? 0;
    if (transaction.kind === "sale") person.sold += transaction.value ?? 0;
    if (isTrade(transaction)) person.trades++;
    people.set(transaction.name, person);
  }
  return [...people.values()].sort((left, right) => right.bought + right.sold - (left.bought + left.sold) || right.lastDate.localeCompare(left.lastDate));
}

// --- Loading ------------------------------------------------------------------------------------------

export type InsiderActivity = {
  transactions: InsiderTransaction[];
  summary: InsiderSummary;
  months: MonthlyFlow[];
  people: InsiderPerson[];
  from: string;
  // Filings read for roles and plans.
  filingsRead: number;
};

export type InsiderResult = { ok: true; data: InsiderActivity } | { ok: false; reason: FinnhubFailureReason };

export async function getInsiderActivity(symbol: string, now = new Date()): Promise<InsiderResult> {
  const today = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const result = await fetchFinnhub("stock/insider-transactions", { symbol: finnhubSymbol(symbol), from }, TRANSACTIONS_REVALIDATE_SECONDS);
  if (!result.ok) return result;

  const parsed = parseFinnhubTransactions(result.payload)
    .filter((transaction) => transaction.date >= from)
    .sort((left, right) => right.date.localeCompare(left.date) || right.filed.localeCompare(left.filed));
  const { transactions, read } = await withFilingDetails(symbol, parsed);
  return {
    ok: true,
    data: {
      transactions,
      summary: summarizeTrades(transactions),
      months: monthlyFlows(transactions, today),
      people: insiderPeople(transactions),
      from,
      filingsRead: read,
    },
  };
}

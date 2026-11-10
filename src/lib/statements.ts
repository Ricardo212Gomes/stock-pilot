// A broker's statement, as the Portfolio imports it (see lib/portfolio-import.ts): the trades, the open positions
// when the statement lists them, the dividends and the interest. Each broker's PDF has its own reader
// (lib/trading212.ts, lib/trade-republic.ts), and lib/parse-statement.ts tells which one a PDF needs.

export type Broker = "trading212" | "traderepublic";

export const BROKER_NAMES: Record<Broker, string> = { trading212: "Trading 212", traderepublic: "Trade Republic" };

export type Money = { amount: number; currency: string };

export type StatementTrade = {
  // The broker's id for it, the same in every statement that includes it, so it's imported once.
  id: string;
  // In UTC: "2025-10-22T14:46:24Z". A broker that gives only the day gives noon.
  time: string;
  // What the broker calls the line traded: Trading 212's code ("NVD" for NVIDIA in euros, "NVDA" in dollars), or
  // Trade Republic's name ("NVIDIA CORP.").
  code: string;
  isin: string;
  side: "buy" | "sell";
  shares: number;
  // Per share, in the line's currency.
  price: Money;
  // The trade's total in the account's currency, fees included: what it cost or brought in.
  accountValue: Money | null;
  // The broker's own return on a sale, when it gives one (Trading 212's, before the currency conversion and
  // government fees).
  result: Money | null;
  // "Market", "Limit", "Stock split", "Savings plan"…
  orderType: string;
};

export type StatementPosition = { code: string; isin: string; shares: number; averagePrice: Money | null };

export type StatementDividend = {
  // The same in every statement that includes it.
  id: string;
  code: string;
  isin: string;
  // The shares it was paid on, when the statement says.
  shares: number;
  // The pay date (YYYY-MM-DD).
  paidOn: string;
  // What reached the account, after withholding tax, in the account's currency.
  amount: Money;
};

export type StatementInterest = {
  id: string;
  // The pay date (YYYY-MM-DD).
  paidOn: string;
  kind: "cash" | "lending";
  // In the account's currency.
  amount: Money;
};

export type Statement = {
  broker: Broker;
  // The period it covers, as dates (YYYY-MM-DD).
  from: string | null;
  to: string | null;
  // "EUR", "USD"…: the currency of the totals.
  accountCurrency: string | null;
  trades: StatementTrade[];
  // Empty when the statement doesn't list them (Trade Republic's): what's held is then what the trades add up to.
  positions: StatementPosition[];
  dividends: StatementDividend[];
  interest: StatementInterest[];
  // Card payments, deposits, withdrawals and transfers: money in and out, not returns.
  otherCash: number;
};

// The broker an imported trade or payment came from, by its id's prefix.
export function brokerOfId(id: string): Broker | null {
  return id.startsWith("t212:") ? "trading212" : id.startsWith("tr:") ? "traderepublic" : null;
}

// Ids made from a row's own fields can repeat when two rows are alike (two savings plan buys of the same amount on
// the same day); the second gets ":1", the third ":2", in the statement's order, which every statement keeps.
export function numberRepeats(): (key: string) => string {
  const seen = new Map<string, number>();
  return (key) => {
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count === 0 ? key : `${key}:${count}`;
  };
}

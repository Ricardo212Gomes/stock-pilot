// Trading 212's activity statement (the PDF under History › Statements), read from its rows of cells (see
// lib/statement-pdf.ts). The Portfolio reads the invest account: its executed trades, open positions, dividends
// and interest. Card payments, deposits, withdrawals and transfers are only counted, and the crypto account is
// left alone.

import type { Money, Statement, StatementDividend, StatementInterest, StatementPosition, StatementTrade } from "./statements";

export type { Money } from "./statements";

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const TIME = /^(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2}:\d{2})$/;
const CURRENCY_SYMBOLS: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP", Fr: "CHF" };
const INTEREST_KINDS: Record<string, StatementInterest["kind"]> = { "Interest on cash": "cash", "Lending interest": "lending" };

// The same trade from any statement that includes it: order ids repeat across a partial fill's pieces.
function tradeId(orderId: string, time: string, shares: number, price: Money): string {
  return `t212:${orderId}:${time}:${shares}:${price.amount}`;
}

function parseNumber(text: string): number | null {
  if (!/^[\d,]+(\.\d+)?$/.test(text)) return null;
  const value = Number(text.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

// "€1,130.13", "$57.6147", "Fr 28.8467", "-€1.24", "GBX 412"; null for "-" or anything else.
export function parseMoney(cell: string): Money | null {
  const match = /^([-−–])?\s*(€|\$|£|Fr|[A-Z]{3})\s*([\d,]+(?:\.\d+)?)$/.exec(cell.trim());
  if (!match) return null;
  const amount = parseNumber(match[3]);
  if (amount === null) return null;
  return { amount: match[1] ? -amount : amount, currency: CURRENCY_SYMBOLS[match[2]] ?? match[2] };
}

// "€0.05", or "$0.06 (€0.05)": the amount in brackets is the account's.
function accountMoney(cell: string): Money | null {
  const converted = /\(([^()]+)\)\s*$/.exec(cell);
  return parseMoney(converted ? converted[1] : cell);
}

// "15.10.2025", or "15.10.2025 14:30" → "2025-10-15".
function statementDate(text: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})\b/.exec(text);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

// The table a row belongs to, from the headings: "Invest account - executed trades".
function sectionOf(line: string): string | null {
  const match = /^(Invest|Crypto) account\s*[-–—]\s*(.+)$/i.exec(line);
  return match ? `${match[1].toLowerCase()}: ${match[2].trim().toLowerCase()}` : null;
}

// Executed trades: time, instrument, ISIN, order id, direction, quantity, price, value, order type, venue,
// session, FX rate, FX fee, government fees, return, and the value in the account's currency, last.
function tradeFrom(cells: string[]): StatementTrade | null {
  const time = TIME.exec(cells[0] ?? "");
  if (!time || !ISIN.test(cells[2] ?? "") || !/^\d+$/.test(cells[3] ?? "")) return null;
  const side = cells[4] === "Buy" ? "buy" : cells[4] === "Sell" ? "sell" : null;
  const shares = parseNumber(cells[5] ?? "");
  const price = parseMoney(cells[6] ?? "");
  if (!side || shares === null || shares <= 0 || !price || price.amount <= 0) return null;
  const full = cells.length >= 16;
  const utc = `${time[1]}T${time[2]}Z`;
  return {
    id: tradeId(cells[3], utc, shares, price),
    time: utc,
    code: cells[1],
    isin: cells[2],
    side,
    shares,
    price,
    accountValue: cells.length > 9 ? parseMoney(cells[cells.length - 1]) : null,
    result: full && side === "sell" ? parseMoney(cells[14]) : null,
    orderType: cells[8] ?? "",
  };
}

// Open positions: instrument, ISIN, quantity, average price, price, then returns and values.
function positionFrom(cells: string[]): StatementPosition | null {
  if (!ISIN.test(cells[1] ?? "")) return null;
  const shares = parseNumber(cells[2] ?? "");
  if (shares === null) return null;
  return { code: cells[0], isin: cells[1], shares, averagePrice: parseMoney(cells[3] ?? "") };
}

// Dividends: instrument, ISIN, issuing country, eligible holdings, pay date, amount per share, gross amount,
// withholding tax rate, withholding tax, FX rate, and what was paid in the account's currency, last.
function dividendFrom(cells: string[]): StatementDividend | null {
  if (cells.length !== 11 || !ISIN.test(cells[1])) return null;
  const shares = parseNumber(cells[3]);
  const paidOn = statementDate(cells[4]);
  const amount = parseMoney(cells[10]);
  if (shares === null || !paidOn || !amount) return null;
  return { id: `t212:dividend:${cells[1]}:${cells[4]}:${shares}:${amount.amount}`, code: cells[0], isin: cells[1], shares, paidOn, amount };
}

// Null when the rows aren't a Trading 212 activity statement with trades or positions in it.
export function parseTrading212(rows: string[][]): Statement | null {
  let section = "";
  let from: string | null = null;
  let to: string | null = null;
  let overviewCurrency: string | null = null;
  const trades: StatementTrade[] = [];
  const positions: StatementPosition[] = [];
  const dividends: StatementDividend[] = [];
  const interest: StatementInterest[] = [];
  let otherCash = 0;
  for (const cells of rows) {
    const line = cells.join(" ");
    const heading = sectionOf(line);
    if (heading) {
      section = heading;
      continue;
    }
    const period = /covering from (\d{2}\.\d{2}\.\d{4})\b.*? to (\d{2}\.\d{2}\.\d{4})\b/.exec(line);
    if (period) {
      from = statementDate(period[1]);
      to = statementDate(period[2]);
      continue;
    }
    // The overview's invest and crypto tables sit side by side, so the invest account's value comes first.
    if (!overviewCurrency && cells[0] === "Account value") overviewCurrency = parseMoney(cells[1] ?? "")?.currency ?? null;
    if (section === "invest: executed trades") {
      const trade = tradeFrom(cells);
      if (trade) trades.push(trade);
    } else if (section === "invest: open positions summary") {
      const position = positionFrom(cells);
      if (position) positions.push(position);
    } else if (section === "invest: transactions and dividends") {
      const time = TIME.exec(cells[0] ?? "");
      if (time && cells.length === 3) {
        const kind = INTEREST_KINDS[cells[1]];
        const amount = kind ? accountMoney(cells[2]) : null;
        // The time and the amount as written, which tells a payment on dollars from one on euros at the same second.
        if (kind && amount) interest.push({ id: `t212:interest:${time[1]}T${time[2]}Z:${cells[2]}`, paidOn: time[1], kind, amount });
        else otherCash++;
        continue;
      }
      const dividend = dividendFrom(cells);
      if (dividend) dividends.push(dividend);
    }
  }
  if (trades.length === 0 && positions.length === 0) return null;
  const accountCurrency = trades.find((trade) => trade.accountValue)?.accountValue?.currency ?? overviewCurrency;
  return { broker: "trading212", from, to, accountCurrency, trades, positions, dividends, interest, otherCash };
}

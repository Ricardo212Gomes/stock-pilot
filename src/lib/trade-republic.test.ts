import { describe, expect, it } from "vitest";
import { parseStatement } from "./parse-statement";
import type { TextItem } from "./statement-pdf";
import { amountOf, parseTradeRepublic, tradeRepublicRows } from "./trade-republic";

// Made-up pages laid out as Trade Republic's account statement: each piece of text where the PDF puts it. A row
// is a band of three lines: the day and month above the year, with the type and amounts between them and the
// description on the middle line, or on the top and bottom ones when it wraps.
const COLUMNS = { date: 74, type: 105, description: 151, in: 402, out: 443, balance: 501 };

function item(str: string, x: number, y: number): TextItem {
  return { str, x, y };
}

function header(y: number): TextItem[] {
  return [
    item("DATA", COLUMNS.date, y),
    item("TIPO", COLUMNS.type, y),
    item("DESCRIÇÃO", COLUMNS.description, y),
    item("ENTRADA DE", COLUMNS.in, y + 3),
    item("DINHEIRO", COLUMNS.in, y - 3),
    item("SAÍDA DE", COLUMNS.out, y + 3),
    item("DINHEIRO", COLUMNS.out, y - 3),
    item("SALDO", COLUMNS.balance, y),
  ];
}

function row(top: number, day: string, year: string, type: string, description: string[], amounts: [number, string][]): TextItem[] {
  const middle = top - 3.8;
  return [
    item(day, COLUMNS.date, top),
    item(year, COLUMNS.date, top - 7.6),
    item(type, COLUMNS.type, middle),
    ...(description.length === 1 ? [item(description[0], COLUMNS.description, middle)] : [item(description[0], COLUMNS.description, top), item(description[1], COLUMNS.description, top - 7.6)]),
    ...amounts.map(([x, str]) => item(str, x, middle)),
  ];
}

const PAGE_ONE: TextItem[] = [
  item("TRADE REPUBLIC BANK GMBH, SUCURSAL EM PORTUGAL", 74, 732),
  item("JANE DOE", 75, 697),
  item("DATA", 389, 697),
  item("01 out. 2026 - 30 nov. 2026", 428, 697),
  // The summary table: five columns, not the transactions'.
  item("PRODUTO", 74, 596),
  item("SALDO INICIAL", 169, 596),
  item("ENTRADA DE DINHEIRO", 243, 596),
  item("SAÍDA DE DINHEIRO", 356, 596),
  item("SALDO FINAL", 486, 596),
  item("Conta corrente", 74, 580),
  item("0,00 €", 169, 580),
  item("TRANSAÇÕES", 74, 520),
  ...header(492),
  ...row(472, "16 out.", "2026", "Transferência", ["Incoming transfer from JANE DOE", "(PT50000000000000000000000)"], [[402, "3 500,00 €"], [484, "3 500,00 €"]]),
  // What went out and the balance in one piece of text.
  ...row(440, "26 out.", "2026", "Comércio", ["Buy trade US0231351067 AMAZON.COM INC. DL-,01, quantity: 5"], [[443, "1 120,29 € 2 379,71 €"]]),
  ...row(408, "01 nov.", "2026", "Juros", ["Interest payment"], [[402, "8,17 €"], [480, "2 387,88 €"]]),
  ...row(376, "02 nov.", "2026", "Comércio", ["Savings plan execution IE00B5BMR087 iShares VII plc - iShares Core S&P", "500 UCITS ETF USD (Acc), quantity: 0.067899"], [[443, "50,00 €"], [480, "2 337,88 €"]]),
  // The same plan again that day: alike in every field.
  ...row(344, "02 nov.", "2026", "Comércio", ["Savings plan execution IE00B5BMR087 iShares VII plc - iShares Core S&P", "500 UCITS ETF USD (Acc), quantity: 0.067899"], [[443, "50,00 €"], [480, "2 287,88 €"]]),
  // The footer, in the date column but not a date.
  item("Trade Republic Bank GmbH, Sucursal em Portugal", 73, 78),
  item("1050-196 Lisboa", 73, 64),
];

const PAGE_TWO: TextItem[] = [
  ...header(681),
  ...row(662, "05 nov.", "2026", "Comércio", ["Buy trade US5951121038 MICRON TECHN. INC. DL-,10, quantity: 1.5"], [[443, "1 035,74 €"], [484, "1 252,14 €"]]),
  ...row(630, "09 nov.", "2026", "Comércio", ["Sell trade US7475251036 QUALCOMM INC. DL-,0001, quantity: 7"], [[402, "1 024,88 €"], [484, "2 277,02 €"]]),
  ...row(598, "10 nov.", "2026", "Rendimento", ["Cash Dividend for ISIN US5951121038, quantity: 1.5"], [[402, "0,15 €"], [484, "2 277,17 €"]]),
];

describe("amountOf", () => {
  it("reads amounts written either way", () => {
    expect(amountOf("1 120,29 €")).toBe(1120.29);
    expect(amountOf("1 120,29 €")).toBe(1120.29);
    expect(amountOf("1.120,29 €")).toBe(1120.29);
    expect(amountOf("€1,120.29")).toBe(1120.29);
    expect(amountOf("-50,00 €")).toBe(-50);
    expect(amountOf("8,17 €")).toBe(8.17);
    expect(amountOf("€12")).toBe(12);
    expect(amountOf("Lisboa")).toBeNull();
  });
});

describe("tradeRepublicRows", () => {
  it("puts each band's pieces in their columns, a wrapped description back together", () => {
    const rows = tradeRepublicRows(PAGE_ONE);
    expect(rows.map((entry) => [entry.date, entry.type, entry.moneyIn, entry.moneyOut, entry.balance])).toEqual([
      ["2026-10-16", "Transferência", 3500, null, 3500],
      ["2026-10-26", "Comércio", null, 1120.29, 2379.71],
      ["2026-11-01", "Juros", 8.17, null, 2387.88],
      ["2026-11-02", "Comércio", null, 50, 2337.88],
      ["2026-11-02", "Comércio", null, 50, 2287.88],
    ]);
    expect(rows[3].description).toBe("Savings plan execution IE00B5BMR087 iShares VII plc - iShares Core S&P 500 UCITS ETF USD (Acc), quantity: 0.067899");
  });
});

describe("parseTradeRepublic", () => {
  it("reads the trades, interest and dividends, and counts the rest", () => {
    const statement = parseTradeRepublic([PAGE_ONE, PAGE_TWO])!;
    expect(statement).toMatchObject({ broker: "traderepublic", from: "2026-10-01", to: "2026-11-30", accountCurrency: "EUR", positions: [], otherCash: 1 });
    expect(statement.trades.map((entry) => [entry.id, entry.code, entry.side, entry.shares, entry.accountValue?.amount, entry.orderType])).toEqual([
      ["tr:2026-10-26:US0231351067:buy:5:1120.29", "AMAZON.COM INC.", "buy", 5, -1120.29, "Market"],
      ["tr:2026-11-02:IE00B5BMR087:buy:0.067899:50", "iShares Core S&P 500 UCITS ETF USD (Acc)", "buy", 0.067899, -50, "Savings plan execution"],
      // Alike in every field: numbered, so both are imported, and once each.
      ["tr:2026-11-02:IE00B5BMR087:buy:0.067899:50:1", "iShares Core S&P 500 UCITS ETF USD (Acc)", "buy", 0.067899, -50, "Savings plan execution"],
      ["tr:2026-11-05:US5951121038:buy:1.5:1035.74", "MICRON TECHN. INC.", "buy", 1.5, -1035.74, "Market"],
      ["tr:2026-11-09:US7475251036:sell:7:1024.88", "QUALCOMM INC.", "sell", 7, 1024.88, "Market"],
    ]);
    // What was paid per share, fees included, and no return of Trade Republic's own.
    expect(statement.trades[0]).toMatchObject({ time: "2026-10-26T12:00:00Z", isin: "US0231351067", price: { amount: 1120.29 / 5, currency: "EUR" }, result: null });
    expect(statement.interest).toEqual([{ id: "tr:interest:2026-11-01:8.17", paidOn: "2026-11-01", kind: "cash", amount: { amount: 8.17, currency: "EUR" } }]);
    expect(statement.dividends).toEqual([{ id: "tr:dividend:2026-11-10:US5951121038:0.15", code: "US5951121038", isin: "US5951121038", shares: 1.5, paidOn: "2026-11-10", amount: { amount: 0.15, currency: "EUR" } }]);
  });

  it("reads a statement in English as well", () => {
    const page = [
      item("TRADE REPUBLIC BANK GMBH", 74, 732),
      item("DATE", COLUMNS.date, 492),
      item("TYPE", COLUMNS.type, 492),
      item("DESCRIPTION", COLUMNS.description, 492),
      item("MONEY IN", COLUMNS.in, 492),
      item("MONEY OUT", COLUMNS.out, 492),
      item("BALANCE", COLUMNS.balance, 492),
      ...row(472, "16 Oct", "2026", "Trade", ["Buy trade US55024U1097 LUMENTUM HLDGS IN.DL-,001, quantity: 2"], [[443, "€1,250.04"], [484, "€8,749.96"]]),
    ];
    expect(parseTradeRepublic([page])?.trades).toEqual([expect.objectContaining({ code: "LUMENTUM HLDGS IN.", time: "2026-10-16T12:00:00Z", shares: 2, accountValue: { amount: -1250.04, currency: "EUR" } })]);
  });

  it("answers null for anything else, and tells the brokers' statements apart", () => {
    expect(parseTradeRepublic([[item("Monthly statement", 74, 700)]])).toBeNull();
    expect(parseStatement([PAGE_ONE])?.broker).toBe("traderepublic");
    const trading212 = [
      item("Invest account - executed trades", 40, 740),
      ...["2026-03-02 14:31:05", "NVD", "US67066G1040", "4011", "Buy", "2.5", "€151.20", "€378.15", "Market", "XNAS", "Regular", "1", "-", "-", "-", "-€378.15"].map((str, index) => item(str, 40 + index * 30, 700)),
    ];
    expect(parseStatement([trading212])?.broker).toBe("trading212");
  });
});

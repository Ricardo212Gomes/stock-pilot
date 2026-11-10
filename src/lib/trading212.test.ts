import { describe, expect, it } from "vitest";
import { parseMoney, parseTrading212 } from "./trading212";

// A made-up statement's rows, as lib/statement-pdf.ts reads them: one array of cells per line.
function tradeRow(time: string, code: string, isin: string, orderId: string, side: string, quantity: string, price: string, orderType: string, accountValue: string, result = "-"): string[] {
  return [time, code, isin, orderId, side, quantity, price, "€0.00", orderType, "XNAS", "Regular", "1.1612", "€0.15", "-", result, accountValue];
}

const ROWS: string[][] = [
  ["Activity statement"],
  ["Trading 212 activity statement covering from 01.03.2026 00:00 to 30.06.2026 23:59"],
  ["Overview"],
  ["Account value", "€4,215.80", "Account value", "€12.40"],
  ["Invest account - executed trades"],
  ["EXECUTION TIME", "INSTRUMENT", "ISIN", "ORDER ID", "DIRECTION", "QUANTITY", "EXECUTION PRICE", "VALUE", "ORDER TYPE", "VENUE", "SESSION", "FX RATE", "FX FEE", "GOVT FEES", "RETURN", "VALUE"],
  tradeRow("2026-03-02 14:31:05", "NVD", "US67066G1040", "4011", "Buy", "2.5", "€151.20", "Market", "-€378.15"),
  tradeRow("2026-03-03 15:02:11", "NVDA", "US67066G1040", "4012", "Buy", "1", "$176.10", "Limit", "-€151.80"),
  tradeRow("2026-04-01 13:45:00", "FSE", "IE00BK5BQT80", "4013", "Sell", "1,200", "€1.02", "Market", "€1,224.00", "€24.00"),
  // A page's running footer and a date that isn't a trade.
  ["Page 3 of 9"],
  ["2026-04-02", "Something else"],
  ["Invest account - open positions summary"],
  ["INSTRUMENT", "ISIN", "QUANTITY", "AVERAGE PRICE", "PRICE", "RETURN", "VALUE", "", "", ""],
  ["NVDA", "US67066G1040", "3.5", "€151.33", "€160.00", "€30.35", "€560.00", "-", "-", "-"],
  ["Invest account - transactions and dividends"],
  ["TIME", "TYPE", "AMOUNT"],
  ["2026-03-01 09:12:44", "JP Morgan bank deposit", "€1,000.00"],
  ["2026-03-02 00:30:12", "Interest on cash", "€0.05"],
  ["2026-03-02 00:30:12", "Interest on cash", "$0.06 (€0.05)"],
  ["2026-03-05 18:20:00", "Card purchase", "-€12.40"],
  ["2026-03-05 18:20:01", "Card cashback", "€0.12"],
  ["2026-04-01 10:00:00", "Lending interest", "€0.31"],
  ["INSTRUMENT", "ISIN", "ISSUING COUNTRY", "ELIGIBLE HOLDINGS", "PAY DATE", "AMOUNT PER SHARE", "GROSS AMOUNT", "WHT RATE", "WHT", "FX RATE", "NET AMOUNT"],
  ["NVD", "US67066G1040", "United States", "3.5", "02.04.2026 14:30", "€0.0086", "€0.0301", "15%", "€0.0045", "1", "€0.03"],
  ["Crypto account - executed trades"],
  ["2026-05-01 10:00:00", "BTC/EUR", "Bitcoin", "90010000001", "90010000002", "Buy", "0.01", "€80,000.00", "€800.00", "-"],
  ["Crypto account - transactions"],
  ["2026-05-01 09:00:00", "Transfer between accounts", "€800.00"],
];

describe("parseMoney", () => {
  it("reads amounts with their currency", () => {
    expect(parseMoney("€1,130.13")).toEqual({ amount: 1130.13, currency: "EUR" });
    expect(parseMoney("$57.6147")).toEqual({ amount: 57.6147, currency: "USD" });
    expect(parseMoney("-€1.24")).toEqual({ amount: -1.24, currency: "EUR" });
    expect(parseMoney("Fr 28.8467")).toEqual({ amount: 28.8467, currency: "CHF" });
    expect(parseMoney("GBX 412")).toEqual({ amount: 412, currency: "GBX" });
    expect(parseMoney("-")).toBeNull();
    expect(parseMoney("1,130.13")).toBeNull();
  });
});

describe("parseTrading212", () => {
  it("reads the invest account's executed trades and open positions, and the period", () => {
    const statement = parseTrading212(ROWS);
    expect(statement).toMatchObject({ broker: "trading212", from: "2026-03-01", to: "2026-06-30", accountCurrency: "EUR" });
    expect(statement?.trades).toEqual([
      {
        // From the order id, time, shares and price: the same in any statement that includes it.
        id: "t212:4011:2026-03-02T14:31:05Z:2.5:151.2",
        time: "2026-03-02T14:31:05Z",
        code: "NVD",
        isin: "US67066G1040",
        side: "buy",
        shares: 2.5,
        price: { amount: 151.2, currency: "EUR" },
        accountValue: { amount: -378.15, currency: "EUR" },
        result: null,
        orderType: "Market",
      },
      expect.objectContaining({ code: "NVDA", price: { amount: 176.1, currency: "USD" }, accountValue: { amount: -151.8, currency: "EUR" }, orderType: "Limit" }),
      // Trading 212's own return on the sale.
      expect.objectContaining({ code: "FSE", side: "sell", shares: 1200, accountValue: { amount: 1224, currency: "EUR" }, result: { amount: 24, currency: "EUR" } }),
    ]);
    // The crypto account's trades aren't the invest account's.
    expect(statement?.positions).toEqual([{ code: "NVDA", isin: "US67066G1040", shares: 3.5, averagePrice: { amount: 151.33, currency: "EUR" } }]);
  });

  it("reads dividends after withholding tax, and interest in the account's currency", () => {
    const statement = parseTrading212(ROWS)!;
    expect(statement.dividends).toEqual([
      { id: "t212:dividend:US67066G1040:02.04.2026 14:30:3.5:0.03", code: "NVD", isin: "US67066G1040", shares: 3.5, paidOn: "2026-04-02", amount: { amount: 0.03, currency: "EUR" } },
    ]);
    expect(statement.interest).toEqual([
      { id: "t212:interest:2026-03-02T00:30:12Z:€0.05", paidOn: "2026-03-02", kind: "cash", amount: { amount: 0.05, currency: "EUR" } },
      // Interest on dollars, in euros: the same second and amount, but its own payment.
      { id: "t212:interest:2026-03-02T00:30:12Z:$0.06 (€0.05)", paidOn: "2026-03-02", kind: "cash", amount: { amount: 0.05, currency: "EUR" } },
      { id: "t212:interest:2026-04-01T10:00:00Z:€0.31", paidOn: "2026-04-01", kind: "lending", amount: { amount: 0.31, currency: "EUR" } },
    ]);
    // The deposit and the card's payment and cashback; the crypto account's transfer isn't counted.
    expect(statement.otherCash).toBe(3);
  });

  it("takes the account's currency from the overview when no trade has a total", () => {
    const rows = ROWS.filter((cells) => cells.length !== 16 || !/^\d{4}-/.test(cells[0]));
    expect(parseTrading212(rows)).toMatchObject({ trades: [], accountCurrency: "EUR", positions: [expect.objectContaining({ code: "NVDA" })] });
  });

  it("answers null for anything else", () => {
    expect(parseTrading212([])).toBeNull();
    expect(parseTrading212([["Monthly statement"], ["Date", "Description", "Amount"], ["2026-03-02", "Card payment", "-€12.00"]])).toBeNull();
  });
});

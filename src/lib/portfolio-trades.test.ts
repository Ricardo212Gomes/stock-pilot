import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny stand-in for the postgres tagged template: records each query and answers from a list.
const queries: { text: string; values: unknown[] }[] = [];
let answers: unknown[][] = [];
vi.mock("./db", () => ({
  getSql: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join("?").replace(/\s+/g, " ").trim(), values });
    return Promise.resolve(answers.shift() ?? []);
  },
}));

const {
  deleteAllTrades,
  deleteTrade,
  getPortfolioCurrency,
  insertIncome,
  insertTrade,
  insertTrades,
  listImportState,
  listIncome,
  listTrades,
  parseTradeInput,
  relabelInstruments,
  setPortfolioCurrency,
} = await import("./portfolio-trades");

beforeEach(() => {
  queries.length = 0;
  answers = [];
});

describe("trades in the database", () => {
  it("lists a user's trades oldest first, as numbers and plain dates, in the currency paid", async () => {
    answers = [[
      { id: "7", symbol: "AAPL", side: "buy", shares: "10.5", price: "189.25", currency: "USD", traded_on: "2026-03-02", imported: false, priced: true, label: null, name: null },
      { id: "8", symbol: "US0378331005", side: "sell", shares: "2", price: "160.4", currency: "EUR", traded_on: "2026-03-03", imported: true, priced: false, label: "APC", name: null },
    ]];
    await expect(listTrades("user-1")).resolves.toEqual([
      { id: 7, symbol: "AAPL", side: "buy", shares: 10.5, price: 189.25, currency: "USD", date: "2026-03-02", imported: false, priced: true, label: null, name: null },
      { id: 8, symbol: "US0378331005", side: "sell", shares: 2, price: 160.4, currency: "EUR", date: "2026-03-03", imported: true, priced: false, label: "APC", name: null },
    ]);
    expect(queries[0].text).toMatch(/external_id is not null as imported, priced, label, name from portfolio_trades where user_id = \? order by traded_on, id$/);
    expect(queries[0].values).toEqual(["user-1"]);
  });

  it("adds a trade, and deletes only the user's own", async () => {
    await insertTrade("user-1", { symbol: "MSFT", side: "sell", shares: 2, price: 410, currency: "USD", date: "2026-11-09" });
    expect(queries[0].values).toEqual(["user-1", "MSFT", "sell", 2, 410, "USD", "2026-11-09", null]);

    answers = [[{ id: 3 }], []];
    await expect(deleteTrade("user-1", 3)).resolves.toBe(true);
    await expect(deleteTrade("user-2", 3)).resolves.toBe(false);
    expect(queries[1].text).toMatch(/where user_id = \? and id = \?/);
    expect(queries[2].values).toEqual(["user-2", 3]);

    answers = [[{ id: 1 }, { id: 2 }]];
    await expect(deleteAllTrades("user-1")).resolves.toBe(2);
    expect(queries[3]).toEqual({ text: "delete from portfolio_trades where user_id = ? returning id", values: ["user-1"] });
    // The dividends and interest imported with them go too.
    expect(queries[4]).toEqual({ text: "delete from portfolio_income where user_id = ?", values: ["user-1"] });
  });

  it("imports many trades in one statement, in their order, skipping broker ids already saved", async () => {
    await expect(insertTrades("user-1", [])).resolves.toBe(0);
    expect(queries).toEqual([]);

    answers = [[{ id: "41" }]];
    const added = await insertTrades("user-1", [
      { symbol: "NVDA", side: "buy", shares: 1.5, price: 151.2, currency: "EUR", date: "2026-10-02", externalId: "t212:1", isin: "US67066G1040", priced: true, label: null, name: null },
      { symbol: "US0378331005", side: "sell", shares: 0.5, price: 160, currency: "EUR", date: "2026-10-02", externalId: "t212:2", isin: "US0378331005", priced: false, label: "APC", name: "Apple Inc" },
    ]);
    expect(added).toBe(1);
    expect(queries[0].text).toMatch(/from unnest\(.*\) with ordinality as imported\(.*, position\) order by position on conflict \(user_id, external_id\) where external_id is not null do nothing returning id$/);
    expect(queries[0].values).toEqual([
      "user-1",
      ["NVDA", "US0378331005"],
      ["buy", "sell"],
      [1.5, 0.5],
      [151.2, 160],
      ["EUR", "EUR"],
      ["2026-10-02", "2026-10-02"],
      ["t212:1", "t212:2"],
      ["US67066G1040", "US0378331005"],
      // As text: postgres.js would send an array of booleans as one.
      ["true", "false"],
      [null, "APC"],
      [null, "Apple Inc"],
    ]);
  });

  it("keeps imported dividends and interest, each once", async () => {
    await expect(insertIncome("user-1", [])).resolves.toBe(0);
    answers = [[{ id: "1" }, { id: "2" }]];
    await expect(
      insertIncome("user-1", [
        { kind: "dividend", symbol: "NVDA", isin: "US67066G1040", amount: 0.03, currency: "EUR", date: "2026-04-02", externalId: "t212:dividend:1" },
        { kind: "interest", symbol: null, isin: null, amount: 0.05, currency: "EUR", date: "2026-03-02", externalId: "t212:interest:1" },
      ]),
    ).resolves.toBe(2);
    expect(queries[0].text).toMatch(/^insert into portfolio_income .* on conflict \(user_id, external_id\) where external_id is not null do nothing returning id$/);
    expect(queries[0].values).toEqual(["user-1", ["dividend", "interest"], ["NVDA", null], ["US67066G1040", null], [0.03, 0.05], ["EUR", "EUR"], ["2026-04-02", "2026-03-02"], ["t212:dividend:1", "t212:interest:1"]]);

    answers = [[{ kind: "dividend", symbol: "NVDA", amount: "0.03", currency: "EUR", paid_on: "2026-04-02" }]];
    await expect(listIncome("user-1")).resolves.toEqual([{ kind: "dividend", symbol: "NVDA", amount: 0.03, currency: "EUR", date: "2026-04-02" }]);
  });

  it("tells imported trades from ones entered by hand, and knows what each ISIN was saved as", async () => {
    answers = [
      [
        { symbol: "NVDA", external_id: "t212:1", isin: "US67066G1040", priced: true, side: "buy", shares: "3" },
        { symbol: "NVDA", external_id: "tr:2026-11-09:US67066G1040:buy:10:1561.44", isin: "US67066G1040", priced: true, side: "buy", shares: "10" },
        { symbol: "NVDA", external_id: "t212:2", isin: "US67066G1040", priced: true, side: "sell", shares: "1" },
        { symbol: "US0378331005", external_id: "t212:3", isin: "US0378331005", priced: false, side: "buy", shares: "1" },
        { symbol: "AAPL", external_id: null, isin: null, priced: true, side: "buy", shares: "5" },
      ],
      [{ external_id: "t212:interest:1" }],
    ];
    await expect(listImportState("user-1")).resolves.toEqual({
      ids: new Set(["t212:1", "tr:2026-11-09:US67066G1040:buy:10:1561.44", "t212:2", "t212:3", "t212:interest:1"]),
      handEntered: new Set(["AAPL"]),
      // With what each broker's trades add up to.
      instruments: new Map([
        ["US67066G1040", { symbol: "NVDA", priced: true, shares: new Map([["trading212", 2], ["traderepublic", 10]]) }],
        ["US0378331005", { symbol: "US0378331005", priced: false, shares: new Map([["trading212", 1]]) }],
      ]),
      income: 1,
    });
  });

  it("moves an instrument's trades and dividends to its new symbol", async () => {
    await relabelInstruments("user-1", [{ isin: "AU0000185993", symbol: "IREN", priced: true, label: null, name: null }]);
    expect(queries[0].text).toMatch(/^update portfolio_trades set symbol = \?, priced = \?, label = \?, name = \? where user_id = \? and isin = \?$/);
    expect(queries[0].values).toEqual(["IREN", true, null, null, "user-1", "AU0000185993"]);
    expect(queries[1].text).toMatch(/^update portfolio_income set symbol = \? where user_id = \? and isin = \? and kind = 'dividend'$/);
    expect(queries[1].values).toEqual(["IREN", "user-1", "AU0000185993"]);
  });

  it("keeps the currency the portfolio is shown in, dollars until chosen", async () => {
    await expect(getPortfolioCurrency("user-1")).resolves.toBe("USD");
    answers = [[{ currency: "EUR" }]];
    await expect(getPortfolioCurrency("user-1")).resolves.toBe("EUR");
    await setPortfolioCurrency("user-1", "EUR");
    expect(queries[2].text).toMatch(/insert into portfolio_settings \(user_id, currency\) values \(\?, \?\) on conflict \(user_id\) do update/);
    expect(queries[2].values).toEqual(["user-1", "EUR"]);
  });
});

describe("parseTradeInput", () => {
  const today = "2026-11-10";
  const valid = { symbol: " brk.b ", side: "buy", date: "2026-11-09", shares: "1,250.5", price: "" };

  it("reads the form, with an empty price meaning that day's close", () => {
    expect(parseTradeInput(valid, today)).toEqual({ ok: true, value: { symbol: "BRK-B", side: "buy", shares: 1250.5, price: null, currency: "USD", date: "2026-11-09" } });
    expect(parseTradeInput({ ...valid, price: "$412.30" }, today)).toMatchObject({ ok: true, value: { price: 412.3 } });
    expect(parseTradeInput({ ...valid, price: "€380.10", currency: "EUR" }, today)).toMatchObject({ ok: true, value: { price: 380.1, currency: "EUR" } });
  });

  it("explains what's wrong", () => {
    const errors = [
      { ...valid, symbol: "<b>" },
      { ...valid, side: "short" },
      { ...valid, date: "2026-02-30" },
      { ...valid, date: "2026-11-11" },
      { ...valid, date: "1975-01-02" },
      { ...valid, shares: "0" },
      { ...valid, shares: "ten" },
      { ...valid, price: "-3" },
      { ...valid, currency: "GBP" },
      null,
    ].map((input) => {
      const parsed = parseTradeInput(input, today);
      return parsed.ok ? null : parsed.error;
    });
    expect(errors).toEqual([
      "Enter a ticker, like AAPL.",
      "Choose Buy or Sell.",
      "Enter the trade's date.",
      "The date can't be in the future.",
      "Enter a date from 1980 on.",
      "Enter how many shares, more than zero.",
      "Enter how many shares, more than zero.",
      "Enter the price per share, or leave it empty for that day's close.",
      "Choose dollars or euros.",
      "Enter a ticker, like AAPL.",
    ]);
  });
});

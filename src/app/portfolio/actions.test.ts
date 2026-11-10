import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportPlan } from "@/lib/portfolio-import";

const session = { userId: null as string | null };
vi.mock("@/auth", () => ({ currentUserId: async () => session.userId }));
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/cache", () => ({ refresh }));
const store = {
  list: vi.fn(),
  insert: vi.fn(),
  insertMany: vi.fn(),
  remove: vi.fn(),
  removeAll: vi.fn(),
  importState: vi.fn(),
  currency: vi.fn(),
  setCurrency: vi.fn(),
  insertIncome: vi.fn(),
  relabel: vi.fn(),
};
vi.mock("@/lib/portfolio-trades", async (original) => ({
  ...(await original<typeof import("@/lib/portfolio-trades")>()),
  listTrades: (...args: unknown[]) => store.list(...args),
  insertTrade: (...args: unknown[]) => store.insert(...args),
  insertTrades: (...args: unknown[]) => store.insertMany(...args),
  deleteTrade: (...args: unknown[]) => store.remove(...args),
  deleteAllTrades: (...args: unknown[]) => store.removeAll(...args),
  listImportState: (...args: unknown[]) => store.importState(...args),
  getPortfolioCurrency: (...args: unknown[]) => store.currency(...args),
  setPortfolioCurrency: (...args: unknown[]) => store.setCurrency(...args),
  insertIncome: (...args: unknown[]) => store.insertIncome(...args),
  relabelInstruments: (...args: unknown[]) => store.relabel(...args),
}));
const prepare = vi.fn();
vi.mock("@/lib/portfolio", async (original) => ({
  ...(await original<typeof import("@/lib/portfolio")>()),
  portfolioToday: () => "2026-11-10",
  prepareTrade: (...args: unknown[]) => prepare(...args),
}));
// The PDF's rows and the plan stand in for pdf.js and the price lookups; the statement parser is the real one.
const readPdfItems = vi.fn();
vi.mock("@/lib/statement-pdf", async (original) => ({
  ...(await original<typeof import("@/lib/statement-pdf")>()),
  readPdfItems: (...args: unknown[]) => readPdfItems(...args),
}));
const planImport = vi.fn();
vi.mock("@/lib/portfolio-import", async (original) => ({
  ...(await original<typeof import("@/lib/portfolio-import")>()),
  planImport: (...args: unknown[]) => planImport(...args),
}));

const { addTradeAction, deleteAllTradesAction, deleteTradeAction, importStatementAction, previewStatementAction, setCurrencyAction } = await import("./actions");
const { MAX_SYMBOLS } = await import("@/lib/portfolio");

const form = { symbol: "aapl", side: "buy", date: "2026-11-09", shares: "10", price: "" };

function tickers(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: index + 1, symbol: `T${index}`, side: "buy", shares: 1, price: 1, currency: "USD", date: "2026-01-02" }));
}

beforeEach(() => {
  session.userId = null;
  for (const mock of [...Object.values(store), prepare, readPdfItems, planImport, refresh]) mock.mockReset();
  vi.stubEnv("DATABASE_URL", "postgres://test");
});

describe("addTradeAction", () => {
  it("needs a signed-in user and a database", async () => {
    await expect(addTradeAction(form)).resolves.toEqual({ ok: false, error: "Sign in to keep a portfolio." });
    session.userId = "user-1";
    vi.stubEnv("DATABASE_URL", "");
    await expect(addTradeAction(form)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/DATABASE_URL/) });
    expect(store.list).not.toHaveBeenCalled();
  });

  it("checks the trade, then saves it for the session's user", async () => {
    session.userId = "user-1";
    store.list.mockResolvedValue([]);
    prepare.mockResolvedValue({ ok: true, trade: { symbol: "AAPL", side: "buy", shares: 10, price: 268.47, currency: "USD", date: "2026-11-09" } });
    await expect(addTradeAction(form)).resolves.toEqual({ ok: true, message: "Added: bought 10 AAPL at $268.47." });
    expect(prepare).toHaveBeenCalledWith({ symbol: "AAPL", side: "buy", shares: 10, price: null, currency: "USD", date: "2026-11-09" }, []);
    expect(store.insert).toHaveBeenCalledWith("user-1", { symbol: "AAPL", side: "buy", shares: 10, price: 268.47, currency: "USD", date: "2026-11-09" });
    expect(refresh).toHaveBeenCalledOnce();

    prepare.mockResolvedValue({ ok: true, trade: { symbol: "AAPL", side: "sell", shares: 2, price: 231.1, currency: "EUR", date: "2026-11-09" } });
    await expect(addTradeAction({ ...form, side: "sell", shares: "2", price: "231.10", currency: "EUR" })).resolves.toEqual({ ok: true, message: "Added: sold 2 AAPL at €231.10." });
    expect(prepare).toHaveBeenLastCalledWith(expect.objectContaining({ price: 231.1, currency: "EUR" }), []);
  });

  it("passes on what's wrong, without saving", async () => {
    session.userId = "user-1";
    await expect(addTradeAction({ ...form, date: "2026-11-11" })).resolves.toEqual({ ok: false, error: "The date can't be in the future." });

    store.list.mockResolvedValue([]);
    prepare.mockResolvedValue({ ok: false, error: "You held 2 AAPL shares then, so you can't sell 5." });
    await expect(addTradeAction({ ...form, side: "sell" })).resolves.toEqual({ ok: false, error: "You held 2 AAPL shares then, so you can't sell 5." });

    store.list.mockResolvedValue(tickers(MAX_SYMBOLS));
    await expect(addTradeAction(form)).resolves.toEqual({ ok: false, error: `A portfolio can follow up to ${MAX_SYMBOLS} tickers.` });

    store.list.mockRejectedValue(new Error("relation \"portfolio_trades\" does not exist"));
    await expect(addTradeAction(form)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/db:setup/) });
    expect(store.insert).not.toHaveBeenCalled();
  });
});

describe("deleting trades", () => {
  it("deletes the session user's trade by id", async () => {
    session.userId = "user-1";
    store.remove.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(deleteTradeAction(7)).resolves.toEqual({ ok: true, message: "Trade deleted." });
    expect(store.remove).toHaveBeenCalledWith("user-1", 7);
    await expect(deleteTradeAction(7)).resolves.toEqual({ ok: false, error: "That trade was already deleted." });
    await expect(deleteTradeAction("7 or 1=1")).resolves.toEqual({ ok: false, error: "That trade doesn't exist." });
  });

  it("deletes all of the session user's trades", async () => {
    await expect(deleteAllTradesAction()).resolves.toEqual({ ok: false, error: "Sign in to keep a portfolio." });
    session.userId = "user-1";
    store.removeAll.mockResolvedValue(12);
    await expect(deleteAllTradesAction()).resolves.toEqual({ ok: true, message: "Deleted 12 trades." });
    expect(store.removeAll).toHaveBeenCalledWith("user-1");
  });
});

describe("setCurrencyAction", () => {
  it("saves dollars or euros for the session's user", async () => {
    session.userId = "user-1";
    await expect(setCurrencyAction("GBP")).resolves.toEqual({ ok: false, error: "Choose dollars or euros." });
    await expect(setCurrencyAction("EUR")).resolves.toEqual({ ok: true, message: "Shown in euros." });
    expect(store.setCurrency).toHaveBeenCalledWith("user-1", "EUR");
    expect(refresh).toHaveBeenCalledOnce();
  });
});

// A statement as the PDF reader gives it: one executed trade is enough for the parser.
const STATEMENT_ROWS = [
  ["Invest account - executed trades"],
  ["2026-03-03 15:02:11", "NVDA", "US67066G1040", "4012", "Buy", "1", "$176.10", "€151.80", "Market", "XNAS", "Regular", "1.16", "€0.15", "-", "-", "-€151.80"],
];

// One page of text laid out as those rows: a line each, the cells left to right.
function pageOf(rows: string[][]) {
  return [rows.flatMap((cells, line) => cells.map((str, cell) => ({ str, x: 40 + cell * 30, y: 800 - line * 20 })))];
}

const PLAN: ImportPlan = {
  broker: "trading212",
  from: "2026-03-01",
  to: "2026-06-30",
  currency: "EUR",
  holdings: [{ symbol: "NVDA", name: "NVIDIA Corp", isin: "US67066G1040", codes: ["NVDA"], trades: 2, shares: 1.5, tradedShares: 1.5, priced: true }],
  unresolved: [],
  unchecked: [],
  sold: { instruments: 1, trades: 1 },
  incomplete: [],
  dividends: 1,
  interest: 0,
  otherCash: 4,
  splits: 0,
  duplicates: 0,
  withoutTotal: 0,
  realized: { afterFees: 0, broker: 0 },
  relabels: [{ isin: "AU0000185993", symbol: "IREN", priced: true, label: null, name: null }],
  trades: [
    { symbol: "NVDA", side: "buy", shares: 1, price: 151.8, currency: "EUR", date: "2026-03-03", externalId: "t212:4012", isin: "US67066G1040", priced: true, label: null, name: null },
    { symbol: "NVDA", side: "buy", shares: 0.5, price: 152, currency: "EUR", date: "2026-03-04", externalId: "t212:4013", isin: "US67066G1040", priced: true, label: null, name: null },
    // A company sold off: without prices, so it doesn't count towards the tickers followed.
    { symbol: "US0378331005", side: "buy", shares: 1, price: 215, currency: "EUR", date: "2026-03-05", externalId: "t212:4014", isin: "US0378331005", priced: false, label: "AAPL", name: "Apple Inc" },
  ],
  income: [{ kind: "dividend", symbol: "NVDA", isin: "US67066G1040", amount: 0.03, currency: "EUR", date: "2026-04-02", externalId: "t212:dividend:1" }],
};

const STATE = { ids: new Set(["t212:3999"]), handEntered: new Set(["NVDA"]), instruments: new Map(), income: 0 };

function upload(bytes: string | Uint8Array<ArrayBuffer>, extra: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set("statement", new File([typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes], "statement.pdf", { type: "application/pdf" }));
  for (const [key, value] of Object.entries(extra)) data.set(key, value);
  return data;
}

function signedInWithStatement() {
  session.userId = "user-1";
  readPdfItems.mockResolvedValue(pageOf(STATEMENT_ROWS));
  planImport.mockResolvedValue({ ok: true, plan: PLAN });
  store.list.mockResolvedValue([{ id: 1, symbol: "NVDA", side: "buy", shares: 1, price: 120, currency: "USD", date: "2026-01-05" }]);
  store.importState.mockResolvedValue(STATE);
  store.currency.mockResolvedValue("USD");
}

describe("previewStatementAction", () => {
  it("checks the file is a statement before reading it", async () => {
    session.userId = "user-1";
    await expect(previewStatementAction(new FormData())).resolves.toEqual({ ok: false, error: "Choose your Trading 212 or Trade Republic statement, a PDF." });
    await expect(previewStatementAction(upload("PK\u0003\u0004 a zip"))).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/isn't a PDF/) });
    await expect(previewStatementAction(upload(new Uint8Array(10 * 1024 * 1024)))).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/over 9.5 MB/) });
    readPdfItems.mockRejectedValueOnce(new Error("Invalid PDF structure."));
    await expect(previewStatementAction(upload("%PDF-1.7 broken"))).resolves.toEqual({ ok: false, error: "The PDF couldn't be read." });
    readPdfItems.mockResolvedValueOnce(pageOf([["Monthly statement"], ["2026-03-02", "Card payment", "-€12.00"]]));
    await expect(previewStatementAction(upload("%PDF-1.7"))).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/doesn't look like a Trading 212 activity statement or a Trade Republic account statement/) });
    expect(planImport).not.toHaveBeenCalled();
  });

  it("shows what would be imported, without saving anything", async () => {
    signedInWithStatement();
    const result = await previewStatementAction(upload("%PDF-1.7"));
    // The counts, without the trades and payments themselves.
    const counts = Object.fromEntries(Object.entries(PLAN).filter(([key]) => !["trades", "income", "relabels"].includes(key)));
    expect(result).toEqual({ ok: true, preview: { ...counts, newTrades: 3, addsTo: ["NVDA"], portfolioCurrency: "USD", blocked: null } });
    // The statement parsed from the rows, with what the user imported before.
    expect(planImport).toHaveBeenCalledWith(expect.objectContaining({ broker: "trading212", trades: [expect.objectContaining({ id: expect.stringMatching(/^t212:4012:/), code: "NVDA" })] }), STATE);
    expect(store.insertMany).not.toHaveBeenCalled();
    expect(store.setCurrency).not.toHaveBeenCalled();
  });

  it("says when the portfolio couldn't take the trades", async () => {
    signedInWithStatement();
    store.list.mockResolvedValue(tickers(MAX_SYMBOLS));
    const result = await previewStatementAction(upload("%PDF-1.7"));
    expect(result).toMatchObject({ ok: true, preview: { blocked: `With these the portfolio would follow ${MAX_SYMBOLS + 2} tickers with prices, and it can follow up to ${MAX_SYMBOLS}.` } });

    // Instruments without prices cost nothing, so they don't count.
    store.list.mockResolvedValue(tickers(MAX_SYMBOLS).map((trade) => ({ ...trade, priced: false })));
    await expect(previewStatementAction(upload("%PDF-1.7"))).resolves.toMatchObject({ ok: true, preview: { blocked: null } });
  });
});

describe("importStatementAction", () => {
  it("saves the statement's trades for the session's user, and the currency when asked", async () => {
    signedInWithStatement();
    store.insertMany.mockResolvedValue(3);
    store.insertIncome.mockResolvedValue(1);
    await expect(importStatementAction(upload("%PDF-1.7"))).resolves.toEqual({ ok: true, message: "Imported 3 trades and 1 dividend and interest payment." });
    // Earlier imports move first, so the new trades join their positions.
    expect(store.relabel).toHaveBeenCalledWith("user-1", PLAN.relabels);
    expect(store.relabel.mock.invocationCallOrder[0]).toBeLessThan(store.insertMany.mock.invocationCallOrder[0]);
    expect(store.insertMany).toHaveBeenCalledWith("user-1", PLAN.trades);
    expect(store.insertIncome).toHaveBeenCalledWith("user-1", PLAN.income);
    expect(store.setCurrency).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();

    await importStatementAction(upload("%PDF-1.7", { currency: "EUR" }));
    expect(store.setCurrency).toHaveBeenCalledWith("user-1", "EUR");
    // Only the statement's own currency.
    store.setCurrency.mockClear();
    await importStatementAction(upload("%PDF-1.7", { currency: "GBP" }));
    expect(store.setCurrency).not.toHaveBeenCalled();
  });

  it("saves nothing the portfolio can't take, or when the database fails", async () => {
    signedInWithStatement();
    store.list.mockResolvedValue(tickers(MAX_SYMBOLS));
    await expect(importStatementAction(upload("%PDF-1.7"))).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/can follow up to/) });
    expect(store.insertMany).not.toHaveBeenCalled();

    store.list.mockResolvedValue([]);
    store.insertMany.mockRejectedValue(new Error("connection refused"));
    await expect(importStatementAction(upload("%PDF-1.7"))).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/couldn't be saved/) });
    expect(refresh).not.toHaveBeenCalled();
  });
});

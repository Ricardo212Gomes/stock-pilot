import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortfolioView, Trade } from "../portfolio";
import type { StockQuoteResult } from "../stock-overview";

const state = vi.hoisted(() => ({
  trades: [] as unknown[],
  view: null as unknown,
  databaseDown: false,
  favorites: [] as { symbol: string; createdAt: string }[],
}));

vi.mock("../portfolio-trades", async (original) => ({
  ...(await original<typeof import("../portfolio-trades")>()),
  listTrades: async () => {
    if (state.databaseDown) throw new Error("connection refused");
    return state.trades;
  },
  listIncome: async () => [],
  getPortfolioCurrency: async () => "USD",
}));
vi.mock("../portfolio", async (original) => ({
  ...(await original<typeof import("../portfolio")>()),
  getPortfolio: async () => state.view,
}));
vi.mock("../favorites", async (original) => ({
  ...(await original<typeof import("../favorites")>()),
  listFavorites: async () => state.favorites,
}));
vi.mock("../stock-overview", async (original) => ({
  ...(await original<typeof import("../stock-overview")>()),
  getHeaderQuote: async (symbol: string): Promise<StockQuoteResult> => (symbol === "AAPL"
    ? { ok: true, data: { symbol, name: "Apple Inc.", exchange: "NASDAQ", price: 350.5, change: 2, changePercent: 0.0057, quoteTime: null, marketCap: 5.12e12, source: "finnhub", raw: {} } }
    : { ok: false, reason: "no-data" }),
}));

const { CHAT_TOOLS, chatTools, compact, pricePerformance, runChatTool } = await import("./tools");

const context = { userId: null, now: new Date("2026-11-10T15:00:00Z") };
const signedIn = { ...context, userId: "user-1" };
const tool = (name: string) => CHAT_TOOLS.find((item) => item.declaration.name === name)!;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.stubEnv("FMP_API_KEY", "fmp-key");
  vi.stubEnv("FINNHUB_API_KEY", "finnhub-key");
  state.trades = [];
  state.view = null;
  state.databaseDown = false;
  state.favorites = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("compact", () => {
  it("drops unknown fields and emptied objects, but keeps a row's blanks", () => {
    expect(compact({ a: null, b: { c: undefined }, d: [null, 1, { e: null }], f: 0, g: "" })).toEqual({ d: [null, 1, {}], f: 0, g: "" });
  });
});

describe("pricePerformance", () => {
  it("works out returns, the 52-week range, averages and month-end closes", () => {
    const points = [];
    const day = new Date("2025-09-01T12:00:00Z");
    for (let close = 100; day.toISOString() < "2026-11-10"; day.setUTCDate(day.getUTCDate() + 1)) {
      if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
      points.push({ date: day.toISOString().slice(0, 10), close: (close += 0.5) });
    }
    const result = pricePerformance(points.reverse())!;
    const last = points[0];
    expect(result.latestClose).toBe(`$${last.close.toFixed(2)}`);
    expect(result.change["1 year"]).toMatch(/^\+\d+\.\d%$/);
    expect(result.change["year to date"]).toMatch(/^\+/);
    expect(result.fiftyTwoWeekHigh).toBe(`$${last.close.toFixed(2)} on ${last.date}`);
    expect(result.belowFiftyTwoWeekHigh).toBe("0.0%");
    expect(result.versus200DayAverage).toMatch(/^\+/);
    expect(result.monthEndCloses).toHaveLength(13);
    expect(result.monthEndCloses.at(-1)).toMatch(/^2026-11: \$/);
    expect(pricePerformance([])).toBeNull();
  });
});

describe("look-ups", () => {
  it("finds tickers in the bundled list without a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await runChatTool(CHAT_TOOLS, "find_stock", { query: "coca cola" }, context);
    expect(outcome.ok && (outcome.output.matches as { symbol: string }[])[0].symbol).toBe("KO");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a bad ticker before asking any provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(runChatTool(CHAT_TOOLS, "get_stock_overview", { symbol: "<b>" }, context)).resolves.toEqual({ ok: false, error: expect.stringMatching(/valid ticker/) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names each look-up and links the page that shows it", () => {
    expect(tool("get_financial_statement").source({ symbol: "aapl", statement: "cash-flow", period: "quarterly" })).toEqual({
      label: "AAPL cash flow (quarterly)",
      href: "/stock/financials?symbol=AAPL&statement=cash-flow&period=quarterly",
    });
    expect(tool("get_sec_filings").source({ symbol: "MSFT", type: "reports" })).toEqual({ label: "MSFT filings", href: "/stock/filings?symbol=MSFT&type=reports" });
    expect(tool("get_market_news").source({ category: "crypto" })).toEqual({ label: "Crypto news", href: "/news?category=crypto" });
    expect(tool("get_earnings_calendar").source({ week_of: "2026-11-12", include_small: true })).toEqual({ label: "Earnings week of 2026-11-09", href: "/earnings?week=2026-11-09&all=1" });
    expect(tool("get_earnings_call_summary").source({ symbol: "brk.b", quarter: "2026q3" })).toMatchObject({ href: "/stock/transcripts?symbol=BRK-B&quarter=2026Q3" });
    expect(tool("find_stock").source({ query: "x" })).toBeNull();
  });

  it("reads a statement with the figures formatted as on the page", async () => {
    const income = [2025, 2024].map((year) => ({
      date: `${year}-09-27`, fiscalYear: String(year), period: "FY", reportedCurrency: "USD",
      revenue: year === 2025 ? 416e9 : 391e9, netIncome: year === 2025 ? 112e9 : 93.7e9,
    }));
    vi.stubGlobal("fetch", vi.fn(async (input: URL | string) => json(new URL(String(input)).pathname.endsWith("/income-statement") ? income : [])));
    const outcome = await runChatTool(CHAT_TOOLS, "get_financial_statement", { symbol: "AAPL", statement: "income" }, context);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.output).toMatchObject({ symbol: "AAPL", statement: "income statement", period: "annual", source: "Financial Modeling Prep" });
    expect(String((outcome.output.columns as string[])[0])).toContain("2025-09-27");
    const revenue = (outcome.output.rows as { item: string; values: (string | null)[] }[]).find((row) => row.item === "Revenue");
    expect(revenue?.values[0]).toMatch(/^\$416(\.0)?B$/);
    await expect(runChatTool(CHAT_TOOLS, "get_financial_statement", { symbol: "AAPL", statement: "segments" }, context)).resolves.toMatchObject({ ok: false });
  });

  it("explains a provider's limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 429)));
    await expect(runChatTool(CHAT_TOOLS, "get_company_news", { symbol: "AAPL" }, context)).resolves.toEqual({ ok: false, error: expect.stringMatching(/request limit/) });
  });

  it("turns an unknown or failing look-up into an error the model can explain", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runChatTool(CHAT_TOOLS, "get_weather", {}, context)).resolves.toEqual({ ok: false, error: "There is no get_weather look-up." });
    const broken = [{ declaration: { name: "broken", description: "" }, source: () => null, run: async () => { throw new Error("boom"); } }];
    await expect(runChatTool(broken, "broken", {}, context)).resolves.toEqual({ ok: false, error: expect.stringMatching(/couldn't be loaded/) });
  });
});

describe("the signed-in user's own data", () => {
  it("is only offered with an account", () => {
    const names = (personal: boolean) => chatTools({ personal }).map((item) => item.declaration.name);
    expect(names(false)).not.toContain("get_my_portfolio");
    expect(names(true)).toEqual(expect.arrayContaining(["get_my_portfolio", "get_my_favorites"]));
  });

  it("summarizes the portfolio in its currency", async () => {
    await expect(runChatTool(CHAT_TOOLS, "get_my_portfolio", {}, context)).resolves.toEqual({ ok: false, error: "The user isn't signed in." });
    await expect(runChatTool(CHAT_TOOLS, "get_my_portfolio", {}, signedIn)).resolves.toMatchObject({ ok: true, output: { holdings: [], note: expect.stringMatching(/No trades/) } });

    state.trades = [{ id: 1 } as unknown as Trade];
    state.view = {
      today: "2026-11-10",
      currency: "USD",
      holdings: [{
        symbol: "AAPL", label: "AAPL", name: "Apple Inc.", priced: true, industry: "Consumer Electronics", shares: 10, averageCost: 150, cost: 1500,
        price: 350.5, priceSource: "live", dayChange: 20, dayChangePercent: 0.0057, value: 3505, gain: 2005, gainPercent: 1.3367, realized: 0,
        dividends: 12.5, annualDividend: 10.8, weight: 1,
      }],
      closed: [{ symbol: "XYZ", label: "XYZ", name: "Old Co", priced: true, realized: -120, dividends: 0, soldOn: "2026-03-01" }],
      trades: [{ date: "2026-01-05" }],
      totals: {
        value: 3505, cost: 1500, gain: 2005, gainPercent: 1.3367, dayChange: 20, dayChangePercent: 0.0057, stalePrices: 0, realized: -120,
        dividends: 12.5, interest: 0, profit: 1897.5, annualIncome: 10.8, incomeYield: 0.0031,
      },
      industries: [{ name: "Consumer Electronics", value: 3505, weight: 1 }],
      income: [],
      history: [
        { date: "2025-01-02", value: 1500, cost: 1500, growth: 1, benchmark: 500 },
        { date: "2026-11-10", value: 3505, cost: 1500, growth: 2.2, benchmark: 650 },
      ],
      historyIssue: null,
      unpriced: 0,
    } as unknown as PortfolioView;

    const outcome = await runChatTool(CHAT_TOOLS, "get_my_portfolio", {}, signedIn);
    expect(outcome).toMatchObject({
      ok: true,
      output: {
        currency: "USD",
        totals: { value: "$3,505.00", gain: "+$2,005.00", realizedGains: "-$120.00", totalProfit: "+$1,897.50" },
        performance: { since: "2025-01-02", portfolioReturn: "+120.0%", sp500Return: "+30.0%" },
        holdings: [{ symbol: "AAPL", shares: "10", value: "$3,505.00", weight: "100.0%", gainPercent: "+133.7%" }],
        industries: ["Consumer Electronics: 100.0%"],
        closedPositions: { count: 1, realized: "-$120.00" },
        lastTrade: "2026-01-05",
      },
    });
    // Unknown figures are left out rather than sent as null.
    expect(JSON.stringify(outcome)).not.toContain("null");

    state.databaseDown = true;
    await expect(runChatTool(CHAT_TOOLS, "get_my_portfolio", {}, signedIn)).resolves.toEqual({ ok: false, error: expect.stringMatching(/database didn't respond/) });
  });

  it("lists the favorites with their quotes", async () => {
    state.favorites = [{ symbol: "AAPL", createdAt: "2026-10-01" }, { symbol: "ZZZZ", createdAt: "2026-09-01" }];
    await expect(runChatTool(CHAT_TOOLS, "get_my_favorites", {}, signedIn)).resolves.toEqual({
      ok: true,
      output: {
        favorites: [
          { symbol: "AAPL", name: "Apple Inc.", price: "$350.50", changeToday: "+0.57%", marketCap: "$5.12T" },
          { symbol: "ZZZZ", price: "unavailable" },
        ],
      },
    });
  });
});

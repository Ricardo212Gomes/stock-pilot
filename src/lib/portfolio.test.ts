import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fxFrom, type Currency, type FxRate } from "./fx";
import {
  adjustForSplits,
  buildHistory,
  buildPosition,
  ExchangeRatesUnavailable,
  getPortfolio,
  prepareTrade,
  splitFactorAfter,
  splitsOf,
  type Trade,
  type TradeSide,
} from "./portfolio";
import type { TiingoDay } from "./tiingo";

function day(date: string, close: number, extra: Partial<TiingoDay> = {}): TiingoDay {
  return { date, close, adjClose: close, splitFactor: 1, divCash: 0, ...extra };
}

function trade(id: number, side: TradeSide, shares: number, price: number, date: string, symbol = "AAA", currency: Currency = "USD"): Trade {
  return { id, symbol, side, shares, price, currency, date };
}

// NVIDIA's ten-for-one split on June 10, 2024.
const nvda = [day("2024-06-07", 1208.88, { adjClose: 120.54 }), day("2024-06-10", 121.79, { splitFactor: 10 }), day("2024-06-11", 120.91)];

describe("splits", () => {
  it("multiplies the splits after a date", () => {
    const splits = [{ date: "2020-08-31", factor: 4 }, { date: "2024-06-10", factor: 10 }];
    expect(splitFactorAfter(splits, "2019-01-02")).toBe(40);
    expect(splitFactorAfter(splits, "2024-06-07")).toBe(10);
    // The split's own day already trades in the new shares.
    expect(splitFactorAfter(splits, "2024-06-10")).toBe(1);
    expect(splitsOf(nvda)).toEqual([{ date: "2024-06-10", factor: 10 }]);
  });

  it("puts a trade from before a split in today's shares, unless it was entered that way", () => {
    const splits = splitsOf(nvda);
    expect(adjustForSplits(trade(1, "buy", 10, 1200, "2024-06-07"), nvda, splits)).toEqual({ shares: 100, price: 120, splits });
    // A broker's history after the split shows 100 shares at $120: the price gives it away.
    expect(adjustForSplits(trade(2, "buy", 100, 120, "2024-06-07"), nvda, splits)).toEqual({ shares: 100, price: 120, splits: [] });
    expect(adjustForSplits(trade(3, "buy", 5, 121, "2024-06-11"), nvda, splits)).toEqual({ shares: 5, price: 121, splits: [] });
  });
});

describe("buildPosition", () => {
  const days = [
    day("2026-01-02", 100),
    day("2026-02-02", 120, { divCash: 0.5 }),
    day("2026-03-02", 130, { divCash: 0.5 }),
    day("2026-04-01", 125),
  ];

  it("keeps the average cost and the gain on each sale", () => {
    const position = buildPosition("AAA", [
      trade(3, "sell", 5, 130, "2026-03-02"),
      trade(1, "buy", 10, 100, "2026-01-02"),
      trade(2, "buy", 10, 120, "2026-02-02"),
    ], days, "2026-04-01");
    expect(position.shares).toBe(15);
    expect(position.cost).toBe(1650);
    expect(position.realized).toBe(100);
    expect(position.trades.map((entry) => [entry.id, entry.heldAfter, entry.costAfter, entry.realized])).toEqual([
      [1, 10, 1000, null],
      [2, 20, 2200, null],
      [3, 15, 1650, 100],
    ]);
  });

  it("pays dividends to the shares held the day before the ex-date", () => {
    const position = buildPosition("AAA", [
      trade(1, "buy", 10, 100, "2026-01-02"),
      // Bought on the ex-date: misses that dividend.
      trade(2, "buy", 10, 120, "2026-02-02"),
      // Sold on the next ex-date: still gets it.
      trade(3, "sell", 20, 130, "2026-03-02"),
    ], days, "2026-04-01");
    expect(position.dividends).toBe(10 * 0.5 + 20 * 0.5);
    expect(position.shares).toBe(0);
    expect(position.trailingDividend).toBe(1);
  });

  it("flags a sale of more than was held, counting only what was", () => {
    const position = buildPosition("AAA", [trade(1, "buy", 10, 100, "2026-01-02"), trade(2, "sell", 15, 130, "2026-03-02")], days, "2026-04-01");
    expect(position.trades[1]).toMatchObject({ oversold: true, realized: 300, heldAfter: 0 });
    expect(position.shares).toBe(0);
  });

  it("counts a dividend before a split per share as it was then", () => {
    const split = [day("2024-03-01", 800, { divCash: 1 }), day("2024-06-07", 1200), day("2024-06-10", 121, { splitFactor: 10 })];
    const position = buildPosition("NVDA", [trade(1, "buy", 10, 790, "2024-02-20", "NVDA")], split, "2024-07-01");
    expect(position.shares).toBe(100);
    expect(position.dividends).toBeCloseTo(10);
    expect(position.trailingDividend).toBeCloseTo(0.1);
  });
});

describe("buildHistory", () => {
  const days = [day("2026-11-04", 100), day("2026-11-05", 110), day("2026-11-06", 99)];
  const spy = [day("2026-11-04", 400), day("2026-11-05", 404), day("2026-11-06", 408)];

  it("doesn't count money added as a gain", () => {
    const position = buildPosition("AAA", [trade(1, "buy", 10, 100, "2026-11-04"), trade(2, "buy", 10, 110, "2026-11-05")], days, "2026-11-06");
    const history = buildHistory([position], new Map([["AAA", days]]), spy);
    expect(history.map((point) => [point.date, point.value, point.cost])).toEqual([
      ["2026-11-04", 1000, 1000],
      ["2026-11-05", 2200, 2100],
      ["2026-11-06", 1980, 2100],
    ]);
    // Up 10%, then down 10%: down 1%, whatever was added in between.
    expect(history.map((point) => point.growth)).toEqual([1, 1.1, expect.closeTo(0.99, 10)]);
    expect(history.map((point) => point.benchmark)).toEqual([1, 1.01, 1.02]);
  });

  it("ends at live prices after the last close", () => {
    const position = buildPosition("AAA", [trade(1, "buy", 10, 100, "2026-11-04"), trade(2, "buy", 10, 110, "2026-11-05")], days, "2026-11-09");
    const history = buildHistory([position], new Map([["AAA", days]]), spy, { date: "2026-11-09", prices: new Map([["AAA", 105]]), benchmark: 412 });
    expect(history.at(-1)).toEqual({ date: "2026-11-09", value: 2100, cost: 2100, growth: expect.closeTo(1.05, 10), benchmark: expect.closeTo(1.03, 10) });
  });

  it("counts dividends through the adjusted closes, and carries shares across a split", () => {
    const withDividend = [day("2026-11-04", 100, { adjClose: 99 }), day("2026-11-05", 100)];
    const paid = buildHistory([buildPosition("AAA", [trade(1, "buy", 10, 100, "2026-11-04")], withDividend, "2026-11-05")], new Map([["AAA", withDividend]]), null);
    expect(paid.map((point) => point.value)).toEqual([1000, 1000]);
    expect(paid[1].growth).toBeCloseTo(100 / 99);
    expect(paid[1].benchmark).toBeNull();

    const split = [day("2024-06-07", 1000, { adjClose: 100 }), day("2024-06-10", 100, { splitFactor: 10 })];
    const history = buildHistory([buildPosition("NVDA", [trade(1, "buy", 1, 1000, "2024-06-07", "NVDA")], split, "2024-06-10")], new Map([["NVDA", split]]), null);
    expect(history.map((point) => [point.value, point.growth])).toEqual([[1000, 1], [1000, 1]]);
  });

  it("needs more than one day", () => {
    const position = buildPosition("AAA", [trade(1, "buy", 10, 100, "2026-11-06")], days, "2026-11-06");
    expect(buildHistory([position], new Map([["AAA", days]]), spy)).toEqual([]);
  });
});

// Finnhub, Tiingo and Frankfurter answers, served from one fetch mock; no rates means Frankfurter is down.
type Market = {
  quotes: Record<string, unknown>;
  profiles: Record<string, unknown>;
  prices: Record<string, TiingoDay[]>;
  names: Record<string, string>;
  rates?: FxRate[];
};

function serve(market: Market) {
  return vi.fn(async (input: URL | string) => {
    const url = new URL(String(input));
    const symbol = url.searchParams.get("symbol") ?? "";
    if (url.hostname === "api.frankfurter.dev") {
      if (!market.rates) return new Response("unavailable", { status: 503 });
      return Response.json({ amount: 1, base: "USD", rates: Object.fromEntries(market.rates.map((rate) => [rate.date, { EUR: rate.eurPerUsd }])) });
    }
    if (url.hostname === "finnhub.io") {
      if (url.pathname.endsWith("/quote")) return symbol in market.quotes ? Response.json(market.quotes[symbol]) : new Response("error", { status: 500 });
      return Response.json(market.profiles[symbol] ?? {});
    }
    const [, ticker, prices] = /\/tiingo\/daily\/([^/]+)(\/prices)?$/.exec(url.pathname) ?? [];
    const key = (ticker ?? "").toUpperCase();
    if (prices) {
      const rows = market.prices[key];
      return rows ? Response.json(rows.map((row) => ({ ...row, date: `${row.date}T00:00:00.000Z` }))) : Response.json({ detail: "Not found." }, { status: 404 });
    }
    return market.names[key] ? Response.json({ ticker: key, name: market.names[key] }) : Response.json({ detail: "Not found." }, { status: 404 });
  });
}

// Tuesday, November 10, 2026, at 3 p.m. in New York.
const NOW = new Date("2026-11-10T20:00:00Z");

const MARKET: Market = {
  quotes: {
    AAPL: { c: 110, d: 2, dp: 1.85 },
    VOO: { c: 500, d: -5, dp: -0.99 },
    SPY: { c: 612 },
  },
  profiles: { AAPL: { name: "Apple Inc", finnhubIndustry: "Technology" } },
  prices: {
    AAPL: [day("2026-11-05", 100), day("2026-11-06", 104, { divCash: 0.26 }), day("2026-11-09", 108)],
    VOO: [day("2026-11-05", 480), day("2026-11-06", 490), day("2026-11-09", 505)],
    SPY: [day("2026-11-05", 600), day("2026-11-06", 603), day("2026-11-09", 606)],
  },
  names: { VOO: "Vanguard S&P 500 ETF" },
};

describe("getPortfolio", () => {
  beforeEach(() => {
    vi.stubEnv("FINNHUB_API_KEY", "finnhub-key");
    vi.stubEnv("TIINGO_API_KEY", "tiingo-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const trades = [
    trade(1, "buy", 10, 100, "2026-11-05", "AAPL"),
    trade(2, "buy", 2, 480, "2026-11-05", "VOO"),
    trade(3, "sell", 5, 108, "2026-11-09", "AAPL"),
  ];

  it("values the holdings at live prices, with their weights, industries and history", async () => {
    vi.stubGlobal("fetch", serve(MARKET));
    const view = await getPortfolio(trades, NOW);
    expect(view.today).toBe("2026-11-10");
    expect(view.holdings.map((holding) => [holding.symbol, holding.name, holding.industry, holding.shares, holding.value, holding.priceSource])).toEqual([
      ["VOO", "Vanguard S&P 500 ETF", "Funds", 2, 1000, "live"],
      ["AAPL", "Apple Inc", "Technology", 5, 550, "live"],
    ]);
    expect(view.holdings[1]).toMatchObject({ averageCost: 100, gain: 50, gainPercent: 0.1, realized: 40, dayChange: 10, dividends: 2.6 });
    expect(view.holdings.reduce((total, holding) => total + holding.weight, 0)).toBeCloseTo(1);
    expect(view.totals).toMatchObject({ value: 1550, cost: 1460, gain: 90, dayChange: 0, realized: 40, stalePrices: 0 });
    expect(view.totals.annualIncome).toBeCloseTo(5 * 0.26);
    expect(view.industries.map((industry) => industry.name)).toEqual(["Funds", "Technology"]);
    expect(view.trades.map((entry) => [entry.id, entry.name])).toEqual([[3, "Apple Inc"], [2, "Vanguard S&P 500 ETF"], [1, "Apple Inc"]]);
    expect(view.history.map((point) => point.date)).toEqual(["2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10"]);
    expect(view.history.at(-1)).toMatchObject({ value: 1550, cost: 1460 });
    expect(view.historyIssue).toBeNull();
  });

  it("falls back to the last close when a quote fails", async () => {
    const { AAPL: _apple, ...quotes } = MARKET.quotes;
    void _apple;
    vi.stubGlobal("fetch", serve({ ...MARKET, quotes }));
    const view = await getPortfolio(trades, NOW);
    expect(view.holdings.find((holding) => holding.symbol === "AAPL")).toMatchObject({ price: 108, priceSource: "close", dayChange: null });
    expect(view.totals).toMatchObject({ stalePrices: 1, dayChange: -10 });
  });

  it("explains a missing chart", async () => {
    vi.stubGlobal("fetch", serve({ ...MARKET, prices: { AAPL: MARKET.prices.AAPL, SPY: MARKET.prices.SPY } }));
    expect((await getPortfolio(trades, NOW)).historyIssue).toEqual({ kind: "missing", symbols: ["VOO"] });

    vi.stubEnv("TIINGO_API_KEY", "");
    const view = await getPortfolio(trades, NOW);
    expect(view.historyIssue).toEqual({ kind: "no-tiingo" });
    expect(view.totals.annualIncome).toBeNull();
    expect(view.holdings.map((holding) => holding.value)).toEqual([1000, 550]);
  });

  it("lists positions sold off as closed", async () => {
    vi.stubGlobal("fetch", serve(MARKET));
    const view = await getPortfolio([trade(1, "buy", 10, 100, "2026-11-05", "AAPL"), trade(2, "sell", 10, 108, "2026-11-09", "AAPL")], NOW);
    expect(view.holdings).toEqual([]);
    expect(view.closed).toEqual([{ symbol: "AAPL", label: "AAPL", name: "Apple Inc", priced: true, realized: 80, dividends: 2.6, soldOn: "2026-11-09" }]);
  });
});

describe("prepareTrade", () => {
  beforeEach(() => {
    vi.stubEnv("FINNHUB_API_KEY", "finnhub-key");
    vi.stubEnv("TIINGO_API_KEY", "tiingo-key");
    vi.stubGlobal("fetch", serve(MARKET));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fills an empty price with that day's close, or the live price today", async () => {
    // Sunday: Friday's close.
    await expect(prepareTrade({ symbol: "AAPL", side: "buy", shares: 3, price: null, currency: "USD", date: "2026-11-08" }, [], NOW)).resolves.toEqual({
      ok: true,
      trade: { symbol: "AAPL", side: "buy", shares: 3, price: 104, currency: "USD", date: "2026-11-08" },
    });
    await expect(prepareTrade({ symbol: "AAPL", side: "buy", shares: 3, price: null, currency: "USD", date: "2026-11-10" }, [], NOW)).resolves.toMatchObject({ ok: true, trade: { price: 110 } });
    await expect(prepareTrade({ symbol: "AAPL", side: "buy", shares: 3, price: null, currency: "USD", date: "2025-01-02" }, [], NOW)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/no close/) });
  });

  it("refuses a sale of shares that weren't held, then or later", async () => {
    const held = [trade(1, "buy", 10, 100, "2026-11-05", "AAPL"), trade(2, "sell", 8, 108, "2026-11-09", "AAPL")];
    await expect(prepareTrade({ symbol: "AAPL", side: "sell", currency: "USD", shares: 5, price: 109, date: "2026-11-10" }, held, NOW)).resolves.toEqual({
      ok: false,
      error: "You held 2 AAPL shares then, so you can't sell 5.",
    });
    await expect(prepareTrade({ symbol: "AAPL", side: "sell", currency: "USD", shares: 1, price: 99, date: "2026-11-04" }, held, NOW)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/didn't hold any/) });
    await expect(prepareTrade({ symbol: "AAPL", side: "sell", currency: "USD", shares: 5, price: 104, date: "2026-11-06" }, held, NOW)).resolves.toEqual({
      ok: false,
      error: "That would leave too few AAPL shares for your sale on Nov 9, 2026.",
    });
    await expect(prepareTrade({ symbol: "AAPL", side: "sell", currency: "USD", shares: 2, price: 109, date: "2026-11-10" }, held, NOW)).resolves.toMatchObject({ ok: true });
  });

  it("refuses a ticker nobody has prices for", async () => {
    // Finnhub refuses a ticker it doesn't know, or answers with a zero price.
    const refusing = serve(MARKET);
    vi.stubGlobal("fetch", vi.fn(async (input: URL | string) => (String(input).includes("finnhub.io") ? Response.json({ error: "You don't have access to this resource." }, { status: 403 }) : refusing(input))));
    await expect(prepareTrade({ symbol: "ZZZZQ", side: "buy", shares: 1, price: 5, currency: "USD", date: "2026-11-09" }, [], NOW)).resolves.toEqual({
      ok: false,
      error: "StockPilot has no prices for ZZZZQ. Check the ticker.",
    });
    vi.stubGlobal("fetch", serve({ ...MARKET, quotes: { ...MARKET.quotes, ZZZZQ: { c: 0, d: null, dp: null } } }));
    await expect(prepareTrade({ symbol: "ZZZZQ", side: "buy", shares: 1, price: 5, currency: "USD", date: "2026-11-09" }, [], NOW)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/Check the ticker/) });
    // Finnhub down and no Tiingo prices: it can't tell.
    vi.stubGlobal("fetch", serve({ ...MARKET, quotes: {} }));
    await expect(prepareTrade({ symbol: "ZZZZQ", side: "buy", shares: 1, price: 5, currency: "USD", date: "2026-11-09" }, [], NOW)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/couldn't be checked/) });
  });
});

// The ECB's rate on each business day: a dollar buys a little more euro each time.
const RATES: FxRate[] = [
  { date: "2026-11-05", eurPerUsd: 0.86 },
  { date: "2026-11-06", eurPerUsd: 0.87 },
  { date: "2026-11-09", eurPerUsd: 0.88 },
];

describe("in euros", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("converts each trade and dividend at its own day's rate, and keeps a trade made in euros as it was", () => {
    const days = [day("2026-01-02", 100), day("2026-02-02", 120, { divCash: 0.5 }), day("2026-03-02", 130, { divCash: 0.5 })];
    const fx = fxFrom([{ date: "2026-01-02", eurPerUsd: 0.9 }, { date: "2026-02-02", eurPerUsd: 0.92 }, { date: "2026-03-02", eurPerUsd: 0.95 }]);
    const position = buildPosition("AAA", [trade(1, "buy", 10, 100, "2026-01-02"), trade(2, "buy", 10, 108, "2026-02-02", "AAA", "EUR")], days, "2026-03-31", "EUR", fx);
    expect(position.trades.map((entry) => entry.adjustedPrice)).toEqual([90, 108]);
    expect(position.cost).toBeCloseTo(900 + 1080);
    // $0.50 to 10 shares at 0.92, then to 20 at 0.95.
    expect(position.dividends).toBeCloseTo(10 * 0.5 * 0.92 + 20 * 0.5 * 0.95);
    expect(position.trailingDividend).toBeCloseTo(0.5 * 0.92 + 0.5 * 0.95);
  });

  it("tells a split in a trade made in euros from the dollar close, and needs no rates without one", () => {
    const splits = splitsOf(nvda);
    const fx = fxFrom([{ date: "2024-06-07", eurPerUsd: 0.92 }]);
    // €1,112 was $1,208.70 that day: the shares as traded, before the split.
    const before = adjustForSplits(trade(1, "buy", 10, 1112, "2024-06-07", "NVDA", "EUR"), nvda, splits, (price) => fx.convert(price, "EUR", "USD", "2024-06-07"));
    expect(before).toEqual({ shares: 100, price: expect.closeTo(111.2, 10), splits });
    const position = buildPosition("AAA", [trade(1, "buy", 10, 90, "2026-01-02", "AAA", "EUR"), trade(2, "sell", 4, 99, "2026-02-02", "AAA", "EUR")], null, "2026-03-31", "EUR");
    expect(position).toMatchObject({ shares: 6, cost: 540, realized: 36 });
  });

  it("measures growth in euros, the dollar's moves included, for the S&P 500 too", () => {
    const days = [day("2026-11-04", 100), day("2026-11-05", 110), day("2026-11-06", 99)];
    const spy = [day("2026-11-04", 400), day("2026-11-05", 404), day("2026-11-06", 408)];
    const fx = fxFrom([{ date: "2026-11-04", eurPerUsd: 0.9 }, { date: "2026-11-06", eurPerUsd: 1 }]);
    const position = buildPosition("AAA", [trade(1, "buy", 10, 100, "2026-11-04")], days, "2026-11-06", "EUR", fx);
    const history = buildHistory([position], new Map([["AAA", days]]), spy, undefined, "EUR", fx);
    expect(history.map((point) => [point.value, point.cost])).toEqual([[900, 900], [990, 900], [990, 900]]);
    // The stock fell 10% on the last day, and the dollar rose 11%.
    expect(history.map((point) => point.growth)).toEqual([1, expect.closeTo(1.1, 10), expect.closeTo(1.1, 10)]);
    expect(history.map((point) => point.benchmark)).toEqual([1, expect.closeTo(1.01, 10), expect.closeTo(408 / 360, 10)]);
  });

  it("shows the portfolio in euros at today's rate", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "finnhub-key");
    vi.stubEnv("TIINGO_API_KEY", "tiingo-key");
    vi.stubGlobal("fetch", serve({ ...MARKET, rates: RATES }));
    const trades = [trade(1, "buy", 10, 100, "2026-11-05", "AAPL"), trade(2, "buy", 2, 420, "2026-11-05", "VOO", "EUR"), trade(3, "sell", 5, 108, "2026-11-09", "AAPL")];
    const view = await getPortfolio(trades, NOW, "EUR");
    expect(view.currency).toBe("EUR");
    const apple = view.holdings.find((holding) => holding.symbol === "AAPL")!;
    // Live, $110 at Monday's 0.88 (the latest rate); bought at $100 when a dollar was 0.86.
    expect(apple.price).toBeCloseTo(96.8);
    expect(apple.averageCost).toBeCloseTo(86);
    expect(apple.realized).toBeCloseTo(5 * (108 * 0.88 - 86));
    expect(apple.dayChange).toBeCloseTo(5 * 2 * 0.88);
    expect(apple.dividends).toBeCloseTo(10 * 0.26 * 0.87);
    // Bought in euros: the cost is what was paid.
    expect(view.holdings.find((holding) => holding.symbol === "VOO")).toMatchObject({ cost: 840, value: expect.closeTo(2 * 500 * 0.88, 10) });
    expect(view.history.at(-1)?.value).toBeCloseTo(5 * 96.8 + 2 * 440);
  });

  it("needs the rates for euros, and only then", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "finnhub-key");
    vi.stubEnv("TIINGO_API_KEY", "tiingo-key");
    const fetchMock = serve(MARKET);
    vi.stubGlobal("fetch", fetchMock);
    const dollars = [trade(1, "buy", 10, 100, "2026-11-05", "AAPL")];
    await getPortfolio(dollars, NOW);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("frankfurter"))).toBe(false);
    await expect(getPortfolio(dollars, NOW, "EUR")).rejects.toBeInstanceOf(ExchangeRatesUnavailable);
    // A trade paid in euros needs them even for a portfolio in dollars.
    await expect(getPortfolio([...dollars, trade(2, "buy", 1, 95, "2026-11-06", "AAPL", "EUR")], NOW)).rejects.toBeInstanceOf(ExchangeRatesUnavailable);
  });

  it("fills an empty price in euros at that day's rate", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "finnhub-key");
    vi.stubEnv("TIINGO_API_KEY", "tiingo-key");
    vi.stubGlobal("fetch", serve({ ...MARKET, rates: RATES }));
    // Sunday: Friday's $104 close at Friday's rate.
    const sunday = await prepareTrade({ symbol: "AAPL", side: "buy", shares: 3, price: null, currency: "EUR", date: "2026-11-08" }, [], NOW);
    expect(sunday).toMatchObject({ ok: true, trade: { currency: "EUR", price: expect.closeTo(104 * 0.87, 10) } });
    const today = await prepareTrade({ symbol: "AAPL", side: "buy", shares: 3, price: null, currency: "EUR", date: "2026-11-10" }, [], NOW);
    expect(today).toMatchObject({ ok: true, trade: { price: expect.closeTo(110 * 0.88, 10) } });

    vi.stubGlobal("fetch", serve(MARKET));
    await expect(prepareTrade({ symbol: "AAPL", side: "buy", shares: 3, price: 90, currency: "EUR", date: "2026-11-09" }, [], NOW)).resolves.toEqual({
      ok: false,
      error: "The euro exchange rates couldn't be loaded just now. Try again in a minute.",
    });
  });
});

describe("imported statements", () => {
  beforeEach(() => {
    vi.stubEnv("FINNHUB_API_KEY", "finnhub-key");
    vi.stubEnv("TIINGO_API_KEY", "tiingo-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // A fund sold off before it was imported: kept under its ISIN, without prices.
  const FUND = "IE00BK5BQT80";
  const unpriced = (id: number, side: TradeSide, shares: number, price: number, date: string, currency: Currency = "USD"): Trade => ({
    ...trade(id, side, shares, price, date, FUND, currency),
    imported: true,
    priced: false,
    label: "VWCE",
    name: null,
  });

  it("counts every gain, dividend and interest payment in the profit, asking prices only for what has them", async () => {
    const fetchMock = serve(MARKET);
    vi.stubGlobal("fetch", fetchMock);
    const trades = [{ ...trade(1, "buy", 10, 100, "2026-11-05", "AAPL"), imported: true }, unpriced(2, "buy", 2, 100, "2026-11-05"), unpriced(3, "sell", 2, 110, "2026-11-06")];
    const view = await getPortfolio(trades, NOW, "USD", [
      // What the statement paid, after tax, rather than Tiingo's $0.26 a share.
      { kind: "dividend", symbol: "AAPL", amount: 1.5, currency: "USD", date: "2026-11-07" },
      { kind: "interest", symbol: null, amount: 0.4, currency: "USD", date: "2026-11-08" },
    ]);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes(FUND))).toBe(false);
    expect(view.holdings.map((holding) => [holding.symbol, holding.value, holding.gain, holding.dividends])).toEqual([["AAPL", 1100, 100, 1.5]]);
    expect(view.closed).toEqual([{ symbol: FUND, label: "VWCE", name: FUND, priced: false, realized: 20, dividends: 0, soldOn: "2026-11-06" }]);
    expect(view.totals).toMatchObject({ gain: 100, realized: 20, dividends: 1.5, interest: 0.4, profit: expect.closeTo(121.9, 10) });
    expect(view.income).toEqual([{ month: "2026-11", dividends: 1.5, interest: 0.4 }]);
    expect(view.trades.find((entry) => entry.symbol === FUND)).toMatchObject({ label: "VWCE", name: FUND, priced: false });
    // The chart follows Apple alone.
    expect(view.unpriced).toBe(1);
    expect(view.history.at(-1)?.value).toBe(1100);
  });

  it("works out a portfolio with nothing priced without a single request", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("no requests expected");
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = await getPortfolio([unpriced(1, "buy", 2, 130, "2026-11-05", "EUR")], NOW, "EUR", [{ kind: "interest", symbol: null, amount: 0.05, currency: "EUR", date: "2026-11-06" }]);
    expect(fetchMock).not.toHaveBeenCalled();
    // Held without prices: at its last trade's price.
    expect(view.holdings).toEqual([expect.objectContaining({ label: "VWCE", priced: false, price: 130, priceSource: "trade", value: 260, industry: "Other" })]);
    expect(view.historyIssue).toEqual({ kind: "nothing-priced" });
    expect(view.totals).toMatchObject({ profit: 0.05, interest: 0.05 });
  });
});

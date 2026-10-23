import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { annualDividend, getStockOverview, nextEarningsDate, trailingTwelveMonths } from "./stock-overview";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const quarters = [
  { date: "2026-06-27", revenue: 109, netIncome: 29.8, epsDiluted: 2.03 },
  { date: "2026-03-28", revenue: 111, netIncome: 29.6, epsDiluted: 2.01 },
  { date: "2025-12-27", revenue: 144, netIncome: 42.1, epsDiluted: 2.84 },
  { date: "2025-09-27", revenue: 102, netIncome: 27.5, epsDiluted: 1.85 },
  { date: "2025-06-28", revenue: 94, netIncome: 23.4, epsDiluted: 1.57 },
];

const fmpRoutes: Record<string, unknown> = {
  quote: [{
    symbol: "AAPL", name: "Apple Inc.", price: 346.34, change: -1.88, changePercentage: -0.54, volume: 25709038,
    dayLow: 345.75, dayHigh: 351.73, yearLow: 243.42, yearHigh: 351.73, marketCap: 5.05e12, exchange: "NASDAQ",
    open: 349.12, previousClose: 348.22, timestamp: 1792780211,
  }],
  profile: [{ symbol: "AAPL", companyName: "Apple Inc.", beta: 1.07, currency: "USD", sector: "Technology", exchange: "NASDAQ" }],
  "income-statement": quarters,
  "shares-float": [{ outstandingShares: 14.59e9 }],
  "price-target-consensus": [{ targetConsensus: 329.38 }],
  "grades-consensus": [{ strongBuy: 1, buy: 69, hold: 33, sell: 9, strongSell: 0, consensus: "Buy" }],
  dividends: [
    { date: "2026-05-11", dividend: 0.27, frequency: "Quarterly" },
    { date: "2026-08-10", dividend: 0.27, frequency: "Quarterly" },
  ],
  earnings: [
    { date: "2027-01-28", epsActual: null },
    { date: "2026-11-02", epsActual: null },
    { date: "2026-07-30", epsActual: 2.02 },
  ],
  "analyst-estimates": [
    { date: "2026-09-27", epsAvg: 8.5 },
    { date: "2027-09-27", epsAvg: 9.18 },
  ],
};

function mockServices(overrides: Record<string, unknown | (() => Response)> = {}, finnhub: () => Response = () =>
  json({ metric: { revenueGrowthTTMYoy: 14.24, epsGrowthTTMYoy: 32.61 } })) {
  const routes = { ...fmpRoutes, ...overrides };
  const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
    void init;
    const url = new URL(input);
    if (url.hostname === "finnhub.io") return finnhub();
    const route = routes[url.pathname.replace("/stable/", "")];
    if (route === undefined) return json({ "Error Message": "not mocked" }, 404);
    return typeof route === "function" ? (route as () => Response)() : json(route);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const TODAY = new Date("2026-10-23T18:00:00Z");

beforeEach(() => {
  vi.stubEnv("FMP_API_KEY", "fmp-key");
  vi.stubEnv("FINNHUB_API_KEY", "finnhub-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("trailingTwelveMonths", () => {
  it("sums the four most recent quarters, in any order", () => {
    const ttm = trailingTwelveMonths([...quarters].reverse());
    expect(ttm.revenue).toBeCloseTo(466);
    expect(ttm.netIncome).toBeCloseTo(129);
    expect(ttm.eps).toBeCloseTo(8.73);
  });

  it("needs four quarters with values", () => {
    expect(trailingTwelveMonths(quarters.slice(0, 3)).revenue).toBeNull();
    expect(trailingTwelveMonths([{ ...quarters[0], revenue: null }, ...quarters.slice(1, 4)]).revenue).toBeNull();
  });

  it("falls back to basic EPS", () => {
    const basic = quarters.slice(0, 4).map(({ epsDiluted, ...row }) => ({ ...row, eps: epsDiluted }));
    expect(trailingTwelveMonths(basic).eps).toBeCloseTo(8.73);
  });
});

describe("annualDividend", () => {
  it("annualizes the latest payment by its frequency", () => {
    expect(annualDividend(fmpRoutes.dividends as Record<string, unknown>[])).toEqual({ perShare: 1.08, exDate: "2026-08-10" });
    expect(annualDividend([{ date: "2026-09-01", dividend: 0.1, frequency: "Monthly" }]).perShare).toBeCloseTo(1.2);
  });

  it("keeps the ex-date but no annual figure for irregular payments", () => {
    expect(annualDividend([{ date: "2026-09-01", dividend: 2, frequency: "Special" }])).toEqual({ perShare: null, exDate: "2026-09-01" });
    expect(annualDividend([])).toEqual({ perShare: null, exDate: null });
  });
});

describe("nextEarningsDate", () => {
  it("picks the earliest upcoming report without results", () => {
    expect(nextEarningsDate(fmpRoutes.earnings as Record<string, unknown>[], "2026-10-23")).toBe("2026-11-02");
    expect(nextEarningsDate([{ date: "2026-07-30", epsActual: 2.02 }], "2026-10-23")).toBeNull();
  });
});

describe("getStockOverview", () => {
  it("combines the quote, TTM figures, analyst data and Finnhub growth", async () => {
    const fetchMock = mockServices();
    const result = await getStockOverview("AAPL", TODAY);
    if (!result.ok) throw new Error(result.reason);

    expect(result.data).toMatchObject({
      name: "Apple Inc.",
      exchange: "NASDAQ",
      price: 346.34,
      change: -1.88,
      changePercent: -0.0054,
      revenueTtm: 466,
      revenueGrowth: 0.1424,
      epsGrowth: 0.3261,
      sharesOutstanding: 14.59e9,
      dividendPerShare: 1.08,
      exDividendDate: "2026-08-10",
      beta: 1.07,
      analystConsensus: "Buy",
      analystCount: 112,
      priceTarget: 329.38,
      earningsDate: "2026-11-02",
    });
    expect(result.data.peRatio).toBeCloseTo(346.34 / 8.73);
    expect(result.data.forwardPe).toBeCloseTo(346.34 / 9.18);
    expect(result.data.dividendYield).toBeCloseTo(1.08 / 346.34);
    expect(result.data.priceTargetUpside).toBeCloseTo(329.38 / 346.34 - 1);

    const quoteCall = fetchMock.mock.calls.find(([input]) => new URL(input).pathname.endsWith("/quote"));
    expect((quoteCall?.[1] as { next?: { revalidate?: number } }).next?.revalidate).toBe(60);
  });

  it("blanks optional figures that fail instead of failing the page", async () => {
    const restricted = () => json({ "Error Message": "Restricted" }, 402);
    mockServices(
      { "income-statement": restricted, "grades-consensus": restricted, dividends: restricted, profile: restricted },
      () => json({}, 429),
    );
    const result = await getStockOverview("AAPL", TODAY);
    if (!result.ok) throw new Error(result.reason);

    expect(result.data).toMatchObject({
      revenueTtm: null, epsTtm: null, peRatio: null, revenueGrowth: null,
      analystConsensus: null, dividendPerShare: null, beta: null, profile: null, price: 346.34,
    });
  });

  it("uses Finnhub's share-class format", async () => {
    const fetchMock = mockServices();
    await getStockOverview("BRK-B", TODAY);
    const finnhubCall = fetchMock.mock.calls.find(([input]) => new URL(input).hostname === "finnhub.io");
    expect(new URL(finnhubCall![0]).searchParams.get("symbol")).toBe("BRK.B");
  });

  it("fails when the quote fails or has no price", async () => {
    mockServices({ quote: () => json({ "Error Message": "Limit Reach" }, 429) });
    await expect(getStockOverview("AAPL", TODAY)).resolves.toEqual({ ok: false, reason: "rate-limited" });

    mockServices({ quote: [] });
    await expect(getStockOverview("ZZZZ", TODAY)).resolves.toEqual({ ok: false, reason: "no-data" });

    vi.stubEnv("FMP_API_KEY", "");
    await expect(getStockOverview("AAPL", TODAY)).resolves.toEqual({ ok: false, reason: "not-configured" });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCompanyFundamentals,
  getCompanyProfile,
  getFinancialChartExtras,
  getRiskFreeRate,
  fetchFmp,
  getStockPriceHistory,
  normalizeTicker,
  rememberedRestrictions,
} from "./fmp";
import { providerEvents } from "./provider-status";

type Routes = Record<string, unknown | ((url: URL) => Response)>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

// Routes requests by the last path segment of the FMP URL, e.g. "income-statement".
function mockFmp(routes: Routes) {
  const fetchMock = vi.fn(async (input: URL | string) => {
    const url = new URL(input);
    const endpoint = url.pathname.replace("/stable/", "");
    const route = routes[endpoint];
    if (route === undefined) return json({ "Error Message": "not mocked" }, 404);
    return typeof route === "function" ? route(url) : json(route);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function statusForAll(status: number) {
  return vi.fn(async () => json({ "Error Message": "failure" }, status));
}

const income = [
  { date: "2024-09-28", fiscalYear: "2024", period: "FY", reportedCurrency: "USD", revenue: 120, grossProfit: 60, operatingIncome: 30, netIncome: 24, eps: 1.5 },
  { date: "2023-09-30", fiscalYear: "2023", period: "FY", reportedCurrency: "USD", revenue: 100, grossProfit: 45, operatingIncome: 20, netIncome: 15, eps: 1 },
];

const balance = [
  { date: "2024-09-28", totalDebt: 50, cashAndShortTermInvestments: 20, totalStockholdersEquity: 100, totalCurrentAssets: 80, totalCurrentLiabilities: 40 },
  { date: "2023-09-30", totalDebt: 40, cashAndCashEquivalents: 10, netDebt: 25, totalStockholdersEquity: 80 },
];

const cashFlow = [
  { date: "2024-09-28", operatingCashFlow: 40, capitalExpenditure: -10 },
  { date: "2023-09-30", operatingCashFlow: 30, capitalExpenditure: -5, freeCashFlow: 26 },
];

const ratios = [
  { date: "2024-09-28", grossProfitMargin: 0.55, dividendYieldPercentage: 2.5, priceToEarningsRatio: 30 },
  { date: "2023-09-30", dividendYield: 0.01 },
];

const statementRoutes = {
  "income-statement": income,
  "balance-sheet-statement": balance,
  "cash-flow-statement": cashFlow,
  ratios,
};

beforeEach(() => {
  vi.stubEnv("FMP_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("normalizeTicker", () => {
  it("uppercases and trims valid tickers", () => {
    expect(normalizeTicker(" aapl ")).toBe("AAPL");
    expect(normalizeTicker("brk.b")).toBe("BRK.B");
    expect(normalizeTicker("RDS-A")).toBe("RDS-A");
  });

  it("rejects non-strings, invalid characters and bad lengths", () => {
    expect(normalizeTicker(undefined)).toBeNull();
    expect(normalizeTicker(42)).toBeNull();
    expect(normalizeTicker("")).toBeNull();
    expect(normalizeTicker("AA PL")).toBeNull();
    expect(normalizeTicker("<script>")).toBeNull();
    expect(normalizeTicker("A".repeat(16))).toBeNull();
  });

  it("requires at least one letter or digit", () => {
    expect(normalizeTicker("...")).toBeNull();
    expect(normalizeTicker("-")).toBeNull();
  });
});

describe("getCompanyFundamentals", () => {
  it("reports not-configured without calling FMP when the key is missing", async () => {
    vi.stubEnv("FMP_API_KEY", "");
    const fetchMock = mockFmp(statementRoutes);

    await expect(getCompanyFundamentals("AAPL")).resolves.toEqual({ ok: false, reason: "not-configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests annual statements with caching instead of no-store", async () => {
    const fetchMock = mockFmp(statementRoutes);

    await getCompanyFundamentals("AAPL");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [input, init] of fetchMock.mock.calls as unknown as [URL, RequestInit & { next?: { revalidate?: number } }][]) {
      const url = new URL(input);
      expect(url.searchParams.get("symbol")).toBe("AAPL");
      expect(url.searchParams.get("period")).toBe("annual");
      expect(url.searchParams.get("limit")).toBe("5");
      expect(url.searchParams.get("apikey")).toBe("test-key");
      expect(init.next?.revalidate).toBe(60 * 60 * 24);
      expect(init.cache).toBeUndefined();
    }
  });

  it.each([
    [429, "rate-limited"],
    [401, "invalid-key"],
    [402, "plan-restricted"],
    [403, "plan-restricted"],
    [500, "provider-error"],
  ])("maps HTTP %i to %s", async (status, reason) => {
    vi.stubGlobal("fetch", statusForAll(status));

    await expect(getCompanyFundamentals("AAPL")).resolves.toEqual({ ok: false, reason });
  });

  it("fails the whole result when any required statement fails", async () => {
    mockFmp({ ...statementRoutes, ratios: () => json({ "Error Message": "Limit Reach" }, 429) });

    await expect(getCompanyFundamentals("AAPL")).resolves.toEqual({ ok: false, reason: "rate-limited" });
  });

  it("treats network failures and unexpected payloads as provider errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(getCompanyFundamentals("AAPL")).resolves.toEqual({ ok: false, reason: "provider-error" });

    mockFmp({ ...statementRoutes, "income-statement": { "Error Message": "oops" } });
    await expect(getCompanyFundamentals("AAPL")).resolves.toEqual({ ok: false, reason: "provider-error" });
  });

  it("reports no-data when no income statement has usable figures", async () => {
    mockFmp({ ...statementRoutes, "income-statement": [{ date: "2024-09-28", revenue: null, netIncome: null }] });

    await expect(getCompanyFundamentals("AAPL")).resolves.toEqual({ ok: false, reason: "no-data" });
  });

  it("joins statements by date, newest first, with derived metrics and fallbacks", async () => {
    mockFmp({ ...statementRoutes, "income-statement": [...income].reverse() });

    const result = await getCompanyFundamentals("AAPL");
    if (!result.ok) throw new Error(`expected success, got ${result.reason}`);

    const [latest, previous] = result.data.annualFinancials;
    expect(result.data.symbol).toBe("AAPL");
    expect(latest.fiscalYear).toBe("2024");
    expect(previous.fiscalYear).toBe("2023");

    expect(latest.revenueGrowth).toBeCloseTo(0.2);
    expect(previous.revenueGrowth).toBeNull();

    // Ratio value wins over the statement-derived one; missing ratios fall back to statements.
    expect(latest.grossMargin).toBe(0.55);
    expect(latest.operatingMargin).toBeCloseTo(0.25);
    expect(latest.netMargin).toBeCloseTo(0.2);

    expect(latest.cash).toBe(20);
    expect(previous.cash).toBe(10);
    expect(latest.netDebt).toBe(30);
    expect(previous.netDebt).toBe(25);
    expect(latest.currentRatio).toBe(2);
    expect(latest.debtToEquity).toBeCloseTo(0.5);

    expect(latest.freeCashFlow).toBe(30);
    expect(previous.freeCashFlow).toBe(26);

    expect(latest.dividendYield).toBeCloseTo(0.025);
    expect(previous.dividendYield).toBe(0.01);
    expect(latest.peRatio).toBe(30);
    expect(latest.psRatio).toBeNull();
  });

  it("defaults invalid currencies to USD", async () => {
    mockFmp({
      ...statementRoutes,
      "income-statement": [{ ...income[0], reportedCurrency: "dollars" }],
    });

    const result = await getCompanyFundamentals("AAPL");
    expect(result.ok && result.data.annualFinancials[0].currency).toBe("USD");
  });
});

describe("getStockPriceHistory", () => {
  it("returns valid closes sorted oldest first, cached for 6 hours", async () => {
    const fetchMock = mockFmp({
      "historical-price-eod/full": [
        { date: "2024-01-03", close: 12 },
        { date: "2024-01-01", close: 10 },
        { date: "2024-01-02", close: "11" },
        { close: 9 },
        null,
      ],
    });

    await expect(getStockPriceHistory("AAPL")).resolves.toEqual({
      ok: true,
      data: [
        { date: "2024-01-01", close: 10 },
        { date: "2024-01-03", close: 12 },
      ],
      source: "fmp",
    });

    const [input, init] = fetchMock.mock.calls[0] as unknown as [URL, { next?: { revalidate?: number } }];
    expect(new URL(input).searchParams.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(init.next?.revalidate).toBe(60 * 60 * 6);
  });

  it("reports no-data, not-configured and HTTP failures when Tiingo can't stand in", async () => {
    vi.stubEnv("TIINGO_API_KEY", "");
    mockFmp({ "historical-price-eod/full": [] });
    await expect(getStockPriceHistory("AAPL")).resolves.toEqual({ ok: false, reason: "no-data" });

    vi.stubGlobal("fetch", statusForAll(429));
    await expect(getStockPriceHistory("AAPL")).resolves.toEqual({ ok: false, reason: "rate-limited" });

    vi.stubEnv("FMP_API_KEY", "");
    await expect(getStockPriceHistory("AAPL")).resolves.toEqual({ ok: false, reason: "not-configured" });
  });

  it("falls back to Tiingo when FMP's plan doesn't cover the company", async () => {
    vi.stubEnv("TIINGO_API_KEY", "tiingo-key");
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      if (url.hostname === "api.tiingo.com") {
        return json([
          { date: "2024-01-02T00:00:00.000Z", close: 220, adjClose: 110 },
          { date: "2024-01-01T00:00:00.000Z", close: 200, adjClose: 100 },
        ]);
      }
      return new Response("Premium Query Parameter", { status: 402 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getStockPriceHistory("MU")).resolves.toEqual({
      ok: true,
      data: [
        { date: "2024-01-01", close: 100 },
        { date: "2024-01-02", close: 110 },
      ],
      source: "tiingo",
    });
    // An invalid FMP key is a setup problem to report, not a gap to fill.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Invalid API KEY", { status: 401 })));
    await expect(getStockPriceHistory("AVGO")).resolves.toEqual({ ok: false, reason: "invalid-key" });
  });
});

describe("getFinancialChartExtras", () => {
  const empty = { productSegments: [], geographicSegments: [], nextYearEps: null, nextYearDate: null };

  it("returns empty extras without a key", async () => {
    vi.stubEnv("FMP_API_KEY", "");
    const fetchMock = mockFmp({});

    await expect(getFinancialChartExtras("AAPL")).resolves.toEqual(empty);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes segments and picks the nearest future EPS estimate", async () => {
    mockFmp({
      "revenue-product-segmentation": [
        { fiscalYear: 2024, data: { iPhone: 200, Mac: 30, Note: "n/a" } },
        { fiscalYear: 2023, data: { iPhone: 190 } },
        { fiscalYear: 2022, data: {} },
      ],
      "revenue-geographic-segmentation": [{ date: "2024-09-28", data: { Americas: 160 } }],
      "analyst-estimates": [
        { date: "2000-09-30", epsAvg: 1 },
        { date: "2999-09-30", epsAvg: 9 },
        { date: "2998-09-30", epsAvg: 8 },
        { date: "2997-09-30", epsAvg: null },
      ],
    });

    await expect(getFinancialChartExtras("AAPL")).resolves.toEqual({
      productSegments: [
        { fiscalYear: "2023", segments: [{ name: "iPhone", revenue: 190 }] },
        { fiscalYear: "2024", segments: [{ name: "iPhone", revenue: 200 }, { name: "Mac", revenue: 30 }] },
      ],
      geographicSegments: [{ fiscalYear: "2024", segments: [{ name: "Americas", revenue: 160 }] }],
      nextYearEps: 8,
      nextYearDate: "2998-09-30",
    });
  });

  it("lets each optional endpoint fail on its own", async () => {
    mockFmp({
      "revenue-product-segmentation": () => json({ "Error Message": "Premium" }, 403),
      "revenue-geographic-segmentation": [{ fiscalYear: 2024, data: { Europe: 50 } }],
      "analyst-estimates": () => { throw new TypeError("fetch failed"); },
    });

    await expect(getFinancialChartExtras("AAPL")).resolves.toEqual({
      ...empty,
      geographicSegments: [{ fiscalYear: "2024", segments: [{ name: "Europe", revenue: 50 }] }],
    });
  });
});

describe("getCompanyProfile", () => {
  it("maps the profile fields used by projections, cached for an hour", async () => {
    const fetchMock = mockFmp({
      profile: [{
        symbol: "JPM", companyName: "JPMorgan Chase & Co.", price: 336.54, beta: 1.015, marketCap: 9e11,
        currency: "USD", sector: "Financial Services", industry: "Banks - Diversified", isEtf: false, isFund: false,
        exchange: "NYSE", description: "A global bank.", website: "https://www.jpmorganchase.com", ceo: "James Dimon",
        fullTimeEmployees: "317233",
      }],
    });

    await expect(getCompanyProfile("JPM")).resolves.toEqual({
      ok: true,
      data: {
        symbol: "JPM", companyName: "JPMorgan Chase & Co.", price: 336.54, beta: 1.015, marketCap: 9e11,
        currency: "USD", sector: "Financial Services", industry: "Banks - Diversified", exchange: "NYSE",
        description: "A global bank.", website: "https://www.jpmorganchase.com", ceo: "James Dimon",
        employees: 317233, isEtf: false, isFund: false,
      },
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, { next?: { revalidate?: number } }];
    expect(init.next?.revalidate).toBe(60 * 60);
  });

  it("tolerates missing fields and reports failures", async () => {
    mockFmp({ profile: [{ symbol: "X", price: "n/a", currency: "dollars", sector: "" }] });
    await expect(getCompanyProfile("X")).resolves.toMatchObject({
      ok: true,
      data: { price: null, beta: null, currency: "USD", sector: null, companyName: null },
    });

    mockFmp({ profile: [] });
    await expect(getCompanyProfile("X")).resolves.toEqual({ ok: false, reason: "no-data" });

    vi.stubGlobal("fetch", statusForAll(429));
    await expect(getCompanyProfile("X")).resolves.toEqual({ ok: false, reason: "rate-limited" });
  });
});

describe("getRiskFreeRate", () => {
  it("returns the latest 10-year yield as a decimal", async () => {
    mockFmp({
      "treasury-rates": [
        { date: "2026-10-19", year10: 5.15 },
        { date: "2026-10-20", year10: 5.12 },
        { date: "2026-10-21", year10: null },
      ],
    });
    await expect(getRiskFreeRate()).resolves.toBeCloseTo(0.0512);
  });

  it("returns null without a key, on errors or without usable rows", async () => {
    mockFmp({ "treasury-rates": [{ date: "2026-10-20" }] });
    await expect(getRiskFreeRate()).resolves.toBeNull();

    vi.stubGlobal("fetch", statusForAll(500));
    await expect(getRiskFreeRate()).resolves.toBeNull();

    vi.stubEnv("FMP_API_KEY", "");
    await expect(getRiskFreeRate()).resolves.toBeNull();
  });
});

describe("fetchFmp's memory of refusals", () => {
  const url = (path: string, params: Record<string, string>) => {
    const value = new URL(`https://financialmodelingprep.com/stable/${path}`);
    for (const [key, param] of Object.entries(params)) value.searchParams.set(key, param);
    value.searchParams.set("apikey", "test-key");
    return value;
  };

  it("remembers an endpoint the plan doesn't include, whatever the parameters", async () => {
    const fetchMock = vi.fn(async () => new Response("Restricted Endpoint: This endpoint is not available under your current subscription", { status: 402 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchFmp(url("company-screener", { country: "US" }), 60)).rejects.toMatchObject({ reason: "plan-restricted" });
    await expect(fetchFmp(url("company-screener", { country: "US", limit: "200" }), 60)).rejects.toMatchObject({ reason: "plan-restricted" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rememberedRestrictions()).toBe(1);
  });

  it("remembers a company outside the plan per endpoint, even as the dates change", async () => {
    const fetchMock = vi.fn(async (input: URL | string) => (new URL(String(input)).pathname.endsWith("/quote")
      ? json([{ symbol: "MU", price: 900 }])
      : new Response("Premium Query Parameter: 'Special Endpoint : This value set for 'symbol' is not available under your current subscription", { status: 402 })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchFmp(url("historical-price-eod/light", { symbol: "MU", from: "2025-10-03" }), 60)).rejects.toMatchObject({ reason: "plan-restricted" });
    await expect(fetchFmp(url("historical-price-eod/light", { symbol: "mu", from: "2025-10-04" }), 60)).rejects.toMatchObject({ reason: "plan-restricted" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Another endpoint is still asked.
    await expect(fetchFmp(url("quote", { symbol: "MU" }), 60)).resolves.toEqual([{ symbol: "MU", price: 900 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("notes the daily limit without skipping later requests, so cached answers keep coming", async () => {
    const fetchMock = vi.fn(async () => new Response("Limit Reach", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchFmp(url("quote", { symbol: "AAPL" }), 60)).rejects.toMatchObject({ reason: "rate-limited" });
    await expect(fetchFmp(url("quote", { symbol: "AAPL" }), 60)).rejects.toMatchObject({ reason: "rate-limited" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(providerEvents("fmp").limitedAt).not.toBeNull();
    expect(rememberedRestrictions()).toBe(0);
  });
});

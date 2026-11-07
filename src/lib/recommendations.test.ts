import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRecommendationScreen } from "./recommendations";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

// 260 sessions of closes for a symbol, ending at `last`.
function history(symbol: string, last: number) {
  return Array.from({ length: 260 }, (_, index) => ({
    symbol,
    date: new Date(Date.UTC(2026, 10, 6) - index * 86_400_000).toISOString().slice(0, 10),
    price: last + index * 0.05,
  }));
}

function mockServices(overrides: { history?: () => Response } = {}) {
  const fetchMock = vi.fn(async (input: URL | string) => {
    const url = new URL(String(input));
    if (url.hostname === "finnhub.io") {
      return json([{ period: "2026-11-01", strongBuy: 20, buy: 30, hold: 5, sell: 0, strongSell: 0 }]);
    }
    const symbol = url.searchParams.get("symbol");
    switch (url.pathname.replace("/stable/", "")) {
      case "market-capitalization-batch":
        // The plan covers two of the bundled companies.
        return json([{ symbol: "AAPL", marketCap: 5e12 }, { symbol: "MSFT", marketCap: 4e12 }]);
      case "historical-price-eod/light":
        return overrides.history ? overrides.history() : json(history(symbol!, symbol === "AAPL" ? 300 : 500));
      case "price-target-consensus":
        return json([{ symbol, targetConsensus: symbol === "AAPL" ? 360 : 520, targetHigh: 400, targetLow: 250 }]);
      default:
        return json({ "Error Message": "not mocked" }, 404);
    }
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("FMP_API_KEY", "fmp-key");
  vi.stubEnv("FINNHUB_API_KEY", "finnhub-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getRecommendationScreen", () => {
  it("screens only the companies FMP's plan covers, with targets, ratings and the price trend", async () => {
    const fetchMock = mockServices();
    const result = await getRecommendationScreen(new Date("2026-11-07T12:00:00Z"));
    if (!result.ok) throw new Error(result.reason);
    expect(result.data.covered).toBe(2);
    expect(result.data.universe).toBeGreaterThan(2);
    expect(result.data.asOf).toBe("2026-11-06");
    const apple = result.data.candidates.find((candidate) => candidate.symbol === "AAPL")!;
    expect(apple).toMatchObject({ marketCap: 5e12, target: { consensus: 360, high: 400, low: 250 } });
    expect(apple.trend.close).toBe(300);
    expect(apple.ratings).toMatchObject({ total: 55, label: "Buy" });
    // One batch, then a history and a target per covered company: nothing for the rest.
    const fmpCalls = fetchMock.mock.calls.map(([input]) => new URL(String(input))).filter((url) => url.hostname !== "finnhub.io");
    expect(fmpCalls).toHaveLength(5);
    const from = fmpCalls.find((url) => url.pathname.endsWith("historical-price-eod/light"))!.searchParams.get("from");
    expect(from).toBe("2025-10-03");
  });

  it("explains a failure that leaves nothing to screen", async () => {
    mockServices({ history: () => json({ "Error Message": "Limit Reach" }, 429) });
    await expect(getRecommendationScreen()).resolves.toEqual({ ok: false, reason: "rate-limited" });
  });

  it("needs an FMP key", async () => {
    vi.stubEnv("FMP_API_KEY", "");
    await expect(getRecommendationScreen()).resolves.toEqual({ ok: false, reason: "not-configured" });
  });
});

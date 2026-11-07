import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLeaderboard, LEADERBOARD_SIZE, normalizeRow, rankRows } from "./leaderboard";

beforeEach(() => vi.stubEnv("FMP_API_KEY", "fmp-key"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("normalizeRow", () => {
  it("reads both the screener's and the movers' field names", () => {
    expect(normalizeRow({ symbol: "NVDA", companyName: "NVIDIA Corporation", price: 210.96, marketCap: 5.08e12, sector: "Technology", volume: 1.9e8 })).toEqual({
      symbol: "NVDA", name: "NVIDIA Corporation", price: 210.96, changePercent: null, marketCap: 5.08e12, volume: 1.9e8, sector: "Technology",
    });
    expect(normalizeRow({ symbol: "XYZ", name: "XYZ Corp", price: "4.2", changesPercentage: 35.5 })).toMatchObject({ name: "XYZ Corp", price: 4.2, changePercent: 0.355 });
    expect(normalizeRow({ symbol: "ABC", changePercentage: -12 })).toMatchObject({ name: "ABC", changePercent: -0.12 });
    expect(normalizeRow({ name: "No symbol" })).toBeNull();
  });
});

describe("rankRows", () => {
  const rows = [
    { symbol: "A", name: "A", price: 1, changePercent: 0.1, marketCap: 3e9, volume: 10, sector: null },
    { symbol: "B", name: "B", price: 1, changePercent: -0.3, marketCap: 9e9, volume: 30, sector: null },
    { symbol: "C", name: "C", price: 1, changePercent: 0.5, marketCap: 1e9, volume: 20, sector: null },
    { symbol: "C", name: "C again", price: 1, changePercent: 0.5, marketCap: 1e9, volume: 20, sector: null },
  ];
  const order = (id: Parameters<typeof rankRows>[0]) => rankRows(id, rows).map((row) => row.symbol);

  it("orders each list by its measure, without duplicates", () => {
    expect(order("largest")).toEqual(["B", "A", "C"]);
    expect(order("gainers")).toEqual(["C", "A", "B"]);
    expect(order("losers")).toEqual(["B", "A", "C"]);
    expect(order("active")).toEqual(["B", "C", "A"]);
  });
});

describe("getLeaderboard", () => {
  it("asks the screener for large US companies, and the movers endpoints for today's moves", async () => {
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      void init;
      return Response.json([{ symbol: "AAPL", companyName: "Apple Inc.", marketCap: 5e12, price: 347 }]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLeaderboard("largest")).resolves.toMatchObject({ ok: true, rows: [{ symbol: "AAPL", name: "Apple Inc." }] });
    const screener = new URL(String(fetchMock.mock.calls[0][0]));
    expect(screener.pathname).toBe("/stable/company-screener");
    expect(Object.fromEntries(screener.searchParams)).toMatchObject({ marketCapMoreThan: "10000000000", country: "US", isEtf: "false" });
    expect((fetchMock.mock.calls[0][1] as { next?: { revalidate?: number } }).next?.revalidate).toBe(21600);

    await getLeaderboard("gainers");
    expect(new URL(String(fetchMock.mock.calls[1][0])).pathname).toBe("/stable/biggest-gainers");
    expect((fetchMock.mock.calls[1][1] as { next?: { revalidate?: number } }).next?.revalidate).toBe(900);
  });

  it("reports failures and empty lists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ "Error Message": "Limit Reach" }, { status: 429 })));
    await expect(getLeaderboard("losers")).resolves.toEqual({ ok: false, reason: "rate-limited" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
    await expect(getLeaderboard("active")).resolves.toEqual({ ok: false, reason: "no-data" });
    vi.stubEnv("FMP_API_KEY", "");
    await expect(getLeaderboard("largest")).resolves.toEqual({ ok: false, reason: "not-configured" });
  });

  it("ranks the bundled snapshot when the screener isn't in the plan, with today's market caps where FMP has them", async () => {
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      if (url.pathname === "/stable/company-screener") return new Response("Restricted Endpoint", { status: 402 });
      // A tiny cap for Apple, so it drops to the bottom of the ranking.
      return Response.json([{ symbol: "AAPL", date: "2026-11-06", marketCap: 1 }]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLeaderboard("largest");
    if (!result.ok) throw new Error("expected the snapshot");
    expect(result.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.rows).toHaveLength(LEADERBOARD_SIZE);
    expect(result.rows.map((row) => row.symbol)).not.toContain("AAPL");
    expect(result.rows[0]).toMatchObject({ price: null, marketCap: expect.any(Number) });
    const batch = new URL(String(fetchMock.mock.calls[1][0]));
    expect(batch.pathname).toBe("/stable/market-capitalization-batch");
    expect(batch.searchParams.get("symbols")).toContain("AAPL");
  });

  it("falls back to the snapshot's own figures at the daily limit, but not for the movers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ "Error Message": "Limit Reach" }, { status: 429 })));
    const result = await getLeaderboard("largest");
    expect(result).toMatchObject({ ok: true, snapshotDate: expect.any(String) });
    if (result.ok) expect(result.rows[0].marketCap).toBeGreaterThan(result.rows[1].marketCap!);
    await expect(getLeaderboard("gainers")).resolves.toEqual({ ok: false, reason: "rate-limited" });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { getTiingoCloses, parseTiingoPrices } from "./tiingo";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parseTiingoPrices", () => {
  it("reads adjusted closes by day, oldest first, skipping bad rows", () => {
    expect(parseTiingoPrices([
      { date: "2024-06-10T00:00:00.000Z", close: 121.79, adjClose: 121.7 },
      { date: "2024-06-07T00:00:00.000Z", close: 1208.88, adjClose: 120.88 },
      { date: "2024-06-11T00:00:00.000Z", close: 120.91 },
      { date: "bad", adjClose: 1 },
      { date: "2024-06-12T00:00:00.000Z", adjClose: 0 },
    ])).toEqual([
      { date: "2024-06-07", close: 120.88 },
      { date: "2024-06-10", close: 121.7 },
      { date: "2024-06-11", close: 120.91 },
    ]);
    expect(parseTiingoPrices({ detail: "Not found." })).toEqual([]);
  });
});

describe("getTiingoCloses", () => {
  it("asks for five years with the key in a header, never the URL", async () => {
    vi.stubEnv("TIINGO_API_KEY", "tiingo-key");
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      void input;
      void init;
      return Response.json([{ date: "2026-11-06T00:00:00.000Z", adjClose: 101.5 }]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getTiingoCloses("BRK-B", new Date("2026-11-07T12:00:00Z"))).resolves.toEqual([{ date: "2026-11-06", close: 101.5 }]);
    const [input, init] = fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://api.tiingo.com/tiingo/daily/brk-b/prices?startDate=2021-11-07&columns=adjClose");
    expect(String(input)).not.toContain("tiingo-key");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Token tiingo-key");
    expect((init as { next?: { revalidate?: number } }).next?.revalidate).toBe(86_400);
  });

  it("is null without a key, for an unknown ticker or on failure", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("TIINGO_API_KEY", "");
    await expect(getTiingoCloses("AAPL")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("TIINGO_API_KEY", "tiingo-key");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ detail: "Error: Ticker 'ZZZZQ' not found" }, { status: 404 })));
    await expect(getTiingoCloses("ZZZZQ")).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
    await expect(getTiingoCloses("AAPL")).resolves.toBeNull();
  });
});

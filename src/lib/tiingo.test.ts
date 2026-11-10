import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTiingoDays, getTiingoCloses, getTiingoName, parseTiingoDays, parseTiingoPrices, tidyName } from "./tiingo";

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

  it("keeps the close as traded, the split and the dividend for the Portfolio", () => {
    expect(parseTiingoDays([
      { date: "2024-06-10T00:00:00.000Z", close: 121.79, adjClose: 121.44, splitFactor: 10, divCash: 0 },
      { date: "2024-06-07T00:00:00.000Z", close: 1208.88, adjClose: 120.54, splitFactor: 1, divCash: 0 },
      { date: "2024-06-11T00:00:00.000Z", close: 120.91, adjClose: 120.58, divCash: 0.01 },
    ])).toEqual([
      { date: "2024-06-07", close: 1208.88, adjClose: 120.54, splitFactor: 1, divCash: 0 },
      { date: "2024-06-10", close: 121.79, adjClose: 121.44, splitFactor: 10, divCash: 0 },
      { date: "2024-06-11", close: 120.91, adjClose: 120.58, splitFactor: 1, divCash: 0.01 },
    ]);
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
    expect(String(input)).toBe("https://api.tiingo.com/tiingo/daily/brk-b/prices?startDate=2021-11-07&columns=close,adjClose,splitFactor,divCash");
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

describe("fetchTiingoDays", () => {
  it("says why there are no prices: no key, a ticker it doesn't know, or a limit or failure", async () => {
    await expect(fetchTiingoDays("NVDA", "2021-11-10")).resolves.toEqual({ ok: false, reason: "not-configured" });
    vi.stubEnv("TIINGO_API_KEY", "tiingo-key");
    const answers = [
      Response.json([{ date: "2026-11-09T00:00:00.000Z", close: 190, adjClose: 190 }]),
      Response.json({ detail: "Not found." }, { status: 404 }),
      Response.json([]),
      Response.json({ detail: "Error: You have run over your hourly request allocation." }, { status: 429 }),
      new Response("bad gateway", { status: 502 }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => answers.shift()!));
    await expect(fetchTiingoDays("NVDA", "2021-11-10")).resolves.toEqual({ ok: true, days: [{ date: "2026-11-09", close: 190, adjClose: 190, splitFactor: 1, divCash: 0 }] });
    await expect(fetchTiingoDays("ZZZZQ", "2021-11-10")).resolves.toEqual({ ok: false, reason: "unknown" });
    await expect(fetchTiingoDays("ZZZZQ", "2021-11-10")).resolves.toEqual({ ok: false, reason: "unknown" });
    await expect(fetchTiingoDays("NVDA", "2021-11-10")).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(fetchTiingoDays("NVDA", "2021-11-10")).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("getTiingoName", () => {
  it("reads a fund's name from Tiingo's ticker details, kept for a month", async () => {
    vi.stubEnv("TIINGO_API_KEY", "tiingo-key");
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      void input;
      void init;
      return Response.json({ ticker: "VOO", name: "Vanguard S&P 500 ETF", exchangeCode: "NYSE ARCA" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(getTiingoName("VOO")).resolves.toBe("Vanguard S&P 500 ETF");
    const [input, init] = fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://api.tiingo.com/tiingo/daily/voo");
    expect((init as { next?: { revalidate?: number } }).next?.revalidate).toBe(2_592_000);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ detail: "Not found." }, { status: 404 })));
    await expect(getTiingoName("ZZZZQ")).resolves.toBeNull();
  });

  it("gives names in capitals ordinary case, keeping abbreviations", () => {
    expect(tidyName("VANGUARD 500 INDEX FUND ETF SHARES")).toBe("Vanguard 500 Index Fund ETF Shares");
    expect(tidyName("SCHWAB U.S. DIVIDEND EQUITY ETF")).toBe("Schwab U.S. Dividend Equity ETF");
    expect(tidyName("INVESCO QQQ TRUST, SERIES 1")).toBe("Invesco QQQ Trust, Series 1");
    expect(tidyName("ISHARES CORE S&P 500 ETF")).toBe("iShares Core S&P 500 ETF");
    expect(tidyName("SPDR S&P 500 ETF Trust")).toBe("SPDR S&P 500 ETF Trust");
  });
});

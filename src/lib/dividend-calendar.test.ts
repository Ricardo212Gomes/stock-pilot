import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addMonths,
  buildMonth,
  getDividendMonth,
  isMonth,
  monthGrid,
  normalizeDividend,
  type DividendEvent,
} from "./dividend-calendar";
import { resetCompanyNames } from "./earnings-calendar";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "KO", date: "2026-12-01", recordDate: "2026-12-01", paymentDate: "2026-12-15", declarationDate: "2026-10-16",
    adjDividend: 0.53, dividend: 0.53, yield: 2.28, frequency: "Quarterly",
    ...overrides,
  };
}

function dividend(overrides: Record<string, unknown> = {}): DividendEvent {
  return normalizeDividend(row(overrides), new Map())!;
}

beforeEach(() => {
  vi.stubEnv("FMP_API_KEY", "fmp-key");
  vi.stubEnv("FINNHUB_API_KEY", "");
  resetCompanyNames();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("months", () => {
  it("validates and steps months across years", () => {
    expect(isMonth("2026-10")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("October")).toBe(false);
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("covers the month in Monday-to-Friday weeks, padded with neighbouring days", () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const grid = monthGrid("2026-10");
    expect(grid).toHaveLength(5);
    expect(grid[0]).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(grid[4]).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
  });
});

describe("normalizeDividend", () => {
  it("keeps the dates, yield and annualized dividend", () => {
    expect(normalizeDividend(row(), new Map([["KO", "Coca-Cola Co"]]))).toEqual({
      symbol: "KO", name: "Coca-Cola Co", exDate: "2026-12-01", recordDate: "2026-12-01", paymentDate: "2026-12-15",
      declarationDate: "2026-10-16", dividend: 0.53, yieldPercent: 2.28, frequency: "Quarterly", annualDividend: 2.12,
    });
  });

  it("leaves unknown frequencies and missing dates empty, and skips unusable rows", () => {
    expect(dividend({ frequency: "Special", declarationDate: "" })).toMatchObject({ annualDividend: null, declarationDate: null });
    expect(dividend({ frequency: "Monthly", dividend: 0.27 }).annualDividend).toBeCloseTo(3.24);
    expect(normalizeDividend(row({ dividend: 0 }), new Map())).toBeNull();
    expect(normalizeDividend(row({ date: "" }), new Map())).toBeNull();
  });
});

describe("buildMonth", () => {
  const events = [
    dividend({ symbol: "KO", date: "2026-10-01", paymentDate: "2026-10-15", yield: 2.3 }),
    dividend({ symbol: "T", date: "2026-10-01", paymentDate: "2026-11-02", yield: 4.1 }),
    dividend({ symbol: "MSFT", date: "2026-09-29", paymentDate: "2026-10-08", yield: 0.7 }),
    dividend({ symbol: "JNJ", date: "2026-10-27", paymentDate: null, yield: 3 }),
  ];

  it("places dividends on their ex-dividend date, highest yield first", () => {
    const month = buildMonth(events, "2026-10", "ex");
    const day = month.weeks.flat().find((item) => item.date === "2026-10-01")!;
    expect(day.events.map((event) => event.symbol)).toEqual(["T", "KO"]);
    // MSFT goes ex in the September padding: shown, but not counted for October.
    expect(month.weeks[0][1]).toMatchObject({ date: "2026-09-29", inMonth: false });
    expect(month.weeks[0][1].events.map((event) => event.symbol)).toEqual(["MSFT"]);
    expect(month.count).toBe(3);
  });

  it("places dividends on their payment date, skipping unknown ones", () => {
    const month = buildMonth(events, "2026-10", "pay");
    const placed = month.weeks.flat().flatMap((day) => day.events.map((event) => `${event.symbol}@${day.date}`));
    expect(placed).toEqual(["MSFT@2026-10-08", "KO@2026-10-15"]);
    expect(month.count).toBe(2);
  });
});

describe("getDividendMonth", () => {
  function mockFmp(response: () => Response) {
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      void init;
      return response();
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("requests the visible grid by ex-date, and earlier weeks for payment dates", async () => {
    const fetchMock = mockFmp(() => json([row({ date: "2026-10-01" })]));
    const result = await getDividendMonth("2026-10", "ex", "2026-10-01");
    expect(result.ok && result.data.count).toBe(1);

    const exUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(exUrl.pathname).toBe("/stable/dividends-calendar");
    expect([exUrl.searchParams.get("from"), exUrl.searchParams.get("to")]).toEqual(["2026-09-28", "2026-10-30"]);
    expect((fetchMock.mock.calls[0][1] as { next?: { revalidate?: number } }).next?.revalidate).toBe(60 * 60 * 6);

    // Far from today, the full 60-day look-back is used.
    await getDividendMonth("2026-10", "pay", "2026-07-01");
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get("from")).toBe("2026-07-30");
    // Near today, it stops where the free plan's window starts (25 days back).
    await getDividendMonth("2026-11", "pay", "2026-10-24");
    expect(new URL(fetchMock.mock.calls[2][0]).searchParams.get("from")).toBe("2026-09-29");
    // A month entirely before the window is requested as is (the plan will refuse it).
    await getDividendMonth("2026-08", "ex", "2026-10-24");
    expect(new URL(fetchMock.mock.calls[3][0]).searchParams.get("from")).toBe("2026-07-27");
  });

  it("reports failures", async () => {
    mockFmp(() => json({ "Error Message": "Limit Reach" }, 429));
    await expect(getDividendMonth("2026-10", "ex")).resolves.toEqual({ ok: false, reason: "rate-limited" });

    vi.stubEnv("FMP_API_KEY", "");
    await expect(getDividendMonth("2026-10", "ex")).resolves.toEqual({ ok: false, reason: "not-configured" });
  });
});

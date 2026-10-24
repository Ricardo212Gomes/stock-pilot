import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  buildWeek,
  cleanCompanyName,
  defaultWeek,
  getCompanyNames,
  getEarningsWeek,
  isIsoDate,
  normalizeEvent,
  resetCompanyNames,
  surprise,
  weekStart,
  type EarningsEvent,
} from "./earnings-calendar";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "KO", date: "2026-10-27", hour: "bmo", quarter: 3, year: 2026,
    epsEstimate: 0.8, epsActual: null, revenueEstimate: 12e9, revenueActual: null,
    ...overrides,
  };
}

// Builds an event through the same Finnhub row shape, where the report time is called "hour".
function event({ time, ...overrides }: Partial<EarningsEvent> = {}): EarningsEvent {
  return normalizeEvent(row({ ...overrides, ...(time ? { hour: time } : {}) }), new Map())!;
}

beforeEach(() => {
  vi.stubEnv("FINNHUB_API_KEY", "finnhub-key");
  resetCompanyNames();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("dates", () => {
  it("finds the Monday of any day's week, Sunday included", () => {
    expect(weekStart("2026-10-24")).toBe("2026-10-19");
    expect(weekStart("2026-10-25")).toBe("2026-10-19");
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
  });

  it("opens the next week on weekends", () => {
    expect(defaultWeek("2026-10-23")).toBe("2026-10-19");
    expect(defaultWeek("2026-10-24")).toBe("2026-10-26");
    expect(defaultWeek("2026-10-25")).toBe("2026-10-26");
  });

  it("adds days across months and validates ISO dates", () => {
    expect(addDays("2026-10-30", 4)).toBe("2026-11-03");
    expect(isIsoDate("2026-10-26")).toBe(true);
    expect(isIsoDate("26/10/2026")).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });
});

describe("events", () => {
  it("computes surprises against the size of the estimate", () => {
    expect(surprise(7.97, 7.5)).toBeCloseTo(0.0627, 4);
    expect(surprise(-0.1, -0.2)).toBeCloseTo(0.5);
    expect(surprise(1, 0)).toBeNull();
    expect(surprise(null, 1)).toBeNull();
  });

  it("normalizes Finnhub rows with names and report times", () => {
    const names = new Map([["KO", "Coca-Cola Co"]]);
    expect(normalizeEvent(row({ epsActual: 0.88, revenueActual: 12.6e9 }), names)).toEqual({
      symbol: "KO", name: "Coca-Cola Co", date: "2026-10-27", time: "bmo", quarter: 3, year: 2026,
      epsEstimate: 0.8, epsActual: 0.88, epsSurprise: expect.closeTo(0.1, 6),
      revenueEstimate: 12e9, revenueActual: 12.6e9, revenueSurprise: expect.closeTo(0.05, 6),
    });
    expect(normalizeEvent(row({ hour: "" }), names)?.time).toBe("unknown");
    expect(normalizeEvent(row({ date: "soon" }), names)).toBeNull();
    expect(normalizeEvent(null, names)).toBeNull();
  });

  it("cleans Finnhub's upper-case company names", () => {
    expect(cleanCompanyName("COCA-COLA CO/THE")).toBe("Coca-Cola Co");
    expect(cleanCompanyName("META PLATFORMS INC-CLASS A")).toBe("Meta Platforms Inc");
    expect(cleanCompanyName("AT&T INC")).toBe("AT&T Inc");
    expect(cleanCompanyName("BANK OF AMERICA CORP")).toBe("Bank of America Corp");
    expect(cleanCompanyName("RTX CORP")).toBe("RTX Corp");
    expect(cleanCompanyName("W R BERKLEY CORP")).toBe("W R Berkley Corp");
    expect(cleanCompanyName("KAROOOOO LTD")).toBe("Karooooo Ltd");
  });
});

describe("buildWeek", () => {
  const events = [
    event({ symbol: "SMALL", revenueEstimate: 5e8 }),
    event({ symbol: "KO", revenueEstimate: 12e9, epsActual: 0.9, epsEstimate: 0.8 }),
    event({ symbol: "V", date: "2026-10-27", time: "amc", revenueEstimate: 10e9, epsActual: 2.9, epsEstimate: 3 }),
    event({ symbol: "XOM", date: "2026-10-30", revenueEstimate: 105e9 }),
    event({ symbol: "MRK", date: "2026-10-27", revenueEstimate: 16e9 }),
    event({ symbol: "NEXT", date: "2026-11-02", revenueEstimate: 50e9 }),
  ];

  it("keeps large companies, groups by day and report time, largest first", () => {
    const week = buildWeek(events, "2026-10-26", true);
    expect(week).toMatchObject({ start: "2026-10-26", end: "2026-11-01", total: 5, shown: 4, reported: 2, beats: 1 });
    expect(week.days.map((day) => [day.date, day.count])).toEqual([
      ["2026-10-26", 0], ["2026-10-27", 3], ["2026-10-28", 0], ["2026-10-29", 0], ["2026-10-30", 1],
    ]);
    const tuesday = week.days[1];
    expect(tuesday.groups.map((group) => [group.time, group.events.map((item) => item.symbol)])).toEqual([
      ["bmo", ["MRK", "KO"]],
      ["amc", ["V"]],
    ]);
  });

  it("shows every company when asked, and weekend days only when something is scheduled", () => {
    const week = buildWeek([...events, event({ symbol: "SAT", date: "2026-10-31" })], "2026-10-26", false);
    expect(week.shown).toBe(6);
    expect(week.days.map((day) => day.date)).toContain("2026-10-31");
    expect(week.days.map((day) => day.date)).not.toContain("2026-11-01");
  });
});

describe("getEarningsWeek", () => {
  function mockFinnhub(calendar: () => Response, symbols: () => Response = () => json([{ symbol: "KO", description: "COCA-COLA CO/THE" }])) {
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      void init;
      const url = new URL(input);
      return url.pathname.endsWith("/stock/symbol") ? symbols() : calendar();
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("loads the week with company names, cached hourly", async () => {
    const fetchMock = mockFinnhub(() => json({ earningsCalendar: [row(), row({ symbol: "V", hour: "amc" })] }));
    const result = await getEarningsWeek("2026-10-26", true);
    if (!result.ok) throw new Error(result.reason);
    const tuesday = result.data.days.find((day) => day.date === "2026-10-27")!;
    expect(tuesday.groups[0].events[0]).toMatchObject({ symbol: "KO", name: "Coca-Cola Co" });
    expect(tuesday.groups[1].events[0]).toMatchObject({ symbol: "V", name: null });

    const calendarCall = fetchMock.mock.calls.find(([input]) => String(input).includes("calendar/earnings"));
    const url = new URL(calendarCall![0]);
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect((calendarCall![1] as { next?: { revalidate?: number } }).next?.revalidate).toBe(3600);
  });

  it("still works without names, and reports calendar failures", async () => {
    mockFinnhub(() => json({ earningsCalendar: [row()] }), () => json({}, 500));
    const withoutNames = await getEarningsWeek("2026-10-26", true);
    expect(withoutNames.ok && withoutNames.data.days[1].groups[0].events[0].name).toBeNull();

    mockFinnhub(() => json({}, 429));
    await expect(getEarningsWeek("2026-10-26", true)).resolves.toEqual({ ok: false, reason: "rate-limited" });

    mockFinnhub(() => json({ unexpected: true }));
    await expect(getEarningsWeek("2026-10-26", true)).resolves.toEqual({ ok: false, reason: "provider-error" });
  });
});

describe("getCompanyNames", () => {
  it("downloads the symbol list once a day", async () => {
    const fetchMock = vi.fn(async () => json([{ symbol: "AAPL", description: "APPLE INC" }]));
    vi.stubGlobal("fetch", fetchMock);
    const now = Date.parse("2026-10-24T12:00:00Z");

    expect((await getCompanyNames(now)).get("AAPL")).toBe("Apple Inc");
    await getCompanyNames(now + 60 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await getCompanyNames(now + 25 * 60 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTranscript,
  latestReportedQuarter,
  parseTranscript,
  previousQuarter,
  savedQuarters,
  quarterLabel,
  recentQuarters,
} from "./transcripts";

const segment = { speaker: "George Kurtz", title: "CEO", content: "Record quarter.", sentiment: "0.6" };

function mockFetch(...bodies: unknown[]) {
  const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
    void input;
    void init;
    return new Response(JSON.stringify(bodies.length > 1 ? bodies.shift() : bodies[0]), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("ALPHAVANTAGE_API_KEY", "av-key");
  vi.stubEnv("FINNHUB_API_KEY", "fh-key");
  vi.stubEnv("DATABASE_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fiscal quarters", () => {
  it("steps back across years and labels them", () => {
    expect(previousQuarter("2027Q1")).toBe("2026Q4");
    expect(recentQuarters("2027Q2", 4)).toEqual(["2027Q2", "2027Q1", "2026Q4", "2026Q3"]);
    expect(quarterLabel("2026Q2")).toBe("FY2026 Q2");
  });

  it("takes the latest reported quarter from Finnhub's calendar, or the one before the next report", async () => {
    mockFetch({ earningsCalendar: [{ date: "2026-11-30", year: 2027, quarter: 3 }] });
    await expect(latestReportedQuarter("CRWD", "2026-10-24")).resolves.toBe("2027Q2");
    mockFetch({ earningsCalendar: [{ date: "2026-08-26", year: 2027, quarter: 2 }, { date: "2026-11-30", year: 2027, quarter: 3 }] });
    await expect(latestReportedQuarter("CRWD", "2026-10-24")).resolves.toBe("2027Q2");
    // Without a calendar, the calendar quarter before today's.
    mockFetch({ earningsCalendar: [] });
    await expect(latestReportedQuarter("XYZ", "2026-10-24")).resolves.toBe("2026Q3");
  });
});

describe("parseTranscript", () => {
  it("keeps speakers, titles, text and sentiment", () => {
    expect(parseTranscript({ symbol: "CRWD", quarter: "2026Q2", transcript: [segment, { speaker: "Operator", content: " " }] })).toEqual({
      ok: true,
      segments: [{ speaker: "George Kurtz", title: "CEO", content: "Record quarter.", sentiment: 0.6 }],
    });
  });

  it("tells a missing transcript from a rate limit", () => {
    expect(parseTranscript({ symbol: "CRWD", quarter: "2027Q2", transcript: [] })).toEqual({ ok: false, reason: "unavailable" });
    expect(parseTranscript({ Information: "Please consider spreading out your free API requests" })).toEqual({ ok: false, reason: "rate-limited" });
    expect(parseTranscript("nope")).toEqual({ ok: false, reason: "provider-error" });
  });
});

describe("getTranscript", () => {
  it("asks Alpha Vantage once and reuses the saved transcript", async () => {
    const fetchMock = mockFetch({ transcript: [segment] });
    await expect(getTranscript("TEST1", "2026Q2")).resolves.toMatchObject({ ok: true });
    await expect(getTranscript("TEST1", "2026Q2")).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ function: "EARNINGS_CALL_TRANSCRIPT", symbol: "TEST1", quarter: "2026Q2" });
    // The quarter tabs learn which calls exist without asking again.
    await expect(savedQuarters("TEST1", ["2026Q2", "2026Q1"])).resolves.toEqual(new Map([["2026Q2", true]]));
  });

  it("remembers a missing transcript for a day, but never a rate limit", async () => {
    const fetchMock = mockFetch({ Information: "limit" }, { transcript: [] });
    await expect(getTranscript("TEST2", "2027Q2")).resolves.toEqual({ ok: false, reason: "rate-limited" });
    await expect(getTranscript("TEST2", "2027Q2")).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(getTranscript("TEST2", "2027Q2")).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("needs the Alpha Vantage key", async () => {
    vi.stubEnv("ALPHAVANTAGE_API_KEY", "");
    await expect(getTranscript("TEST3", "2026Q2")).resolves.toEqual({ ok: false, reason: "not-configured" });
  });
});

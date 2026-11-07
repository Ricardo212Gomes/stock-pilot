import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chartHistory, getVix, parseCboeHistory, vixScore, vixStats, vixZone, type VixPoint } from "./vix";

beforeEach(() => vi.stubEnv("FMP_API_KEY", "fmp-key"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("vixScore", () => {
  it("gives each zone a fifth of the dial, from extreme greed at 100 to extreme fear at 0", () => {
    expect(vixScore(8)).toBe(100);
    expect(vixScore(12)).toBe(80);
    expect(vixScore(14)).toBe(70);
    expect(vixScore(18)).toBe(50);
    expect(vixScore(25)).toBe(30);
    expect(vixScore(30)).toBe(20);
    expect(vixScore(80)).toBe(0);
  });
});

describe("vixZone", () => {
  it("puts each boundary in the more fearful zone", () => {
    expect(vixZone(11.99).id).toBe("extreme-greed");
    expect(vixZone(12).id).toBe("greed");
    expect(vixZone(16).id).toBe("neutral");
    expect(vixZone(20).id).toBe("fear");
    expect(vixZone(25.64).id).toBe("fear");
    expect(vixZone(30).id).toBe("extreme-fear");
  });
});

describe("parseCboeHistory", () => {
  it("reads Cboe's CSV into ISO dates and closes, skipping bad rows", () => {
    const csv = "DATE,OPEN,HIGH,LOW,CLOSE\n01/02/1990,17.24,17.24,17.24,17.24\n11/06/2026,27.68,27.76,23.47,25.64\nbad,row\n";
    expect(parseCboeHistory(csv)).toEqual([
      { date: "1990-01-02", close: 17.24 },
      { date: "2026-11-06", close: 25.64 },
    ]);
  });
});

// One close per calendar day from 2025-10-01 to 2026-11-06, rising by 0.01 a day from 14.
function dailyHistory(): VixPoint[] {
  const points: VixPoint[] = [];
  for (let day = new Date("2025-10-01T12:00:00Z"), close = 14; day <= new Date("2026-11-06T12:00:00Z"); day.setUTCDate(day.getUTCDate() + 1), close += 0.01) {
    points.push({ date: day.toISOString().slice(0, 10), close: Math.round(close * 100) / 100 });
  }
  return points;
}

describe("vixStats", () => {
  it("compares today with earlier closes and the past year", () => {
    const history = dailyHistory();
    const quote = { value: 25.64, change: -2.54, changePercent: -0.09, date: "2026-11-06", dayLow: null, dayHigh: null, source: "fmp" as const };
    const stats = vixStats({ quote, history });
    expect(stats.comparisons.map(({ label, point }) => [label, point?.date])).toEqual([
      ["Previous close", "2026-11-05"],
      ["1 week ago", "2026-10-30"],
      ["1 month ago", "2026-10-06"],
      ["1 year ago", "2025-11-06"],
    ]);
    // Every close in the past year is below 25.64, the last (18.01) included.
    expect(stats.yearPercentile).toBe(1);
    expect(stats.yearLow).toBeCloseTo(14.37);
    expect(stats.yearHigh).toBeCloseTo(18.01);
    expect(stats.longRunSince).toBe("2025-10-01");
  });

  it("keeps the last five years for the chart", () => {
    const history = [{ date: "2020-01-01", close: 13 }, { date: "2021-11-06", close: 16 }, { date: "2026-11-06", close: 25 }];
    expect(chartHistory(history, "2026-11-06").map((point) => point.date)).toEqual(["2021-11-06", "2026-11-06"]);
  });
});

describe("getVix", () => {
  const csv = "DATE,OPEN,HIGH,LOW,CLOSE\n11/04/2026,17,17,17,17.14\n11/05/2026,17.14,28.36,16.7,28.18\n";

  it("uses FMP's quote and Cboe's history, adding today's reading to the history", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      if (url.hostname === "cdn.cboe.com") return new Response(csv);
      // 2026-11-06 16:15 in New York.
      return Response.json([{ symbol: "^VIX", price: 25.64, change: -2.54, changePercentage: -9.01, dayLow: 23.47, dayHigh: 27.76, timestamp: 1794006900 }]);
    }));
    const result = await getVix(new Date("2026-11-07T12:00:00Z"));
    if (!result.ok) throw new Error(result.reason);
    expect(result.data.quote).toMatchObject({ value: 25.64, date: "2026-11-06", changePercent: -0.0901, source: "fmp" });
    expect(result.data.historySource).toBe("cboe");
    expect(result.data.history.map((point) => point.close)).toEqual([17.14, 28.18, 25.64]);
  });

  it("falls back to Cboe's latest close when FMP is out of requests", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: URL | string) =>
      new URL(String(input)).hostname === "cdn.cboe.com" ? new Response(csv) : new Response("Limit Reach", { status: 429 })));
    const result = await getVix();
    if (!result.ok) throw new Error(result.reason);
    expect(result.data.quote).toMatchObject({ value: 28.18, date: "2026-11-05", source: "cboe" });
    expect(result.data.quote.change).toBeCloseTo(11.04);
    expect(result.data.history).toHaveLength(2);
  });

  it("explains FMP's failure when Cboe is down too", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: URL | string) =>
      new URL(String(input)).hostname === "cdn.cboe.com" ? new Response("", { status: 503 }) : new Response("Limit Reach", { status: 429 })));
    await expect(getVix()).resolves.toEqual({ ok: false, reason: "rate-limited" });
  });
});

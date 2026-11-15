import { describe, expect, it } from "vitest";
import type { VixResult } from "../vix";
import { parseFredCsv } from "../event-sources";
import { cpiYearOverYear, getMacroFigures, latestAndMonthAgo, macroLines, parseFredObservations, type MacroDeps } from "./macro";

const vix: VixResult = {
  ok: true,
  data: {
    quote: { value: 24.3, change: 1, changePercent: 0.04, date: "2026-11-13", dayLow: null, dayHigh: null, source: "cboe" },
    history: [
      { date: "2026-06-01", close: 14 },
      { date: "2026-09-01", close: 18 },
      { date: "2026-11-12", close: 23.3 },
      { date: "2026-11-13", close: 24.3 },
    ],
    historySource: "cboe",
  },
};

function deps(overrides: Partial<MacroDeps> = {}): MacroDeps {
  return {
    now: () => new Date("2026-11-16T15:00:00Z"),
    fredKey: () => undefined,
    fedTarget: async () => ({ changes: [{ date: "2025-12-11", lower: 4, upper: 4.25 }, { date: "2026-10-29", lower: 3.75, upper: 4 }], asOf: "2026-11-13" }),
    fred: async (series) => (series === "DGS10"
      ? [{ date: "2026-10-13", value: 4.05 }, { date: "2026-11-13", value: 4.31 }]
      : [{ date: "2025-10-01", value: 320 }, { date: "2026-10-01", value: 329.6 }]),
    fmpTenYear: async () => [{ date: "2026-10-10", value: 0.04 }, { date: "2026-11-13", value: 0.043 }],
    vix: async () => vix,
    ...overrides,
  };
}

describe("FRED readings", () => {
  it("reads observations, skipping missing days", () => {
    expect(parseFredObservations({ observations: [{ date: "2026-11-13", value: "4.31" }, { date: "2026-11-11", value: "." }, { date: "2026-11-12", value: "4.28" }] }))
      .toEqual([{ date: "2026-11-12", value: 4.28 }, { date: "2026-11-13", value: 4.31 }]);
    expect(parseFredObservations({ error_message: "Bad key" })).toBeNull();
  });

  it("reads FRED's public CSV, skipping holidays", () => {
    expect(parseFredCsv("observation_date,DGS10\n2026-11-10,4.28\n2026-11-11,\n2026-11-12,4.31\n", "DGS10"))
      .toEqual([{ date: "2026-11-10", value: 4.28 }, { date: "2026-11-12", value: 4.31 }]);
    expect(parseFredCsv("<html>busy</html>", "DGS10")).toBeNull();
  });

  it("finds the value a month earlier and CPI over a year", () => {
    expect(latestAndMonthAgo([{ date: "2026-10-12", value: 4.05 }, { date: "2026-10-14", value: 4.1 }, { date: "2026-11-13", value: 4.31 }]))
      .toEqual({ value: 4.31, date: "2026-11-13", monthAgo: 4.05 });
    expect(latestAndMonthAgo([])).toBeNull();
    const cpi = cpiYearOverYear([{ date: "2025-10-01", value: 320 }, { date: "2026-09-01", value: 328 }, { date: "2026-10-01", value: 329.6 }]);
    expect(cpi?.month).toBe("2026-10");
    expect(cpi?.yearOverYear).toBeCloseTo(0.03);
    // October 2025 was never published: October 2026 has nothing to compare with, so September stands in.
    expect(cpiYearOverYear([{ date: "2025-09-01", value: 324 }, { date: "2025-11-01", value: 325 }, { date: "2026-09-01", value: 336.3 }, { date: "2026-10-01", value: 337.5 }]))
      .toEqual({ yearOverYear: 336.3 / 324 - 1, month: "2026-09" });
  });
});

describe("getMacroFigures", () => {
  it("without a FRED key: the yield and CPI from FRED's public CSV", async () => {
    const keys: (string | undefined)[] = [];
    const macro = await getMacroFigures(deps({ fred: async (series, from, key) => (keys.push(key), deps().fred(series, from, key)) }));
    expect(keys).toEqual([undefined, undefined]);
    expect(macro.fedFunds).toEqual({ lower: 3.75, upper: 4, since: "2026-10-29" });
    expect(macro.tenYear).toEqual({ value: 0.0431, date: "2026-11-13", monthAgo: 0.0405, source: "fred" });
    expect(macro.cpi?.yearOverYear).toBeCloseTo(0.03);
    expect(macro.vix).toMatchObject({ value: 24.3, zone: "Fear" });
    expect(macro.missing).toEqual([]);
  });

  it("with a FRED key: both series from FRED's API", async () => {
    const asked: string[] = [];
    const macro = await getMacroFigures(deps({
      fredKey: () => "key",
      fred: async (series, from, key) => (asked.push(`${series} ${key}`), deps().fred(series, from, key)),
    }));
    expect(asked.sort()).toEqual(["CPIAUCSL key", "DGS10 key"]);
    expect(macro.tenYear).toMatchObject({ value: 0.0431, monthAgo: 0.0405, source: "fred" });
  });

  it("falls back to FMP for the yield when FRED fails", async () => {
    const macro = await getMacroFigures(deps({ fred: async () => null }));
    expect(macro.tenYear).toMatchObject({ value: 0.043, source: "fmp" });
    expect(macro.missing).toEqual(["CPI (FRED)"]);
  });

  it("names each source that fails, and keeps the rest", async () => {
    const macro = await getMacroFigures(deps({
      fedTarget: async () => { throw new Error("down"); },
      fred: async () => { throw new Error("down"); },
      fmpTenYear: async () => [],
      vix: async () => ({ ok: false, reason: "provider-error" }),
    }));
    expect(macro).toMatchObject({ fedFunds: null, tenYear: null, vix: null });
    expect(macro.missing).toEqual(["the Fed funds target range (FRED)", "the 10-year Treasury yield (FRED and FMP)", "CPI (FRED)", "the VIX"]);
  });
});

describe("macroLines", () => {
  it("writes one line per figure", async () => {
    const text = macroLines(await getMacroFigures(deps()));
    expect(text).toContain("- Fed funds target range: 3.75–4.00%, since 2026-10-29.");
    expect(text).toContain("- 10-year Treasury yield: 4.31% on 2026-11-13, up 26 basis points from 4.05% a month earlier.");
    expect(text).toMatch(/- VIX: 24\.3 on 2026-11-13 \(fear\); its past year averaged \d+\.\d; higher than \d+% of the past year's closes\./);
    expect(macroLines({ fedFunds: null, tenYear: null, cpi: null, vix: null, missing: [] })).toBeNull();
  });
});

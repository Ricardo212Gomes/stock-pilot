import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the postgres client: a tagged template that records each query, and sql(rows, ...columns) for
// bulk inserts.
const queries: { text: string; values: unknown[] }[] = [];
let answers: unknown[][] = [];
vi.mock("./db", () => ({
  getSql: () => (first: unknown, ...rest: unknown[]) => {
    if (Array.isArray(first) && "raw" in first) {
      queries.push({ text: (first as string[]).join("?").replace(/\s+/g, " ").trim(), values: rest });
      return Promise.resolve(answers.shift() ?? []);
    }
    return { rows: first, columns: rest };
  },
}));

const {
  comparisons,
  historyStats,
  loadSeries,
  ndxToday,
  percentileOf,
  pointOn,
  reading,
  sp500Snapshot,
  sp500Today,
  storeSeries,
  summaryFacts,
  yieldGap,
  zoneFor,
} = await import("./market-valuation");

beforeEach(() => {
  queries.length = 0;
  answers = [];
});

const monthly = (from: number, values: number[]) =>
  values.map((value, index) => {
    const year = from + Math.floor(index / 12);
    const month = (index % 12) + 1;
    return { date: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10), value };
  });

describe("reading the history", () => {
  it("gives percentiles and zones", () => {
    const values = Array.from({ length: 100 }, (_, index) => index);
    expect(percentileOf(values, 50)).toBe(50.5);
    expect(percentileOf(values, 1000)).toBe(100);
    expect(zoneFor(10).id).toBe("cheap");
    expect(zoneFor(25).id).toBe("fair");
    expect(zoneFor(80).id).toBe("expensive");
    expect(zoneFor(90).id).toBe("very-expensive");
    expect(zoneFor(100).id).toBe("very-expensive");
  });

  it("works out the average, spread, low and high", () => {
    const stats = historyStats(monthly(2000, [10, 20, 30]))!;
    expect(stats.average).toBe(20);
    expect(stats.deviation).toBeCloseTo(8.165, 3);
    expect(stats.low.value).toBe(10);
    expect(stats.high.date).toBe("2000-03-31");
    expect(historyStats(monthly(2000, [10]))).toBeNull();
  });

  it("finds the value some years back, only when one is near that date", () => {
    const points = monthly(2000, Array.from({ length: 12 * 21 }, (_, index) => index));
    const [one, five, ten, twenty] = comparisons(points);
    expect(one).toEqual({ label: "1 year ago", point: { date: "2019-12-31", value: 239 } });
    expect(five.point?.date).toBe("2015-12-31");
    expect(ten.label).toBe("10 years ago");
    expect(twenty.point?.date).toBe("2000-12-31");
    // A gap of more than two months before the date leaves it empty.
    expect(pointOn([{ date: "2020-01-31", value: 1 }], "2020-06-30")).toBeNull();
    expect(pointOn([{ date: "2020-05-31", value: 1 }], "2020-06-30")?.value).toBe(1);
  });

  it("only gives a zone with ten years of months", () => {
    const short = reading(monthly(2020, [1, 2, 3]), "pe")!;
    expect(short.percentile).toBeNull();
    expect(short.zone).toBeNull();
    const long = reading(monthly(2000, Array.from({ length: 120 }, (_, index) => index)), "pe", 200)!;
    expect(long.percentile).toBe(100);
    expect(long.zone?.label).toBe("Very expensive");
  });

  it("subtracts the 10-year yield from the earnings yield, month by month", () => {
    expect(yieldGap(
      [{ date: "2026-01-31", value: 4 }, { date: "2026-02-28", value: 3.9, provisional: true }, { date: "2026-03-31", value: 3.8 }],
      [{ date: "2026-01-30", value: 4.5 }, { date: "2026-02-27", value: 4.4 }],
    )).toEqual([
      { date: "2026-01-31", value: -0.5 },
      { date: "2026-02-28", value: -0.5, provisional: true },
    ]);
  });
});

describe("today's estimates", () => {
  it("divides the S&P 500's latest close by Shiller's latest earnings", () => {
    const today = sp500Today({
      sp500: {
        level: [{ date: "2026-11-13", value: 7500 }],
        earnings: [{ date: "2026-05-31", value: 290 }, { date: "2026-06-30", value: 300, provisional: true }],
      },
    })!;
    expect(today.value).toBe(25);
    expect(today.earningsDate).toBe("2026-06-30");
    expect(today.provisional).toBe(true);
    expect(sp500Today({ sp500: { level: [{ date: "2026-11-13", value: 7500 }] } })).toBeNull();
  });

  it("moves the Nasdaq-100's latest snapshot with the index since then", () => {
    const series = {
      ndx: {
        level: [{ date: "2026-09-30", value: 25_000 }, { date: "2026-11-13", value: 27_500 }],
        pe: [{ date: "2026-09-30", value: 35 }],
        pe_forward: [{ date: "2026-09-30", value: 24 }],
      },
    };
    expect(ndxToday(series)!.value).toBeCloseTo(38.5, 6);
    expect(ndxToday(series, "pe_forward")!.value).toBeCloseTo(26.4, 6);
    expect(ndxToday({ ndx: { level: [{ date: "2026-11-13", value: 1 }], pe: [{ date: "2026-09-30", value: 35 }] } })).toBeNull();
  });
});

describe("storage", () => {
  it("upserts each series in bulk under its market", async () => {
    await storeSeries([
      { index: "sp500", metric: "pe", source: "shiller", points: [{ date: "2026-06-30", value: 25.2, provisional: true }] },
      { index: "ndx", metric: "pe", source: "siblis", points: [] },
    ]);
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toMatch(/^insert into market_valuations \? on conflict \(market, metric, date\) do update/);
    expect(queries[0].values[0]).toEqual({
      rows: [{ market: "sp500", metric: "pe", date: "2026-06-30", value: 25.2, source: "shiller", provisional: true }],
      columns: ["market", "metric", "date", "value", "source", "provisional"],
    });
  });

  it("groups stored rows by market and metric", async () => {
    answers = [[
      { market: "sp500", metric: "pe", date: new Date("2026-05-31T00:00:00Z"), value: "24.5", provisional: false },
      { market: "sp500", metric: "pe", date: new Date("2026-06-30T00:00:00Z"), value: 25.2, provisional: true },
      { market: "us", metric: "buffett", date: "2026-06-30", value: 255, provisional: false },
    ]];
    expect(await loadSeries()).toEqual({
      sp500: { pe: [{ date: "2026-05-31", value: 24.5 }, { date: "2026-06-30", value: 25.2, provisional: true }] },
      us: { buffett: [{ date: "2026-06-30", value: 255 }] },
    });
    expect(queries[0].values).toEqual([["sp500", "ndx", "us"]]);
  });

  it("gives the Home page today's P/E and zone", async () => {
    answers = [
      Array.from({ length: 120 }, (_, index) => ({ value: 10 + index / 10 })),
      [
        { market: "sp500", metric: "earnings", date: "2026-06-30", value: 300, provisional: true },
        { market: "sp500", metric: "level", date: "2026-11-13", value: 7500, provisional: false },
      ],
    ];
    const snapshot = (await sp500Snapshot())!;
    expect(snapshot.value).toBe(25);
    expect(snapshot.zone?.id).toBe("very-expensive");
  });
});

describe("the AI summary's facts", () => {
  it("lists the numbers and keys the summary to the latest month's data", () => {
    const pe = monthly(2000, Array.from({ length: 120 }, (_, index) => 15 + index / 10));
    const { facts, basis } = summaryFacts({
      sp500: { pe, cape: pe, level: [{ date: "2026-11-13", value: 7500 }], earnings: [{ date: "2026-06-30", value: 300 }] },
      us: { ten_year: [{ date: "2026-11-12", value: 5.1 }] },
    }, "sp500");
    expect(facts[0]).toMatch(/^Trailing P\/E today \(estimate\): 25\.0/);
    expect(facts.some((fact) => fact.startsWith("CAPE"))).toBe(true);
    expect(facts.at(-1)).toBe("10-year Treasury yield: 5.10% (2026-11-12)");
    expect(basis).toBe("sp500|2009-12-31|2009-12-31|");
  });
});

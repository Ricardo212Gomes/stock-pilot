import { describe, expect, it } from "vitest";
import {
  beaEvents,
  blsEvents,
  censusEvents,
  compareEvents,
  countdown,
  electionDay,
  electionEvents,
  fedEvents,
  usPoliticalEvents,
} from "./market-events";

describe("electionDay", () => {
  it("is the Tuesday after the first Monday in November", () => {
    expect(electionDay(2026)).toBe("2026-11-03");
    expect(electionDay(2028)).toBe("2028-11-07");
    expect(electionDay(2030)).toBe("2030-11-05");
    // November 1 is itself a Monday: the Tuesday after it.
    expect(electionDay(2032)).toBe("2032-11-02");
  });
});

describe("usPoliticalEvents", () => {
  it("lists elections, new Congresses, inaugurations and funding deadlines", () => {
    const events = usPoliticalEvents(2027, 3).map((event) => [event.date, event.title]);
    expect(events).toEqual([
      ["2027-01-03", "The 120th Congress convenes"],
      ["2027-09-30", "Fiscal 2027 ends: funding deadline"],
      ["2028-11-07", "US presidential election"],
      ["2028-09-30", "Fiscal 2028 ends: funding deadline"],
      ["2029-01-03", "The 121st Congress convenes"],
      ["2029-01-20", "Presidential inauguration"],
      ["2029-09-30", "Fiscal 2029 ends: funding deadline"],
    ]);
  });
});

describe("fedEvents", () => {
  const meetings = [
    { start: "2026-09-15", end: "2026-09-16", projections: true },
    { start: "2026-12-08", end: "2026-12-09", projections: true },
  ];
  const target = { changes: [{ date: "2026-01-01", lower: 3.5, upper: 3.75 }, { date: "2026-09-17", lower: 3.75, upper: 4 }], asOf: "2026-11-06" };

  it("gives past decisions their outcome and adds the minutes three weeks later", () => {
    const events = fedEvents(meetings, target, "2026-11-07");
    expect(events.map((event) => [event.date, event.title, event.outcome, event.tags])).toEqual([
      ["2026-09-16", "Fed rate decision", "Raised by 0.25 pt to 3.75–4.00%", ["Projections"]],
      ["2026-10-07", "Fed meeting minutes", null, []],
      ["2026-12-09", "Fed rate decision", null, ["Projections"]],
      ["2026-12-30", "Fed meeting minutes", null, []],
    ]);
    expect(events[0]).toMatchObject({ time: "2:00 PM", importance: "high", category: "fed" });
  });
});

describe("data releases", () => {
  it("keeps the BLS releases that move markets", () => {
    const events = blsEvents([
      { date: "2026-11-10", time: "8:30 AM", summary: "Consumer Price Index" },
      { date: "2026-11-10", time: "8:30 AM", summary: "Real Earnings" },
      { date: "2026-12-04", time: "8:30 AM", summary: "Employment Situation" },
    ]);
    expect(events.map((event) => [event.kind, event.title, event.importance, event.source.url])).toEqual([
      ["cpi", "CPI inflation", "high", "https://www.bls.gov/schedule/news_release/cpi.htm"],
      ["jobs", "Jobs report", "high", "https://www.bls.gov/schedule/news_release/empsit.htm"],
    ]);
  });

  it("names GDP estimates and PCE reports, and skips county and state figures", () => {
    const events = beaEvents([
      { date: "2026-10-29", time: "8:30 AM", summary: "GDP (Advance Estimate), 3rd Quarter 2026" },
      { date: "2026-11-25", time: "8:30 AM", summary: "GDP (Second Estimate) and Corporate Profits, 3rd Quarter 2026" },
      { date: "2026-11-25", time: "8:30 AM", summary: "Personal Income and Outlays, October 2026" },
      { date: "2026-12-02", time: "8:30 AM", summary: "GDP by County and Personal Income by County, 2025" },
      { date: "2025-01-30", time: "8:30 AM", summary: "Gross Domestic Product, 4th Quarter and Year 2024 (Advance Estimate)" },
    ]);
    expect(events.map((event) => [event.title, event.importance])).toEqual([
      ["GDP, Q3 2026 (advance estimate)", "high"],
      ["GDP, Q3 2026 (second estimate)", "medium"],
      ["PCE inflation and spending, October 2026", "high"],
      ["GDP, Q4 2024 (advance estimate)", "high"],
    ]);
  });

  it("keeps retail sales and durable goods from the Census calendar, linking each year's page", () => {
    const events = censusEvents([
      { indicator: "Advance Monthly Sales for Retail and Food Services", date: "2026-11-17", time: "8:30 AM", period: "October 2026" },
      { indicator: "Advance Report on Durable Goods--Manufacturers' Shipments, Inventories, and Orders", date: "2027-01-27", time: "8:30 AM", period: "December 2026" },
      { indicator: "Construction Spending", date: "2026-12-01", time: "10:00 AM", period: "October 2026" },
    ], 2026);
    expect(events.map((event) => [event.title, event.source.url])).toEqual([
      ["Retail sales, October 2026", "https://www.census.gov/economic-indicators/calendar-listview-2026.html"],
      ["Durable goods orders, December 2026", "https://www.census.gov/economic-indicators/calendar-listview.html"],
    ]);
  });
});

describe("electionEvents", () => {
  it("keeps major economies and marks the G7's as high impact", () => {
    const events = electionEvents([
      { date: "2027-04-18", monthOnly: false, country: "France", article: "2027 French presidential election", offices: "President" },
      { date: "2027-06-06", monthOnly: false, country: "Mexico", article: "2027 Mexican legislative election", offices: "Chamber of Deputies" },
      { date: "2027-03-02", monthOnly: false, country: "Micronesia", article: "2027 Micronesian general election", offices: "Parliament" },
    ]);
    expect(events.map((event) => [event.title, event.importance, event.source.url])).toEqual([
      ["2027 French presidential election", "high", "https://en.wikipedia.org/wiki/2027_French_presidential_election"],
      ["2027 Mexican legislative election", "medium", "https://en.wikipedia.org/wiki/2027_Mexican_legislative_election"],
    ]);
  });
});

describe("compareEvents and countdown", () => {
  it("orders by day, then time, with high impact first", () => {
    const [first] = usPoliticalEvents(2028, 1);
    const base = { ...first, time: null as string | null, importance: "medium" as const };
    const events = [
      { ...base, id: "c", date: "2026-11-25", time: "10:00 AM" },
      { ...base, id: "b", date: "2026-11-25", time: "8:30 AM" },
      { ...base, id: "a", date: "2026-11-25", time: "8:30 AM", importance: "high" as const },
      { ...base, id: "z", date: "2026-11-10" },
    ];
    expect(events.sort(compareEvents).map((event) => event.id)).toEqual(["z", "a", "b", "c"]);
  });

  it("counts days in words", () => {
    expect(countdown("2026-11-07", "2026-11-07")).toBe("Today");
    expect(countdown("2026-11-07", "2026-11-08")).toBe("Tomorrow");
    expect(countdown("2026-11-07", "2026-12-09")).toBe("In 32 days");
    expect(countdown("2026-11-07", "2026-11-03")).toBe("4 days ago");
  });
});

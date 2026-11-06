import { describe, expect, it } from "vitest";
import type { StatementTable } from "./financial-statements";
import { buildJeremyDefaults, projectCase, type CaseInputs, type JeremyStart, type JeremyYear } from "./jeremy-projection";
import { buildProjectionDefaults } from "./plumas-projection";
import type { AnalystEstimate } from "./stock-overview";

// Growth rates in percent, without the first year's (it's the starting point).
function inputs(revenue: number[], netIncome: number[], peLow: number[], peHigh: number[]): CaseInputs {
  return {
    revenueGrowth: [0, ...revenue.map((value) => value / 100)],
    netIncomeGrowth: [0, ...netIncome.map((value) => value / 100)],
    peLow,
    peHigh,
  };
}

const fill = (value: number) => [value, value, value, value, value];

// Jeremy's sheet shows amounts to the cent when they aren't whole, prices in whole dollars, whole
// percentages and EPS in cents.
const money = (value: number | null) => `$${value!.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const dollars = (value: number | null) => `$${Math.round(value!).toLocaleString("en-US")}`;
const percent = (value: number | null) => `${Math.round(value! * 100)}%`;
const cents = (value: number | null) => `$${value!.toFixed(2)}`;

function sheet(start: JeremyStart, scenario: CaseInputs) {
  const result = projectCase(start, scenario);
  if (!result.ok) throw new Error(result.reason);
  const row = (pick: (year: JeremyYear) => number | null, format: (value: number | null) => string) =>
    result.years.map((year) => (pick(year) === null ? "" : format(pick(year))));
  return {
    years: result.years.map((year) => year.year),
    revenue: row((year) => year.revenue, money),
    netIncome: row((year) => year.netIncome, money),
    margin: row((year) => year.netMargin, percent),
    eps: row((year) => year.eps, cents),
    low: row((year) => year.priceLow, dollars),
    high: row((year) => year.priceHigh, dollars),
    cagrLow: row((year) => year.cagrLow, percent),
    cagrHigh: row((year) => year.cagrHigh, percent),
  };
}

describe("projectCase reproduces Jeremy Lefebvre's 1000xStocks projections", () => {
  // AMD at $488.78 with 1,630,000,000 shares; fiscal 2026 revenue $50.893B and net income $10.30B.
  const amd: JeremyStart = { year: 2026, revenue: 50_893_000_000, netIncome: 10_299_819_714, shares: 1_630_000_000, price: 488.78 };

  it("AMD bull case", () => {
    expect(sheet(amd, inputs([95, 25, 25, 25], [200, 45, 45, 45], [70, 55, 45, 35, 25], [90, 65, 55, 45, 35]))).toEqual({
      years: [2026, 2027, 2028, 2029, 2030],
      revenue: ["$50,893,000,000", "$99,241,350,000", "$124,051,687,500", "$155,064,609,375", "$193,830,761,719"],
      netIncome: ["$10,299,819,714", "$30,899,459,142", "$44,804,215,756", "$64,966,112,846", "$94,200,863,627"],
      margin: ["20%", "31%", "36%", "42%", "49%"],
      eps: ["$6.32", "$18.96", "$27.49", "$39.86", "$57.79"],
      low: ["$442", "$1,043", "$1,237", "$1,395", "$1,445"],
      high: ["$569", "$1,232", "$1,512", "$1,794", "$2,023"],
      // No CAGR for the starting year or the one after, as on his sheet.
      cagrLow: ["", "", "59%", "42%", "31%"],
      cagrHigh: ["", "", "76%", "54%", "43%"],
    });
  });

  it("AMD base case", () => {
    expect(sheet(amd, inputs([85, 20, 20, 20], [180, 35, 35, 35], [50, 40, 35, 30, 25], [70, 50, 40, 35, 30]))).toMatchObject({
      revenue: ["$50,893,000,000", "$94,152,050,000", "$112,982,460,000", "$135,578,952,000", "$162,694,742,400"],
      netIncome: ["$10,299,819,714", "$28,839,495,199", "$38,933,318,519", "$52,559,980,001", "$70,955,973,001"],
      margin: ["20%", "31%", "34%", "39%", "44%"],
      eps: ["$6.32", "$17.69", "$23.89", "$32.25", "$43.53"],
      low: ["$316", "$708", "$836", "$967", "$1,088"],
      high: ["$442", "$885", "$955", "$1,129", "$1,306"],
      cagrLow: ["", "", "31%", "26%", "22%"],
      cagrHigh: ["", "", "40%", "32%", "28%"],
    });
  });

  it("AMD bear case", () => {
    expect(sheet(amd, inputs([80, 15, 15, 15], [170, 25, 25, 25], [25, 25, 20, 20, 20], [30, 30, 25, 25, 25]))).toMatchObject({
      revenue: ["$50,893,000,000", "$91,607,400,000", "$105,348,510,000", "$121,150,786,500", "$139,323,404,475"],
      netIncome: ["$10,299,819,714", "$27,809,513,228", "$34,761,891,535", "$43,452,364,419", "$54,315,455,524"],
      margin: ["20%", "30%", "33%", "36%", "39%"],
      eps: ["$6.32", "$17.06", "$21.33", "$26.66", "$33.32"],
      low: ["$158", "$427", "$427", "$533", "$666"],
      high: ["$190", "$512", "$533", "$666", "$833"],
      cagrLow: ["", "", "-7%", "3%", "8%"],
      cagrHigh: ["", "", "4%", "11%", "14%"],
    });
  });

  // Netflix at $81.05 with 4,222,162,000 shares; fiscal 2026 revenue $51.74B and net income $15.26B.
  const nflx: JeremyStart = { year: 2026, revenue: 51_744_695_000, netIncome: 15_264_745_384.53, shares: 4_222_162_000, price: 81.05 };

  it("Netflix bull, base and bear cases", () => {
    expect(sheet(nflx, inputs([13, 13, 13, 13], [18, 18, 18, 18], fill(28), fill(33)))).toMatchObject({
      revenue: ["$51,744,695,000", "$58,471,505,350", "$66,072,801,045", "$74,662,265,181", "$84,368,359,655"],
      netIncome: ["$15,264,745,384.53", "$18,012,399,554", "$21,254,631,474", "$25,080,465,139", "$29,594,948,864"],
      margin: ["30%", "31%", "32%", "34%", "35%"],
      eps: ["$3.62", "$4.27", "$5.03", "$5.94", "$7.01"],
      low: ["$101", "$119", "$141", "$166", "$196"],
      high: ["$119", "$141", "$166", "$196", "$231"],
      cagrLow: ["", "", "32%", "27%", "25%"],
      cagrHigh: ["", "", "43%", "34%", "30%"],
    });
    expect(sheet(nflx, inputs([11, 11, 11, 11], [16, 16, 16, 16], fill(25), fill(30)))).toMatchObject({
      revenue: ["$51,744,695,000", "$57,436,611,450", "$63,754,638,710", "$70,767,648,968", "$78,552,090,354"],
      netIncome: ["$15,264,745,384.53", "$17,707,104,646", "$20,540,241,389", "$23,826,680,011", "$27,638,948,813"],
      eps: ["$3.62", "$4.19", "$4.86", "$5.64", "$6.55"],
      low: ["$90", "$105", "$122", "$141", "$164"],
      high: ["$108", "$126", "$146", "$169", "$196"],
      cagrLow: ["", "", "22%", "20%", "19%"],
      cagrHigh: ["", "", "34%", "28%", "25%"],
    });
    expect(sheet(nflx, inputs([9, 9, 9, 9], [14, 14, 14, 14], fill(22), fill(27)))).toMatchObject({
      revenue: ["$51,744,695,000", "$56,401,717,550", "$61,477,872,130", "$67,010,880,622", "$73,041,859,878"],
      netIncome: ["$15,264,745,384.53", "$17,401,809,738", "$19,838,063,101", "$22,615,391,935", "$25,781,546,806"],
      eps: ["$3.62", "$4.12", "$4.70", "$5.36", "$6.11"],
      low: ["$80", "$91", "$103", "$118", "$134"],
      high: ["$98", "$111", "$127", "$145", "$165"],
      cagrLow: ["", "", "13%", "13%", "13%"],
      cagrHigh: ["", "", "25%", "21%", "19%"],
    });
  });

  it("measures the CAGR from an entry price when one is set, and refuses a loss", () => {
    const scenario = inputs([13, 13, 13, 13], [18, 18, 18, 18], fill(28), fill(33));
    const fromEntry = projectCase(nflx, scenario, 60);
    if (!fromEntry.ok) throw new Error(fromEntry.reason);
    // The 2030 high target of $231 from $60 instead of $81.05, over four years.
    expect(fromEntry.years[4].cagrHigh).toBeCloseTo((fromEntry.years[4].priceHigh! / 60) ** (1 / 4) - 1);
    // An entry price of 0 means none.
    expect(projectCase(nflx, scenario, 0)).toEqual(projectCase(nflx, scenario));
    expect(projectCase({ ...nflx, netIncome: -1 }, scenario)).toMatchObject({ ok: false, reason: expect.stringMatching(/loss/) });
    expect(projectCase({ ...nflx, shares: null }, scenario)).toMatchObject({ ok: false });
  });
});

describe("buildJeremyDefaults", () => {
  const fiscal = [2025, 2024, 2023, 2022, 2021].map((year) => ({ id: `${year}-12-31`, label: `FY ${year}`, periodEnding: `${year}-12-31` }));
  const income: StatementTable = {
    statement: "income",
    period: "annual",
    source: "fmp",
    currency: "USD",
    fiscalYear: null,
    columns: [{ id: "ttm", label: "TTM", periodEnding: "2026-09-30" }, ...fiscal],
    // Trailing twelve months first, then fiscal 2025 back to 2021.
    rows: Object.entries({
      revenue: [1500, 1450, 1331, 1210, 1100, 1000],
      netIncome: [150, 145, 133.1, 121, 110, 100],
      shares: [100, 100, 100, 100, 100, 100],
      eps: [1.5, 1.45, 1.331, 1.21, 1.1, 1],
    }).map(([id, values]) => ({ id, label: id, format: "money" as const, emphasis: false, section: null, help: null, values })),
    chart: { title: "", labels: [], series: [], defaults: [] },
  };
  const estimate = (date: string, revenue: number, netIncome: number | null, eps: number | null, analysts: number): AnalystEstimate => ({
    date,
    revenue: { low: null, avg: revenue, high: null },
    netIncome: { low: null, avg: netIncome, high: null },
    eps: { low: null, avg: eps, high: null },
    analysts,
  });
  const today = new Date("2026-11-06T00:00:00Z");
  const plumas = buildProjectionDefaults({ income, ratios: null, price: 30, shares: 100, today });

  it("starts from this year's consensus, follows it where enough analysts cover, then fades", () => {
    const estimates = [
      estimate("2025-12-31", 1330, 133, 1.33, 20),
      estimate("2026-12-31", 1500, 150, 1.5, 20),
      estimate("2027-12-31", 1800, 200, 2, 15),
      estimate("2028-12-31", 2000, null, 2.4, 2),
    ];
    const defaults = buildJeremyDefaults({ plumas, estimates, today });

    expect(defaults.start).toEqual({ year: 2026, revenue: 1500, netIncome: 150, shares: 100, price: 30 });
    expect(defaults.startSource).toBe("consensus");
    // 2027 from the consensus (+20% revenue, +33.3% net income); 2028 has only two analysts, so it fades
    // like the Plumas base case for 2028, with net income growing as fast as revenue.
    const base = defaults.cases.base;
    expect(base.revenueGrowth.slice(0, 2)).toEqual([0, 0.2]);
    expect(base.netIncomeGrowth[1]).toBe(0.333);
    expect(base.revenueGrowth[2]).toBe(plumas.scenarios.base.revenueGrowth[2]);
    expect(base.netIncomeGrowth[2]).toBe(base.revenueGrowth[2]);
    // Forward P/E: $30 ÷ $1.50 = 20×, minus and plus 20%.
    expect([base.peLow, base.peHigh]).toEqual([[16, 16, 16, 16, 16], [24, 24, 24, 24, 24]]);
    expect(defaults.cases.bull.revenueGrowth.slice(0, 2)).toEqual([0, 0.25]);
    expect([defaults.cases.bear.peLow[0], defaults.cases.bear.peHigh[0]]).toEqual([13, 19]);
    expect(defaults.notes.start).toMatch(/consensus for fiscal 2026, the year in progress \(20 analysts\)/);
    expect(defaults.notes.growth).toMatch(/consensus for fiscal 2027, then the company's compound revenue growth/);

    const result = projectCase(defaults.start, base);
    expect(result.ok && result.years.map((year) => year.year)).toEqual([2026, 2027, 2028, 2029, 2030]);
    expect(result.ok && result.years[1].revenue).toBeCloseTo(1800);
  });

  it("fades a high forward P/E to 20–30× by the last year", () => {
    const estimates = [estimate("2026-12-31", 1500, 150, 1.5, 20)];
    // $60 ÷ $1.50 = 40×: 32× to 48× today, fading to 20× and 30× by 2030.
    const defaults = buildJeremyDefaults({ plumas: { ...plumas, start: { ...plumas.start, price: 60 } }, estimates, today });
    expect(defaults.cases.base.peLow).toEqual([32, 29, 26, 23, 20]);
    expect(defaults.cases.base.peHigh).toEqual([48, 44, 39, 35, 30]);
    expect(defaults.cases.bull.peHigh[4]).toBe(36);
    expect(defaults.notes.pe).toMatch(/fades to 20× and 30× by 2030/);
  });

  it("falls back to the last report without a consensus for the year in progress", () => {
    const defaults = buildJeremyDefaults({ plumas, estimates: [], today });
    expect(defaults.start).toEqual({ year: 2025, revenue: 1450, netIncome: 145, shares: 100, price: 30 });
    expect(defaults.startSource).toBe("reported");
    // The Plumas base case, which starts the year after the last report.
    expect(defaults.cases.base.revenueGrowth.slice(1)).toEqual(plumas.scenarios.base.revenueGrowth.slice(0, 4));
    expect(defaults.notes.start).toMatch(/as reported/);
  });
});

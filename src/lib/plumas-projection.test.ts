import { describe, expect, it } from "vitest";
import type { StatementTable } from "./financial-statements";
import {
  buildProjectionDefaults,
  fitToEstimates,
  netIncomeRatio,
  projectScenario,
  scenariosFor,
  type BaseYear,
  type ProjectedYear,
  type ScenarioInputs,
} from "./plumas-projection";
import type { AnalystEstimate } from "./stock-overview";

const rates = (percents: number[]) => percents.map((value) => value / 100);
const fill = (value: number) => [value, value, value, value, value];

function inputs(overrides: Partial<ScenarioInputs>): ScenarioInputs {
  return {
    revenueGrowth: fill(0),
    netIncomeGrowth: fill(0),
    costGrowth: fill(0),
    opexGrowth: fill(0),
    otherGrowth: fill(0),
    buybackYield: fill(0),
    peLow: fill(15),
    peMid: fill(20),
    peHigh: fill(25),
    ...overrides,
  };
}

// The reference screenshots' display formats: $73.67B, 675.18M, $18.58, $297, 21.7%.
const billions = (value: number | null) => (value! / 1e9).toFixed(2);
const millions = (value: number | null) => (value! / 1e6).toFixed(2);
const cents = (value: number | null) => value!.toFixed(2);
const dollars = (value: number | null) => value!.toFixed(0);
const percent = (value: number | null) => (value! * 100).toFixed(1);

function columns(years: ProjectedYear[]) {
  return (pick: (year: ProjectedYear) => number | null, format: (value: number | null) => string) => years.map((year) => format(pick(year)));
}

describe("projectScenario reproduces the reference projections", () => {
  it("American Express, Advanced: no cost of revenue, buybacks from today's share count", () => {
    // Fiscal 2025: revenue $66.97B, operating expenses $53.18B, operating income = pretax income $13.79B (no
    // interest & other), net income $10.83B; 682.00M shares today at $312.99.
    const base: BaseYear = {
      year: 2025, periodEnding: "2025-12-31", revenue: 66.9725e9, costOfRevenue: null,
      operatingIncome: 13.795e9, pretaxIncome: 13.795e9, netIncome: 10.833e9,
    };
    const result = projectScenario("advanced", base, { price: 312.99, shares: 682e6 }, inputs({
      revenueGrowth: rates([10, 9, 8.5, 8.5, 8]),
      opexGrowth: rates([8.5, 8.5, 8.5, 8.5, 8.5]),
      buybackYield: rates([1, 2.5, 2.5, 2.5, 2.5]),
      peLow: fill(16),
      peMid: fill(18),
      peHigh: fill(20),
    }));
    if (!result.ok) throw new Error(result.reason);
    const column = columns(result.years);

    expect(result.years.map((year) => year.year)).toEqual([2026, 2027, 2028, 2029, 2030]);
    expect(column((year) => year.revenue, billions)).toEqual(["73.67", "80.30", "87.13", "94.53", "102.09"]);
    expect(column((year) => year.grossProfit, String)).toEqual(["null", "null", "null", "null", "null"]);
    expect(column((year) => year.operatingExpenses, billions)).toEqual(["57.70", "62.60", "67.92", "73.70", "79.96"]);
    expect(column((year) => year.operatingIncome, billions)).toEqual(["15.97", "17.70", "19.20", "20.83", "22.13"]);
    expect(column((year) => year.operatingMargin, percent)).toEqual(["21.7", "22.0", "22.0", "22.0", "21.7"]);
    expect(column((year) => year.other, billions)).toEqual(["0.00", "0.00", "0.00", "0.00", "0.00"]);
    expect(column((year) => year.netIncome, billions)).toEqual(["12.54", "13.90", "15.08", "16.36", "17.38"]);
    expect(column((year) => year.netMargin, percent)).toEqual(["17.0", "17.3", "17.3", "17.3", "17.0"]);
    expect(column((year) => year.shares, millions)).toEqual(["675.18", "658.30", "641.84", "625.80", "610.15"]);
    expect(column((year) => year.eps, cents)).toEqual(["18.58", "21.11", "23.49", "26.14", "28.49"]);
    expect(column((year) => year.priceLow, dollars)).toEqual(["297", "338", "376", "418", "456"]);
    expect(column((year) => year.priceMid, dollars)).toEqual(["334", "380", "423", "471", "513"]);
    expect(column((year) => year.priceHigh, dollars)).toEqual(["372", "422", "470", "523", "570"]);
    expect(column((year) => year.marketCapMid, billions)).toEqual(["225.77", "250.17", "271.43", "294.50", "312.85"]);
    expect(column((year) => year.cagrLow, percent)).toEqual(["-5.0", "3.9", "6.3", "7.5", "7.8"]);
    expect(column((year) => year.cagrMid, percent)).toEqual(["6.8", "10.2", "10.6", "10.7", "10.4"]);
    expect(column((year) => year.cagrHigh, percent)).toEqual(["18.7", "16.1", "14.5", "13.7", "12.7"]);
  });

  it("KLA, Simple: net income grows on its own and today's share count stays", () => {
    // Fiscal 2026 revenue $13.58B and net income $4.83B; 1.32B shares today at $146.62.
    const base: BaseYear = {
      year: 2026, periodEnding: "2026-06-30", revenue: 13.576e9, costOfRevenue: null,
      operatingIncome: null, pretaxIncome: null, netIncome: 4.83035e9,
    };
    const result = projectScenario("simple", base, { price: 146.62, shares: 1.31952e9 }, inputs({
      revenueGrowth: rates([30, 15, 10, 6, 6]),
      netIncomeGrowth: rates([39, 19, 12, 7, 7]),
      peLow: fill(22),
      peHigh: fill(30),
    }));
    if (!result.ok) throw new Error(result.reason);
    const column = columns(result.years);

    expect(result.years.map((year) => year.year)).toEqual([2027, 2028, 2029, 2030, 2031]);
    expect(column((year) => year.revenue, billions)).toEqual(["17.65", "20.30", "22.33", "23.67", "25.09"]);
    expect(column((year) => year.netIncome, billions)).toEqual(["6.71", "7.99", "8.95", "9.58", "10.25"]);
    expect(column((year) => year.netMargin, percent)).toEqual(["38.0", "39.4", "40.1", "40.5", "40.8"]);
    expect(column((year) => year.eps, cents)).toEqual(["5.09", "6.06", "6.78", "7.26", "7.76"]);
    expect(column((year) => year.priceLow, dollars)).toEqual(["112", "133", "149", "160", "171"]);
    expect(column((year) => year.priceHigh, dollars)).toEqual(["153", "182", "203", "218", "233"]);
    expect(column((year) => year.cagrLow, percent)).toEqual(["-23.7", "-4.7", "0.6", "2.2", "3.1"]);
    expect(column((year) => year.cagrHigh, percent)).toEqual(["4.1", "11.3", "11.5", "10.4", "9.7"]);
    // Simple mode has no mid P/E, operating lines or buybacks.
    expect(result.years.every((year) => year.priceMid === null && year.operatingIncome === null && year.shares === 1.31952e9)).toBe(true);
  });

  it("Nike, Advanced: cost of revenue, interest & other, and both edits of fiscal 2031", () => {
    // Fiscal 2026: revenue $46.40B, cost of revenue $26.49B, operating expenses $16.11B, interest & other
    // $103.00M, net income $3.11B; 1.48B shares today at $37.38.
    const base: BaseYear = {
      year: 2026, periodEnding: "2026-05-31", revenue: 46.397e9, costOfRevenue: 26.486e9,
      operatingIncome: 3.797e9, pretaxIncome: 3.9e9, netIncome: 3.108e9,
    };
    const scenario = inputs({
      revenueGrowth: rates([-8, 2, 5.5, 5.5, 5.5]),
      costGrowth: rates([-7, 1, 4, 5, 5]),
      opexGrowth: rates([-1.5, 0, 1.5, 3, 4]),
      otherGrowth: rates([-20, 0, 0, 0, 0]),
      buybackYield: rates([0, 0.5, 1, 1, 1]),
      peLow: fill(18),
      peMid: fill(22),
      peHigh: fill(26),
    });
    const result = projectScenario("advanced", base, { price: 37.38, shares: 1.4839e9 }, scenario);
    if (!result.ok) throw new Error(result.reason);
    const column = columns(result.years);

    expect(column((year) => year.revenue, billions)).toEqual(["42.69", "43.54", "45.93", "48.46", "51.13"]);
    expect(column((year) => year.costOfRevenue, billions)).toEqual(["24.63", "24.88", "25.87", "27.17", "28.53"]);
    expect(column((year) => year.grossProfit, billions)).toEqual(["18.05", "18.66", "20.06", "21.29", "22.60"]);
    expect(column((year) => year.grossMargin, percent)).toEqual(["42.3", "42.9", "43.7", "43.9", "44.2"]);
    expect(column((year) => year.operatingExpenses, billions)).toEqual(["15.87", "15.87", "16.11", "16.59", "17.26"]);
    expect(column((year) => year.operatingIncome, billions)).toEqual(["2.18", "2.79", "3.95", "4.70", "5.34"]);
    expect(column((year) => year.operatingMargin, percent)).toEqual(["5.1", "6.4", "8.6", "9.7", "10.4"]);
    expect(column((year) => year.other, millions)).toEqual(["82.40", "82.40", "82.40", "82.40", "82.40"]);
    expect(column((year) => year.netIncome, billions)).toEqual(["1.80", "2.29", "3.21", "3.81", "4.32"]);
    expect(column((year) => year.netMargin, percent)).toEqual(["4.2", "5.3", "7.0", "7.9", "8.5"]);
    expect(column((year) => year.shares, billions)).toEqual(["1.48", "1.48", "1.46", "1.45", "1.43"]);
    expect(column((year) => year.eps, cents).slice(0, 4)).toEqual(["1.22", "1.55", "2.20", "2.63"]);
    expect(column((year) => year.priceLow, dollars)).toEqual(["22", "28", "40", "47", "54"]);
    expect(column((year) => year.priceMid, dollars).slice(0, 4)).toEqual(["27", "34", "48", "58"]);
    expect(column((year) => year.priceHigh, dollars)).toEqual(["32", "40", "57", "68", "78"]);
    expect(column((year) => year.marketCapMid, billions).slice(0, 4)).toEqual(["39.68", "50.33", "70.69", "83.83"]);
    expect(column((year) => year.cagrLow, percent)).toEqual(["-41.5", "-13.6", "1.9", "6.1", "7.8"]);
    expect(column((year) => year.cagrMid, percent).slice(0, 4)).toEqual(["-28.5", "-4.5", "9.0", "11.6"]);
    expect(column((year) => year.cagrHigh, percent)).toEqual(["-15.5", "3.8", "15.2", "16.3", "16.0"]);

    // The later frame, with fiscal 2031's cost of revenue growing 4% instead of 5%.
    const edited = projectScenario("advanced", base, { price: 37.38, shares: 1.4839e9 }, { ...scenario, costGrowth: rates([-7, 1, 4, 5, 4]) });
    if (!edited.ok) throw new Error(edited.reason);
    const last = edited.years[4];
    expect([billions(last.operatingIncome), percent(last.operatingMargin), billions(last.netIncome), percent(last.netMargin)]).toEqual(["5.61", "11.0", "4.54", "8.9"]);
    expect([cents(last.eps), dollars(last.priceLow), dollars(last.priceMid), dollars(last.priceHigh), billions(last.marketCapMid)]).toEqual(["3.17", "57", "70", "82", "99.87"]);
    expect([percent(last.cagrLow), percent(last.cagrMid), percent(last.cagrHigh)]).toEqual(["8.8", "13.3", "17.1"]);
  });
});

describe("projectScenario", () => {
  const base: BaseYear = {
    year: 2025, periodEnding: "2025-12-31", revenue: 1000, costOfRevenue: 400,
    operatingIncome: 100, pretaxIncome: 100, netIncome: 80,
  };

  it("explains what each mode needs", () => {
    const start = { price: 10, shares: 10 };
    expect(projectScenario("simple", { ...base, revenue: 0 }, start, inputs({}))).toMatchObject({ ok: false, reason: expect.stringMatching(/revenue/) });
    expect(projectScenario("simple", base, { price: 10, shares: null }, inputs({}))).toMatchObject({ ok: false, reason: expect.stringMatching(/shares/) });
    expect(projectScenario("simple", { ...base, netIncome: -5 }, start, inputs({}))).toMatchObject({ ok: false, reason: expect.stringMatching(/loss.*Advanced/) });
    expect(projectScenario("advanced", { ...base, operatingIncome: null }, start, inputs({}))).toMatchObject({ ok: false, reason: expect.stringMatching(/operating income/) });
    // Advanced mode can project a loss-making company back to profit.
    const recovery = projectScenario("advanced", { ...base, operatingIncome: -20, pretaxIncome: -20, netIncome: -18 }, start, inputs({ revenueGrowth: fill(0.2), costGrowth: fill(0.1), opexGrowth: fill(0.05) }));
    expect(recovery.ok && recovery.years.map((year) => year.netIncome > 0)).toEqual([true, true, true, true, true]);
  });

  it("leaves the price and CAGR blank for loss-making years and without a price", () => {
    const shrinking = projectScenario("advanced", base, { price: 10, shares: 10 }, inputs({ revenueGrowth: fill(-0.2) }));
    if (!shrinking.ok) throw new Error(shrinking.reason);
    expect(shrinking.years[4].eps).toBeLessThan(0);
    expect([shrinking.years[4].priceLow, shrinking.years[4].cagrHigh, shrinking.years[4].marketCapMid]).toEqual([null, null, null]);

    const noPrice = projectScenario("simple", base, { price: null, shares: 10 }, inputs({}));
    expect(noPrice.ok && noPrice.years[0]).toMatchObject({ priceLow: 120, priceHigh: 200, cagrLow: null, cagrHigh: null });
  });

  it("keeps the last year's ratio of net income to pretax income, or falls back to a 21% tax", () => {
    expect(netIncomeRatio({ ...base, pretaxIncome: 125 })).toEqual({ value: 0.64, fromFilings: true });
    // Without pretax income, interest & other is zero and the ratio is to operating income.
    expect(netIncomeRatio({ ...base, pretaxIncome: null })).toEqual({ value: 0.8, fromFilings: true });
    expect(netIncomeRatio({ ...base, pretaxIncome: -10 })).toEqual({ value: 0.79, fromFilings: false });
    expect(netIncomeRatio({ ...base, netIncome: 150 })).toEqual({ value: 0.79, fromFilings: false });
  });
});

function table(statement: "income" | "ratios", rows: Record<string, (number | null)[]>, options: { ttm?: boolean } = {}): StatementTable {
  const fiscal = [2025, 2024, 2023, 2022, 2021].map((year) => ({ id: `${year}-12-31`, label: `FY ${year}`, periodEnding: `${year}-12-31` }));
  return {
    statement,
    period: "annual",
    source: "fmp",
    currency: "USD",
    fiscalYear: null,
    columns: options.ttm === false ? fiscal : [{ id: "ttm", label: "TTM", periodEnding: "2026-09-30" }, ...fiscal],
    rows: Object.entries(rows).map(([id, values]) => ({ id, label: id, format: "money", emphasis: false, section: null, help: null, values })),
    chart: { title: "", labels: [], series: [], defaults: [] },
  };
}

describe("buildProjectionDefaults", () => {
  // Revenue grows 11% a year with a 60% gross and 20% operating margin, net income is 80% of pretax
  // income, and the share count falls every year. Values run TTM first, then fiscal 2025 back to 2021.
  const revenue = [1000, 1110, 1232.1, 1367.631, 1518.07041].reverse();
  const income = table("income", {
    revenue: [1600, ...revenue],
    costOfRevenue: [640, ...revenue.map((value) => value * 0.4)],
    operatingIncome: [320, ...revenue.map((value) => value * 0.2)],
    pretaxIncome: [330, ...revenue.map((value, index) => value * 0.2 + [10, 5, 5, 2, 0][index])],
    netIncome: [264, ...revenue.map((value, index) => (value * 0.2 + [10, 5, 5, 2, 0][index]) * 0.8)],
    shares: [89, 90, 92, 95, 97, 100],
    eps: [2.9, 2.79, 2.42, 2.12, 1.85, 1.6],
  });
  const ratios = table("ratios", { pe: [21, 20, 25, 15, 18, 30] });

  it("starts from the last fiscal year and shows the four before the projection", () => {
    const defaults = buildProjectionDefaults({ income, ratios, price: 58, shares: 88, today: new Date("2026-10-01T00:00:00Z") });

    expect(defaults.base).toMatchObject({ year: 2025, periodEnding: "2025-12-31", revenue: 1518.07041, operatingIncome: expect.closeTo(303.614), netIncome: expect.closeTo(250.891) });
    expect(defaults.years).toEqual([2026, 2027, 2028, 2029, 2030]);
    expect(defaults.start).toEqual({ price: 58, shares: 88 });
    expect(defaults.ttmEps).toBe(2.9);
    expect(defaults.mode).toBe("simple");

    expect(defaults.history.map((year) => year.year)).toEqual([2022, 2023, 2024, 2025]);
    const latest = defaults.history[3];
    expect(latest).toMatchObject({
      revenueGrowth: expect.closeTo(0.11),
      costGrowth: expect.closeTo(0.11),
      grossMargin: expect.closeTo(0.6),
      // Operating expenses are gross profit minus operating income; interest & other is pretax minus operating income.
      operatingExpenses: expect.closeTo(1518.07041 * 0.4),
      opexGrowth: expect.closeTo(0.11),
      other: expect.closeTo(10),
      otherGrowth: expect.closeTo(1),
      buybackYield: expect.closeTo(1 - 90 / 92),
      eps: 2.79,
      pe: 20,
    });
    // 2022's growth comes from fiscal 2021, which isn't shown; interest & other can't grow from zero.
    expect(defaults.history[0]).toMatchObject({ revenueGrowth: expect.closeTo(0.11), otherGrowth: null, buybackYield: expect.closeTo(0.03) });
  });

  it("fades revenue growth, holds margins, and spreads the scenarios around the base case", () => {
    const defaults = buildProjectionDefaults({ income, ratios, price: 58, shares: 88, today: new Date("2026-10-01T00:00:00Z") });
    const { base, bearish, ultraBullish } = defaults.scenarios;

    expect(base.revenueGrowth).toEqual([0.11, 0.1, 0.09, 0.08, 0.07]);
    expect(base.costGrowth).toEqual(base.revenueGrowth);
    expect(base.opexGrowth).toEqual(base.revenueGrowth);
    expect(base.netIncomeGrowth).toEqual(base.revenueGrowth);
    expect(base.otherGrowth).toEqual([0, 0, 0, 0, 0]);
    // Average buyback yield 2.6%; fiscal 2026 has three months left on October 1.
    expect(base.buybackYield).toEqual([0.006, 0.026, 0.026, 0.026, 0.026]);
    expect(defaults.notes.buybackYield).toMatch(/2026 only counts the 3 months still ahead/);
    // The lowest, median and highest P/E of the five fiscal years.
    expect([base.peLow[0], base.peMid[0], base.peHigh[0]]).toEqual([15, 20, 30]);
    expect(defaults.notes.pe).toBe("The lowest, median and highest P/E of fiscal 2021–2025.");

    expect(bearish.revenueGrowth).toEqual([0.06, 0.05, 0.04, 0.03, 0.02]);
    expect([bearish.peLow[0], bearish.peMid[0], bearish.peHigh[0]]).toEqual([12, 16, 24]);
    expect(ultraBullish.revenueGrowth[0]).toBeCloseTo(0.21);
    expect([ultraBullish.peLow[4], ultraBullish.peHigh[4]]).toEqual([21, 42]);
    expect(defaults.notes.revenueGrowth).toBe("The base case starts at 11.0%, the fiscal 2021–2025 compound revenue growth, and fades halfway to 3.0% by 2030.");

    const projection = projectScenario("advanced", defaults.base, defaults.start, base);
    expect(projection.ok && projection.years.map((year) => [year.grossMargin, year.operatingMargin])).toEqual(
      Array.from({ length: 5 }, () => [expect.closeTo(0.6), expect.closeTo(0.2)]),
    );
  });

  it("handles banks, losses and missing data", () => {
    const bank = table("income", {
      revenue: [1200, 1100, 1000],
      pretaxIncome: [-60, -50, 100],
      netIncome: [-50, -40, 75],
      shares: [10, 10, 10],
      eps: [-5, -4, 7.5],
    }, { ttm: false });
    const defaults = buildProjectionDefaults({ income: bank, ratios: null, price: 40, shares: null, today: new Date("2026-03-01T00:00:00Z") });

    // No cost of revenue: operating expenses are revenue minus operating income. No operating income
    // either: pretax income stands in for it, as on the reference American Express projection.
    expect(defaults.history.map((year) => year.costOfRevenue)).toEqual([null, null, null]);
    expect(defaults.history[2]).toMatchObject({ operatingIncome: -60, other: 0, operatingExpenses: 1260, opexGrowth: expect.closeTo(1260 / 1150 - 1) });
    expect(defaults.notes.costs).toMatch(/No cost of revenue is reported/);
    expect(defaults.notes.other).toMatch(/pretax income stands in/);
    expect(projectScenario("advanced", defaults.base, defaults.start, defaults.scenarios.base).ok).toBe(true);
    // A loss starts in Advanced mode, with a 21% tax since the last pretax income was negative.
    expect(defaults.mode).toBe("advanced");
    expect(defaults.notes.netIncome).toMatch(/21% tax rate/);
    // No P/E history or trailing EPS: a market-average guess. No share count today: the last fiscal year's.
    expect([defaults.scenarios.base.peLow[0], defaults.scenarios.base.peMid[0], defaults.scenarios.base.peHigh[0]]).toEqual([15, 20, 25]);
    expect(defaults.start.shares).toBe(10);
    expect(defaults.notes.shares).toMatch(/isn't available/);
    // No share count change: no buybacks.
    expect(defaults.scenarios.base.buybackYield).toEqual([0, 0, 0, 0, 0]);
  });

  it("caps runaway growth and uses today's P/E when there's no history", () => {
    const fast = table("income", {
      revenue: [600, 500, 100],
      netIncome: [60, 50, 10],
      shares: [10, 10, 10],
      eps: [6, 5, 1],
    });
    const defaults = buildProjectionDefaults({ income: fast, ratios: null, price: 120, shares: 10, today: new Date("2026-06-01T00:00:00Z") });
    expect(defaults.scenarios.base.revenueGrowth[0]).toBe(0.3);
    expect(defaults.notes.revenueGrowth).toMatch(/compound revenue growth of 400\.0%, capped/);
    // 120 ÷ TTM EPS of 6 = 20×, ± 20%.
    expect([defaults.scenarios.base.peLow[0], defaults.scenarios.base.peMid[0], defaults.scenarios.base.peHigh[0]]).toEqual([16, 20, 24]);
  });
});

describe("analysts' estimates", () => {
  const revenue = [1000, 1110, 1232.1, 1367.631, 1518.07041].reverse();
  const income = table("income", {
    revenue: [1600, ...revenue],
    costOfRevenue: [640, ...revenue.map((value) => value * 0.4)],
    operatingIncome: [320, ...revenue.map((value) => value * 0.2)],
    pretaxIncome: [330, ...revenue.map((value) => value * 0.2 + 10)],
    netIncome: [264, ...revenue.map((value) => (value * 0.2 + 10) * 0.8)],
    shares: [89, 90, 92, 95, 97, 100],
    eps: [2.9, 2.79, 2.42, 2.12, 1.85, 1.6],
  });
  const estimate = (date: string, revenueAvg: number | null, epsAvg: number | null): AnalystEstimate => ({
    date,
    revenue: { low: null, avg: revenueAvg, high: null },
    netIncome: { low: null, avg: null, high: null },
    eps: { low: null, avg: epsAvg, high: null },
    analysts: 12,
  });
  const estimates = [
    estimate("2025-12-31", 1500, 2.8),
    estimate("2026-12-31", 1700, 3.3),
    // A 52/53-week year ends a few days off; it still counts as fiscal 2027.
    estimate("2028-01-02", 1900, 3.8),
    estimate("2029-12-31", null, 5),
  ];
  const defaults = buildProjectionDefaults({ income, ratios: null, price: 58, shares: 88, estimates, today: new Date("2026-10-01T00:00:00Z") });

  it("lines each estimate up with its projected fiscal year", () => {
    expect(defaults.estimates.map((item) => item?.date ?? null)).toEqual(["2026-12-31", "2028-01-02", null, "2029-12-31", null]);
  });

  it("fits a scenario to the consensus in both modes, leaving the other years alone", () => {
    const original = defaults.scenarios.base;
    const fitted = fitToEstimates(defaults.base, defaults.start, original, defaults.estimates);

    const simple = projectScenario("simple", defaults.base, defaults.start, fitted);
    if (!simple.ok) throw new Error(simple.reason);
    expect(simple.years.map((year) => year.revenue).slice(0, 3)).toEqual([expect.closeTo(1700), expect.closeTo(1900), expect.closeTo(1900 * (1 + original.revenueGrowth[2]))]);
    // EPS on today's 88 shares: 3.30 and 3.80, then fiscal 2029's 5.00 without a revenue estimate.
    expect([simple.years[0].eps, simple.years[1].eps, simple.years[3].eps]).toEqual([expect.closeTo(3.3), expect.closeTo(3.8), expect.closeTo(5)]);
    expect(fitted.revenueGrowth[3]).toBe(original.revenueGrowth[3]);

    const advanced = projectScenario("advanced", defaults.base, defaults.start, fitted);
    if (!advanced.ok) throw new Error(advanced.reason);
    // Same EPS on the scenario's shrinking share count, with the gross margin held where there are estimates.
    expect([advanced.years[0].eps, advanced.years[1].eps, advanced.years[3].eps]).toEqual([expect.closeTo(3.3), expect.closeTo(3.8), expect.closeTo(5)]);
    expect(advanced.years.map((year) => year.grossMargin)).toEqual(Array.from({ length: 5 }, () => expect.closeTo(0.6)));
    expect(fitted.opexGrowth[2]).toBe(original.opexGrowth[2]);
    expect([fitted.peLow, fitted.buybackYield]).toEqual([original.peLow, original.buybackYield]);
  });
});

describe("scenariosFor", () => {
  it("shows bearish, base and bullish, or all five", () => {
    expect(scenariosFor(3).map(({ id }) => id)).toEqual(["bearish", "base", "bullish"]);
    expect(scenariosFor(5)).toHaveLength(5);
  });
});

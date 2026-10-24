import { describe, expect, it } from "vitest";
import type { StatementTable } from "./financial-statements";
import { buildProjectionDefaults, projectScenario, type ProjectionInputs, type ScenarioInputs } from "./three-year-projection";

const neutral: ScenarioInputs = { revenueGrowth: 0.1, netIncomeGrowth: 0.2, peLow: 10, peHigh: 20 };

function inputs(overrides: Partial<ProjectionInputs> = {}): ProjectionInputs {
  return {
    price: 100,
    revenue: 1000,
    netIncome: 100,
    shares: 10,
    scenarios: { ultraBearish: neutral, bearish: neutral, neutral, bullish: neutral, ultraBullish: neutral },
    ...overrides,
  };
}

function table(statement: "income" | "ratios", rows: Record<string, (number | null)[]>, ttm = true): StatementTable {
  const fiscal = [
    { id: "2025-09-27", label: "FY 2025", periodEnding: "2025-09-27" },
    { id: "2024-09-28", label: "FY 2024", periodEnding: "2024-09-28" },
    { id: "2023-09-30", label: "FY 2023", periodEnding: "2023-09-30" },
  ];
  return {
    statement,
    period: "annual",
    currency: "USD",
    fiscalYear: null,
    columns: ttm ? [{ id: "ttm", label: "TTM", periodEnding: "2026-06-27" }, ...fiscal] : fiscal,
    rows: Object.entries(rows).map(([id, values]) => ({ id, label: id, format: "money", emphasis: false, section: null, help: null, values })),
    chart: { title: "", labels: [], series: [], defaults: [] },
  };
}

describe("projectScenario", () => {
  it("matches the template: separate revenue and net income growth, EPS × low and high P/E", () => {
    const result = projectScenario(inputs(), neutral, 2025, 2026);
    if (!result.ok) throw new Error(result.reason);
    expect(result.rows.map((row) => row.year)).toEqual([2026, 2027, 2028, 2029, 2030]);

    // 2029: revenue 1000 × 1.1⁴, net income 100 × 1.2⁴ = 207.36, EPS 20.736 on the same 10 shares.
    const year = result.rows[3];
    expect(year.revenue).toBeCloseTo(1464.1);
    expect(year.netIncome).toBeCloseTo(207.36);
    expect(year.netMargin).toBeCloseTo(207.36 / 1464.1);
    expect(year.eps).toBeCloseTo(20.736);
    expect([year.priceLow, year.priceHigh]).toEqual([expect.closeTo(207.36), expect.closeTo(414.72)]);
    // Three years from 2026, as the template's 3-year CAGR.
    expect(year.yearsAhead).toBe(3);
    expect(year.annualReturnLow).toBeCloseTo(2.0736 ** (1 / 3) - 1);
    // 2030: EPS 24.8832 × 20 = 497.66, four years out.
    expect(result.rows[4].annualReturnHigh).toBeCloseTo((497.664 / 100) ** (1 / 4) - 1);
  });

  it("shows no return for years ending within a year, or without a price", () => {
    const result = projectScenario(inputs(), neutral, 2025, 2026);
    expect(result.ok && result.rows[0].annualReturnLow).toBeNull();
    const noPrice = projectScenario(inputs({ price: null }), neutral, 2025, 2026);
    expect(noPrice.ok && noPrice.rows[4].annualReturnHigh).toBeNull();
  });

  it("needs revenue, positive net income and shares", () => {
    expect(projectScenario(inputs({ revenue: 0 }), neutral, 2025, 2026)).toMatchObject({ ok: false });
    expect(projectScenario(inputs({ netIncome: -5 }), neutral, 2025, 2026)).toMatchObject({ ok: false, reason: expect.stringMatching(/loss/) });
    expect(projectScenario(inputs({ shares: null }), neutral, 2025, 2026)).toMatchObject({ ok: false });
  });
});

describe("buildProjectionDefaults", () => {
  const income = table("income", {
    revenue: [480, 466, 416, 383],
    netIncome: [130, 129, 112, 97],
    shares: [14.7, 14.75, 15, 15.8],
    revenueGrowth: [0.1, 0.12, 0.08, null],
    netIncomeGrowth: [0.05, 0.15, 0.1, null],
    profitMargin: [0.27, 0.277, 0.269, 0.253],
  });

  it("starts from the last fiscal year and builds five scenarios around the averages", () => {
    const ratios = table("ratios", { pe: [39.5, 34.1, 27.8, 30] });
    const defaults = buildProjectionDefaults({ income, ratios, price: 346, currentYear: 2026 });

    // Fiscal years only: TTM is left out.
    expect(defaults.baseYear).toBe(2025);
    expect(defaults.inputs).toMatchObject({ price: 346, revenue: 466, netIncome: 129, shares: 14.75 });
    expect(defaults.history.rows.map((row) => row.year)).toEqual(["2023", "2024", "2025"]);
    expect(defaults.history.average.revenueGrowth).toBeCloseTo(0.1);
    expect(defaults.history.average.netIncomeGrowth).toBeCloseTo(0.125);

    const { neutral: base, ultraBearish, ultraBullish } = defaults.inputs.scenarios;
    expect(base).toMatchObject({ revenueGrowth: expect.closeTo(0.1), netIncomeGrowth: expect.closeTo(0.125), peLow: 27.8, peHigh: 34.1 });
    expect(ultraBearish.revenueGrowth).toBeCloseTo(0);
    expect(ultraBullish.netIncomeGrowth).toBeCloseTo(0.225);
    expect([ultraBearish.peLow, ultraBullish.peHigh]).toEqual([expect.closeTo(27.8 * 0.6), expect.closeTo(34.1 * 1.4)]);
    expect(defaults.notes["neutral.peLow"]).toMatch(/lowest and highest P\/E of the last 3 fiscal years/);
  });

  it("falls back to today's P/E ± 20%, then to placeholders", () => {
    const flat = table("income", { revenue: [1000, 900, 800], netIncome: [100, 90, 80], shares: [10, 10, 10] }, false);
    const withPrice = buildProjectionDefaults({ income: flat, ratios: null, price: 200, currentYear: 2026 }).inputs.scenarios.neutral;
    expect([withPrice.peLow, withPrice.peHigh]).toEqual([16, 24]);
    // No growth rows: revenue falls back to 5% and net income to the revenue rate.
    expect([withPrice.revenueGrowth, withPrice.netIncomeGrowth]).toEqual([0.05, 0.05]);

    const losses = table("income", { revenue: [1000, 900, 800], netIncome: [-50, -40, -30], shares: [10, 10, 10] }, false);
    const placeholder = buildProjectionDefaults({ income: losses, ratios: null, price: null, currentYear: 2026 });
    expect([placeholder.inputs.scenarios.neutral.peLow, placeholder.inputs.scenarios.neutral.peHigh]).toEqual([15, 25]);
    expect(placeholder.notes.price).toMatch(/Type the current price/);
  });
});

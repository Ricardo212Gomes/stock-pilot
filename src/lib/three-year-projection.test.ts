import { describe, expect, it } from "vitest";
import type { StatementTable } from "./financial-statements";
import { buildProjectionDefaults, projectThreeYear, type ProjectionInputs } from "./three-year-projection";

function inputs(overrides: Partial<ProjectionInputs> = {}): ProjectionInputs {
  return {
    price: 100,
    revenue: 1000,
    shares: 10,
    years: 3,
    sharesChange: 0,
    targetReturn: 0.15,
    low: { revenueGrowth: 0, netMargin: 0.1, peRatio: 10 },
    high: { revenueGrowth: 0.1, netMargin: 0.2, peRatio: 20 },
    ...overrides,
  };
}

function table(statement: "income" | "ratios", rows: Record<string, (number | null)[]>, ttm = true): StatementTable {
  const fiscal = [{ id: "2025", label: "FY 2025", periodEnding: "2025-09-27" }, { id: "2023", label: "FY 2023", periodEnding: "2023-09-27" }];
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

describe("projectThreeYear", () => {
  it("matches a hand-calculated revenue × margin × P/E projection", () => {
    const result = projectThreeYear(inputs());
    if (!result.ok) throw new Error(result.reason);

    // Low: revenue flat at 1000, net income 100, EPS 10, price 100 → 0% a year.
    expect(result.low.price).toBeCloseTo(100);
    expect(result.low.annualReturn).toBeCloseTo(0);
    // High: revenue 1000 × 1.1³ = 1331, net income 266.2, EPS 26.62, price 532.4.
    expect(result.high.revenue).toBeCloseTo(1331);
    expect(result.high.eps).toBeCloseTo(26.62);
    expect(result.high.price).toBeCloseTo(532.4);
    expect(result.high.totalReturn).toBeCloseTo(4.324);
    expect(result.high.annualReturn).toBeCloseTo(532.4 ** (1 / 3) / 100 ** (1 / 3) - 1);
    // Paying 532.4 ÷ 1.15³ today earns exactly 15% a year.
    expect(result.high.buyBelow).toBeCloseTo(532.4 / 1.15 ** 3);
    expect(result.years.map((row) => row.year)).toEqual([1, 2, 3]);
    expect(result.years[0].high.revenue).toBeCloseTo(1100);
  });

  it("raises EPS when the share count shrinks", () => {
    const buybacks = projectThreeYear(inputs({ sharesChange: -0.05 }));
    if (!buybacks.ok) throw new Error(buybacks.reason);
    expect(buybacks.low.shares).toBeCloseTo(10 * 0.95 ** 3);
    expect(buybacks.low.eps).toBeCloseTo(100 / (10 * 0.95 ** 3));
  });

  it("shows no price for negative earnings and no return without a price", () => {
    const losses = projectThreeYear(inputs({ low: { revenueGrowth: 0, netMargin: -0.1, peRatio: 10 }, price: null }));
    if (!losses.ok) throw new Error(losses.reason);
    expect(losses.low.price).toBeNull();
    expect(losses.low.annualReturn).toBeNull();
    expect(losses.high.price).toBeCloseTo(532.4);
    expect(losses.high.annualReturn).toBeNull();
  });

  it("needs revenue and shares, and keeps the horizon between 1 and 10 years", () => {
    expect(projectThreeYear(inputs({ revenue: 0 }))).toMatchObject({ ok: false });
    expect(projectThreeYear(inputs({ shares: null }))).toMatchObject({ ok: false });
    const long = projectThreeYear(inputs({ years: 40 }));
    expect(long.ok && long.years).toHaveLength(10);
  });
});

describe("buildProjectionDefaults", () => {
  it("starts from TTM figures and historical growth, with the P/E range from history", () => {
    const income = table("income", { revenue: [466e9, 416e9, 383e9], netIncome: [129e9, 112e9, 97e9], shares: [14.75e9, 15e9, 15.8e9] });
    const ratios = table("ratios", { pe: [39.5, 34.1, 27.8] });
    const { inputs: defaults, notes } = buildProjectionDefaults({ income, ratios, price: 346 });

    expect(defaults).toMatchObject({ price: 346, revenue: 466e9, shares: 14.75e9, years: 3, targetReturn: 0.15 });
    expect(defaults.high.revenueGrowth).toBeCloseTo(416 / 383 - 1);
    expect(defaults.low.revenueGrowth).toBeCloseTo(defaults.high.revenueGrowth - 0.04);
    expect(defaults.high.netMargin).toBeCloseTo(129 / 466);
    expect(defaults.low.netMargin).toBeCloseTo(129 / 466 - 0.02);
    expect(defaults.sharesChange).toBeCloseTo(15 / 15.8 - 1);
    // Fiscal years only: the TTM P/E is left out of the range.
    expect([defaults.low.peRatio, defaults.high.peRatio]).toEqual([27.8, 34.1]);
    expect(notes["low.peRatio"]).toMatch(/Lowest P\/E of the last 2 fiscal years/);
  });

  it("falls back to today's P/E ± 20%, then to placeholders", () => {
    const income = table("income", { revenue: [1000, 900], netIncome: [100, 90], shares: [10, 10] }, false);
    const withPrice = buildProjectionDefaults({ income, ratios: null, price: 200 }).inputs;
    expect([withPrice.low.peRatio, withPrice.high.peRatio]).toEqual([16, 24]);

    const losses = table("income", { revenue: [1000, 900], netIncome: [-50, -40], shares: [10, 10] }, false);
    const placeholder = buildProjectionDefaults({ income: losses, ratios: null, price: null });
    expect([placeholder.inputs.low.peRatio, placeholder.inputs.high.peRatio]).toEqual([15, 25]);
    expect(placeholder.notes.price).toMatch(/Type the current price/);
  });
});

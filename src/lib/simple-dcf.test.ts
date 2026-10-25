import { describe, expect, it } from "vitest";
import type { StatementTable } from "./financial-statements";
import { buildDcfDefaults, calculateDcf, dcfSensitivityGrid, type DcfInputs } from "./simple-dcf";
import { parseDcfResponse } from "./simple-dcf-autofill";

function inputs(overrides: Partial<DcfInputs> = {}): DcfInputs {
  return {
    price: 100,
    freeCashFlow: 1000,
    shares: 100,
    cash: 500,
    debt: 200,
    growthEarly: 0,
    growthLate: 0,
    discountRate: 0.1,
    terminalMethod: "growth",
    terminalGrowth: 0,
    terminalMultiple: 15,
    marginOfSafety: 0.25,
    ...overrides,
  };
}

function table(statement: StatementTable["statement"], rows: Record<string, (number | null)[]>, firstLabel = "TTM"): StatementTable {
  return {
    statement,
    period: "annual",
    source: "fmp",
    currency: "USD",
    fiscalYear: null,
    columns: [
      { id: firstLabel === "TTM" ? "ttm" : "current", label: firstLabel, periodEnding: "2026-06-27" },
      { id: "2025", label: "FY 2025", periodEnding: "2025-09-27" },
      { id: "2023", label: "FY 2023", periodEnding: "2023-09-27" },
    ],
    rows: Object.entries(rows).map(([id, values]) => ({ id, label: id, format: "money", emphasis: false, section: null, help: null, values })),
    chart: { title: "", labels: [], series: [], defaults: [] },
  };
}

describe("calculateDcf", () => {
  it("values a flat cash flow as a perpetuity, plus cash minus debt", () => {
    // With no growth, ten years plus the terminal value equal 1000 ÷ 0.1 = 10,000.
    const result = calculateDcf(inputs());
    if (!result.ok) throw new Error(result.reason);
    expect(result.enterpriseValue).toBeCloseTo(10_000, 6);
    expect(result.equityValue).toBeCloseTo(10_300, 6);
    expect(result.valuePerShare).toBeCloseTo(103, 6);
    expect(result.upside).toBeCloseTo(0.03, 6);
    expect(result.buyBelow).toBeCloseTo(77.25, 6);
    expect(result.years).toHaveLength(10);
    expect(result.years[0].discountFactor).toBeCloseTo(1 / 1.1);
  });

  it("grows each stage at its own rate", () => {
    const result = calculateDcf(inputs({ growthEarly: 0.1, growthLate: 0.05 }));
    if (!result.ok) throw new Error(result.reason);
    expect(result.years[4].freeCashFlow).toBeCloseTo(1000 * 1.1 ** 5);
    expect(result.years[9].freeCashFlow).toBeCloseTo(1000 * 1.1 ** 5 * 1.05 ** 5);
  });

  it("uses an exit multiple of the final year's cash flow", () => {
    const result = calculateDcf(inputs({ terminalMethod: "multiple", terminalMultiple: 12 }));
    if (!result.ok) throw new Error(result.reason);
    expect(result.terminalValue).toBeCloseTo(12_000);
    expect(result.presentValueOfTerminal).toBeCloseTo(12_000 / 1.1 ** 10);
    expect(result.terminalShare).toBeCloseTo(result.presentValueOfTerminal / result.enterpriseValue);
  });

  it("explains inputs it can't value", () => {
    expect(calculateDcf(inputs({ freeCashFlow: -5 }))).toMatchObject({ ok: false, reason: expect.stringMatching(/positive free cash flow/) });
    expect(calculateDcf(inputs({ shares: 0 }))).toMatchObject({ ok: false });
    expect(calculateDcf(inputs({ discountRate: 0.02, terminalGrowth: 0.03 }))).toMatchObject({ ok: false, reason: expect.stringMatching(/higher than terminal growth/) });
    // An exit multiple has no such limit.
    expect(calculateDcf(inputs({ discountRate: 0.02, terminalGrowth: 0.03, terminalMethod: "multiple" })).ok).toBe(true);
  });
});

describe("dcfSensitivityGrid", () => {
  it("centres on the inputs and rises with growth, falls with the discount rate", () => {
    const grid = dcfSensitivityGrid(inputs({ growthEarly: 0.08 }));
    const base = calculateDcf(inputs({ growthEarly: 0.08 }));
    expect(grid.values[2][2]).toBeCloseTo(base.ok ? base.valuePerShare : NaN);
    expect(grid.values[2][4]!).toBeGreaterThan(grid.values[2][2]!);
    expect(grid.values[4][2]!).toBeLessThan(grid.values[2][2]!);
  });
});

describe("buildDcfDefaults", () => {
  it("starts from TTM free cash flow and the latest balance sheet", () => {
    const { inputs: defaults, notes } = buildDcfDefaults({
      income: table("income", { revenue: [466e9, 416e9, 383e9], shares: [14.75e9, 15e9, 15.8e9] }),
      cashFlow: table("cash-flow", { freeCashFlow: [136.7e9, 98.8e9, 99.6e9] }),
      balance: table("balance", { cashAndShortTerm: [62.4e9, 54.7e9, 61.6e9], totalDebt: [84.3e9, 112.4e9, 123.9e9] }, "Current"),
      price: 346,
    });
    expect(defaults).toMatchObject({ price: 346, freeCashFlow: 136.7e9, shares: 14.75e9, cash: 62.4e9, debt: 84.3e9, discountRate: 0.1 });
    expect(defaults.growthEarly).toBeCloseTo(416 / 383 - 1);
    expect(defaults.growthLate).toBeCloseTo((416 / 383 - 1) / 2);
    expect(notes.cash).toMatch(/latest quarter/);
  });

  it("keeps growth between 0% and 25% and handles missing statements", () => {
    const { inputs: defaults, notes } = buildDcfDefaults({
      income: table("income", { revenue: [900, 900, 100], shares: [10, 10, 10] }),
      cashFlow: null,
      balance: null,
      price: null,
    });
    expect(defaults.growthEarly).toBe(0.25);
    expect(defaults.growthLate).toBeCloseTo(0.125);
    expect(defaults).toMatchObject({ freeCashFlow: null, cash: 0, debt: 0 });
    expect(notes.freeCashFlow).toMatch(/Type it/);
  });
});

describe("parseDcfResponse", () => {
  it("rescales whole-number percentages and clamps every value to its range", () => {
    const parsed = parseDcfResponse(JSON.stringify({
      summary: "Solid cash generation.",
      assumptions: [
        { key: "discountRate", value: 9, rationale: "Average risk." },
        { key: "growthEarly", value: 0.9, rationale: "Fast." },
        { key: "terminalMultiple", value: 18, rationale: "Mature multiple." },
        { key: "terminalGrowth", value: 0.04, rationale: "Ok." },
        { key: "price", value: 1, rationale: "Ignored." },
      ],
    }));
    expect(parsed?.suggestions.discountRate?.value).toBeCloseTo(0.09);
    expect(parsed?.suggestions.growthEarly?.value).toBe(0.5);
    expect(parsed?.suggestions.terminalMultiple?.value).toBe(18);
    expect(parsed?.suggestions.terminalGrowth?.value).toBe(0.04);
    expect(Object.keys(parsed?.suggestions ?? {})).not.toContain("price");

    // The ranges alone keep terminal growth (at most 4%) below the discount rate (at least 5%).
    const clamped = parseDcfResponse(JSON.stringify({ summary: "", assumptions: [
      { key: "discountRate", value: 0.05, rationale: "" },
      { key: "terminalGrowth", value: 0.05, rationale: "" },
    ] }));
    expect(clamped?.suggestions.terminalGrowth?.value).toBe(0.04);
    expect(parseDcfResponse("nope")).toBeNull();
  });
});

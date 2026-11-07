import { describe, expect, it } from "vitest";
import type { StatementTable } from "./financial-statements";
import { buildDcfDefaults, calculateDcf, dcfSensitivityGrid, impliedDcfGrowth, type DcfInputs } from "./simple-dcf";
import { parseDcfResponse } from "./simple-dcf-autofill";

function inputs(overrides: Partial<DcfInputs> = {}): DcfInputs {
  return {
    price: 100,
    freeCashFlow: 1000,
    firstYearCashFlow: null,
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

describe("a year 1 forecast and the reverse DCF", () => {
  // The reference spreadsheet (amounts in millions): fiscal 2025 free cash flow $26,900, a 2026 forecast of
  // $48,000 growing 20% a year after it, a 9% discount rate and 3% perpetual growth.
  const sheet = inputs({
    price: 306,
    freeCashFlow: 26_900,
    firstYearCashFlow: 48_000,
    shares: 4_774,
    cash: 23_975,
    debt: 59_419,
    growthEarly: 0.2,
    growthLate: 0.2,
    discountRate: 0.09,
    terminalGrowth: 0.03,
  });

  it("reproduces the reference DCF", () => {
    const result = calculateDcf(sheet);
    if (!result.ok) throw new Error(result.reason);
    const whole = (values: number[]) => values.map((value) => Math.round(value));
    expect(whole(result.years.map((year) => year.freeCashFlow))).toEqual([48_000, 57_600, 69_120, 82_944, 99_533, 119_439, 143_327, 171_993, 206_391, 247_669]);
    expect(whole(result.years.map((year) => year.presentValue))).toEqual([44_037, 48_481, 53_373, 58_760, 64_689, 71_218, 78_405, 86_317, 95_028, 104_618]);
    expect(whole([result.terminalValue, result.presentValueOfTerminal, result.enterpriseValue, result.equityValue])).toEqual([4_251_659, 1_795_947, 2_500_873, 2_465_429]);
    expect(result.valuePerShare).toBeCloseTo(516.43, 2);
    expect(Math.round(result.upside! * 100)).toBe(69);
    // Its low and high cases: 15% and 25% growth.
    const at = (growth: number) => calculateDcf({ ...sheet, growthEarly: growth, growthLate: growth });
    expect([at(0.15), at(0.25)].map((low) => (low.ok ? Math.round(low.valuePerShare) : null))).toEqual([368, 720]);
  });

  it("finds the growth today's price implies, after the year 1 forecast", () => {
    const implied = impliedDcfGrowth(sheet);
    // 12.32%: the sheet shows 12.20%, where its goal seek stopped ($303.46, not $306).
    expect(implied?.beyond).toBeNull();
    expect(implied?.rate).toBeCloseTo(0.1232, 4);
    const check = calculateDcf({ ...sheet, growthEarly: implied!.rate, growthLate: implied!.rate });
    expect(check.ok && check.valuePerShare).toBeCloseTo(306, 6);
    // Growing today's $26,900 from year 1 instead takes 18.4% a year.
    expect(impliedDcfGrowth({ ...sheet, firstYearCashFlow: null })?.rate).toBeCloseTo(0.1844, 4);
  });

  it("says which side a price beyond −50% to +100% a year is on, and needs a price", () => {
    expect(impliedDcfGrowth({ ...sheet, price: 1_000_000 })).toEqual({ rate: 1, beyond: "above" });
    expect(impliedDcfGrowth({ ...sheet, price: 0.01 })).toEqual({ rate: -0.5, beyond: "below" });
    expect(impliedDcfGrowth({ ...sheet, price: null })).toBeNull();
  });

  it("can start from a forecast when today's free cash flow is negative", () => {
    expect(calculateDcf({ ...sheet, freeCashFlow: -500 }).ok).toBe(true);
    expect(calculateDcf({ ...sheet, firstYearCashFlow: -1 })).toMatchObject({ ok: false, reason: expect.stringMatching(/Year 1 free cash flow/) });
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
    expect(defaults.firstYearCashFlow).toBeNull();
    expect(notes.cash).toMatch(/latest quarter/);
  });

  it("lists free cash flow by fiscal year, oldest first, then TTM, with its compound growth", () => {
    const { history } = buildDcfDefaults({
      income: table("income", { revenue: [466e9, 416e9, 383e9], shares: [14.75e9, 15e9, 15.8e9] }),
      cashFlow: table("cash-flow", { freeCashFlow: [136.7e9, 121e9, 100e9], freeCashFlowGrowth: [null, 0.1, null] }),
      balance: null,
      price: 346,
    });
    expect(history.years).toEqual([
      { label: "2023", freeCashFlow: 100e9, growth: null },
      { label: "2025", freeCashFlow: 121e9, growth: 0.1 },
      { label: "TTM", freeCashFlow: 136.7e9, growth: null },
    ]);
    // Fiscal 2023 to 2025: two years.
    expect(history.cagr).toEqual({ rate: expect.closeTo(0.1, 6), from: 2023, to: 2025 });
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

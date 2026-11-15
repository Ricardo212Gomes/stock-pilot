import { describe, expect, it } from "vitest";
import { computeDcf, fcfHistory, growthPath, startingFcf, stockCompShare, type DcfBreakdown, type DcfResult } from "./dcf";
import { annual, assumptions } from "./test-fixtures";

function breakdown(result: DcfResult): DcfBreakdown {
  if (!result.ok) throw new Error(result.reason);
  return result.dcf;
}

describe("growthPath", () => {
  it("follows Simply Wall St's growth curve after the high-growth years", () => {
    // Amazon in February 2019: analysts' 14.8% in year 5, then 11.2%, 8.6%, 6.9%, 5.6% towards 2.73%.
    const path = growthPath(0.1477, 0.0273, 5);
    expect(path.slice(0, 5)).toEqual(Array(5).fill(0.1477));
    expect(path.slice(5).map((rate) => Math.round(rate * 1000) / 1000)).toEqual([0.112, 0.086, 0.069, 0.056, 0.048]);
  });

  it("holds the rate for ten high-growth years, and fades a fall up towards terminal growth", () => {
    expect(growthPath(0.2, 0.025, 10)).toEqual(Array(10).fill(0.2));
    const falling = growthPath(-0.1, 0.02, 1);
    expect(falling[1]).toBeCloseTo(0.02 - 0.12 * 0.7, 10);
    expect(falling[9]).toBeLessThan(0.02);
    expect(falling[9]).toBeGreaterThan(falling[1]);
  });
});

describe("computeDcf", () => {
  it("projects ten years, marks the stages and adds a perpetuity", () => {
    const dcf = breakdown(computeDcf(assumptions({ growthYears: 3 })));
    expect(dcf.years.map((year) => year.stage)).toEqual([...Array(3).fill("growth"), ...Array(7).fill("fade")]);
    const last = dcf.years[9];
    expect(dcf.terminalValue).toBeCloseTo((last.fcf * 1.02) / 0.06, 8);
    expect(dcf.value).toBeCloseTo(dcf.presentValueOfYears + dcf.presentValueOfTerminal, 8);
    // The cross-checks: the multiple the perpetuity amounts to, and growth ÷ ROE.
    expect(dcf.impliedMultiple).toBeCloseTo(1.02 / 0.06, 8);
    expect(dcf.impliedGrowth).toBe(0.02);
    expect(dcf.reinvestment).toBeCloseTo(0.02 / 0.12, 8);
  });

  it("starts from a year 1 forecast and grows the later years from it", () => {
    const dcf = breakdown(computeDcf(assumptions(), { firstYearFcf: 20, terminalMethod: "growth" }));
    expect(dcf.years[0]).toMatchObject({ stage: "forecast", growth: null, fcf: 20 });
    expect(dcf.years[1].fcf).toBeCloseTo(20 * 1.1, 8);
    expect(computeDcf(assumptions(), { firstYearFcf: 0, terminalMethod: "growth" })).toMatchObject({ ok: false });
  });

  it("values year 10 at an exit multiple, and says the growth that multiple implies", () => {
    const dcf = breakdown(computeDcf(assumptions({ terminalMultiple: 15 }), { firstYearFcf: null, terminalMethod: "multiple" }));
    expect(dcf.terminalValue).toBeCloseTo(dcf.years[9].fcf * 15, 8);
    // 15 = (1 + g) ÷ (0.08 − g) → g = (15 × 0.08 − 1) ÷ 16 = 1.25%.
    expect(dcf.impliedGrowth).toBeCloseTo(0.0125, 10);
    // A multiple needs no discount rate above terminal growth.
    expect(computeDcf(assumptions({ terminalGrowth: 0.09 }), { firstYearFcf: null, terminalMethod: "multiple" }).ok).toBe(true);
    expect(computeDcf(assumptions({ terminalMultiple: 0 }), { firstYearFcf: null, terminalMethod: "multiple" })).toMatchObject({ ok: false });
  });

  it("gives the terminal value's share, which grows with terminal growth", () => {
    const low = breakdown(computeDcf(assumptions({ terminalGrowth: 0 }))).terminalShare;
    const high = breakdown(computeDcf(assumptions({ terminalGrowth: 0.04 }))).terminalShare;
    expect(low).toBeGreaterThan(0.4);
    expect(high).toBeGreaterThan(low);
  });
});

describe("starting free cash flow", () => {
  // Newest first: a heavy investment year (capex 90) in the latest year.
  const financials = [
    annual({ fiscalYear: "2024", operatingCashFlow: 150, capitalExpenditure: -90, freeCashFlow: 60, stockBasedCompensation: 20 }),
    annual({ fiscalYear: "2023", operatingCashFlow: 140, capitalExpenditure: -30, freeCashFlow: 110, stockBasedCompensation: 15 }),
    annual({ fiscalYear: "2022", operatingCashFlow: 130, capitalExpenditure: -30, freeCashFlow: 100, stockBasedCompensation: 10 }),
  ];
  const history = fcfHistory(financials, null);

  it("smooths capital spending over three years and keeps stock-based pay per share", () => {
    // 100 shares: (150 − (90 + 30 + 30) ÷ 3) ÷ 100 = 1.
    expect(history[0]).toEqual({ fiscalYear: "2024", reported: 0.6, smoothed: 1, stockComp: 0.2 });
    expect(history[2].smoothed).toBeCloseTo(1, 10);
  });

  it("starts from either basis, with stock-based pay as a cost or not, or the average for cyclicals", () => {
    const base = { history, averageYears: false };
    expect(startingFcf(base, "reported", false)).toBeCloseTo(0.6, 10);
    expect(startingFcf(base, "reported", true)).toBeCloseTo(0.4, 10);
    expect(startingFcf(base, "smoothed", true)).toBeCloseTo(0.8, 10);
    expect(startingFcf({ history, averageYears: true }, "reported", false)).toBeCloseTo((0.6 + 1.1 + 1) / 3, 10);
    expect(startingFcf({ history: [], averageYears: false }, "reported", true)).toBeNull();
    expect(stockCompShare(base)).toBeCloseTo(0.2 / 0.6, 10);
  });
});

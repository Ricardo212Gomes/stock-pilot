import { describe, expect, it } from "vitest";
import { ASSUMPTION_SPECS } from "./assumptions";
import { buildDefaults, EQUITY_RISK_PREMIUM, FALLBACK_RISK_FREE_RATE, sharesOutstanding } from "./defaults";
import { annual, history, profile } from "./test-fixtures";

describe("sharesOutstanding", () => {
  it("prefers diluted shares, then market cap ÷ price", () => {
    expect(sharesOutstanding(annual({ sharesDiluted: 50 }), profile())).toBe(50);
    expect(sharesOutstanding(annual({ sharesDiluted: null }), profile({ marketCap: 3000, price: 30 }))).toBe(100);
    expect(sharesOutstanding(annual({ sharesDiluted: null }), null)).toBeNull();
  });
});

describe("buildDefaults", () => {
  it("derives per-share starting values from the latest year", () => {
    const { assumptions } = buildDefaults({ financials: history(0.05), profile: profile(), riskFreeRate: 0.05, type: "stable" });

    expect(assumptions.currentPrice).toBe(20);
    expect(assumptions.fcfPerShare).toBeCloseTo(1.2);
    expect(assumptions.epsPerShare).toBe(1);
    expect(assumptions.bookValuePerShare).toBeCloseTo(5);
    expect(assumptions.revenuePerShare).toBeCloseTo(10);
    expect(assumptions.payoutRatio).toBeCloseTo(0.3);
  });

  it("builds the discount rate with CAPM and clamps beta", () => {
    const rate = (beta: number | null) => buildDefaults({
      financials: history(0.05), profile: profile({ beta }), riskFreeRate: 0.05, type: "stable",
    }).assumptions.discountRate;

    expect(rate(1.2)).toBeCloseTo(0.05 + 1.2 * EQUITY_RISK_PREMIUM);
    expect(rate(0.1)).toBeCloseTo(0.05 + 0.6 * EQUITY_RISK_PREMIUM);
    expect(rate(null)).toBeCloseTo(0.05 + EQUITY_RISK_PREMIUM);
  });

  it("falls back to an assumed risk-free rate and says so", () => {
    const { assumptions, notes } = buildDefaults({ financials: history(0.05), profile: null, riskFreeRate: null, type: "stable" });
    expect(assumptions.discountRate).toBeCloseTo(FALLBACK_RISK_FREE_RATE + EQUITY_RISK_PREMIUM);
    expect(assumptions.currentPrice).toBeNull();
    expect(notes.discountRate).toMatch(/Treasury yield unavailable/);
    expect(notes.currentPrice).toMatch(/Type a price/);
  });

  it("blends revenue and EPS growth for the earnings growth default", () => {
    const financials = history(0.04).map((row, index) => ({ ...row, eps: 1 / 1.1 ** index }));
    const { assumptions, notes } = buildDefaults({ financials, profile: profile(), riskFreeRate: 0.04, type: "stable" });

    expect(assumptions.growthRate).toBeCloseTo(0.07);
    expect(notes.growthRate).toMatch(/revenue growth \(4\.0%\) and EPS growth \(10\.0%\)/);
  });

  it("caps growth by stock type and keeps terminal growth below the risk-free rate", () => {
    const financials = history(0.3).map((row, index) => ({ ...row, eps: 1 / 1.3 ** index }));
    const stable = buildDefaults({ financials, profile: profile(), riskFreeRate: 0.02, type: "stable" }).assumptions;
    const growth = buildDefaults({ financials, profile: profile(), riskFreeRate: 0.02, type: "highGrowth" }).assumptions;

    expect(stable.growthRate).toBeCloseTo(0.15);
    expect(growth.growthRate).toBeCloseTo(0.25);
    expect(growth.growthYears).toBe(10);
    expect(stable.revenueGrowth).toBeCloseTo(0.25);
    expect(stable.terminalGrowth).toBeCloseTo(0.02);
  });

  it("averages free cash flow across the cycle for cyclicals", () => {
    const financials = [200, 40, 120].map((freeCashFlow, index) => annual({ fiscalYear: String(2024 - index), freeCashFlow }));
    const { assumptions, notes } = buildDefaults({ financials, profile: profile(), riskFreeRate: 0.04, type: "cyclical" });

    expect(assumptions.fcfPerShare).toBeCloseTo(1.2);
    expect(assumptions.marginOfSafety).toBe(0.35);
    expect(notes.fcfPerShare).toMatch(/Average/);
  });

  it("keeps the exit P/E between 8× and 25×", () => {
    const exitPe = (peRatio: number | null) => buildDefaults({
      financials: [annual({ peRatio })], profile: profile(), riskFreeRate: 0.04, type: "stable",
    }).assumptions.exitPe;

    expect(exitPe(60)).toBe(25);
    expect(exitPe(4)).toBe(8);
    expect(exitPe(null)).toBe(15);
  });

  it("returns every assumption within its allowed range, with a note", () => {
    const { assumptions, notes } = buildDefaults({ financials: history(0.08), profile: profile(), riskFreeRate: 0.045, type: "dividend" });
    for (const spec of ASSUMPTION_SPECS) {
      const value = assumptions[spec.key];
      expect(notes[spec.key], spec.key).toBeTruthy();
      if (value === null) continue;
      expect(value, spec.key).toBeGreaterThanOrEqual(spec.min);
      expect(value, spec.key).toBeLessThanOrEqual(spec.max);
    }
  });
});

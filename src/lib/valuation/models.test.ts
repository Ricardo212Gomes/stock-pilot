import { describe, expect, it } from "vitest";
import {
  applyScenario,
  blendedValue,
  dcfSensitivity,
  discountedCashFlow,
  dividendDiscount,
  earningsMultiple,
  grahamFormula,
  impliedGrowth,
  projectionRows,
  residualIncome,
  revenueMargin,
  runAllModels,
  scenarioRange,
  verdict,
  type ModelResult,
} from "./models";
import { assumptions } from "./test-fixtures";

function valueOf(result: ModelResult): number {
  if (!result.ok) throw new Error(`expected a value, got: ${result.reason}`);
  return result.value;
}

describe("discountedCashFlow", () => {
  it("matches a hand-calculated two-stage DCF", () => {
    // FCF 10 → 11 → 12.1, terminal 12.1 × 1.02 ÷ (0.08 − 0.02) = 205.7
    const expected = 11 / 1.08 + 12.1 / 1.08 ** 2 + 205.7 / 1.08 ** 2;
    const result = discountedCashFlow(assumptions({ growthYears: 2 }));

    expect(valueOf(result)).toBeCloseTo(expected, 6);
    expect(result.ok && result.steps.at(-1)?.value).toBeCloseTo((205.7 / 1.08 ** 2) / expected, 6);
  });

  it("refuses non-positive cash flow and a discount rate at or below terminal growth", () => {
    expect(discountedCashFlow(assumptions({ fcfPerShare: -1 }))).toMatchObject({ ok: false });
    expect(discountedCashFlow(assumptions({ fcfPerShare: null }))).toMatchObject({ ok: false });
    expect(discountedCashFlow(assumptions({ discountRate: 0.02, terminalGrowth: 0.02 }))).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/higher than terminal growth/),
    });
  });

  it("rises with growth and falls with the discount rate", () => {
    const base = valueOf(discountedCashFlow(assumptions()));
    expect(valueOf(discountedCashFlow(assumptions({ growthRate: 0.15 })))).toBeGreaterThan(base);
    expect(valueOf(discountedCashFlow(assumptions({ discountRate: 0.1 })))).toBeLessThan(base);
  });
});

describe("dividendDiscount", () => {
  it("reduces to the Gordon growth model with no high-growth premium", () => {
    // With dividend growth equal to terminal growth, value = D₀ × (1 + g) ÷ (r − g).
    const result = dividendDiscount(assumptions({ dividendGrowth: 0.02, terminalGrowth: 0.02 }));
    expect(valueOf(result)).toBeCloseTo((2 * 1.02) / 0.06, 6);
  });

  it("needs a dividend", () => {
    expect(dividendDiscount(assumptions({ dividendPerShare: 0 }))).toMatchObject({ ok: false });
  });
});

describe("earningsMultiple", () => {
  it("discounts the exit price and the dividends collected", () => {
    // EPS 5 → 5.5; dividend 5.5 × 0.2 = 1.1; exit 5.5 × 20 = 110; at 10%: 1 + 100.
    const result = earningsMultiple(assumptions({ growthYears: 1, payoutRatio: 0.2, exitPe: 20, discountRate: 0.1 }));
    expect(valueOf(result)).toBeCloseTo(101, 6);
  });

  it("needs positive EPS", () => {
    expect(earningsMultiple(assumptions({ epsPerShare: -0.5 }))).toMatchObject({ ok: false });
  });
});

describe("revenueMargin", () => {
  it("values future earnings from revenue and a target margin", () => {
    // Revenue 10 → 14.4 over 2 years; EPS 1.44; price 28.8; ÷ 1.1².
    const result = revenueMargin(assumptions({
      revenuePerShare: 10, revenueGrowth: 0.2, growthYears: 2, targetNetMargin: 0.1, exitPe: 20, discountRate: 0.1,
    }));
    expect(valueOf(result)).toBeCloseTo(28.8 / 1.21, 6);
  });

  it("needs revenue and a positive target margin", () => {
    expect(revenueMargin(assumptions({ revenuePerShare: 0 }))).toMatchObject({ ok: false });
    expect(revenueMargin(assumptions({ targetNetMargin: 0 }))).toMatchObject({ ok: false });
  });
});

describe("residualIncome", () => {
  it("equals book value when ROE matches the required return", () => {
    expect(valueOf(residualIncome(assumptions({ returnOnEquity: 0.08 })))).toBeCloseTo(40, 6);
  });

  it("adds value above book only when ROE beats the discount rate", () => {
    expect(valueOf(residualIncome(assumptions({ returnOnEquity: 0.14 })))).toBeGreaterThan(40);
    expect(valueOf(residualIncome(assumptions({ returnOnEquity: 0.04 })))).toBeLessThan(40);
  });

  it("matches the justified price-to-book formula when ROE and growth are constant", () => {
    // With retention × ROE = terminal growth, value = Book × (ROE − g) ÷ (r − g).
    const roe = 0.12;
    const g = 0.03;
    const result = residualIncome(assumptions({
      returnOnEquity: roe, payoutRatio: 1 - g / roe, terminalGrowth: g, discountRate: 0.09,
    }));
    expect(valueOf(result)).toBeCloseTo(40 * (roe - g) / (0.09 - g), 6);
  });

  it("needs positive book value and a discount rate above terminal growth", () => {
    expect(residualIncome(assumptions({ bookValuePerShare: -5 }))).toMatchObject({ ok: false });
    expect(residualIncome(assumptions({ discountRate: 0.02 }))).toMatchObject({ ok: false });
  });
});

describe("grahamFormula", () => {
  it("applies V = EPS × (8.5 + 2g) × 4.4 ÷ Y", () => {
    expect(valueOf(grahamFormula(assumptions({ epsPerShare: 2, growthRate: 0.05, bondYield: 0.044 })))).toBeCloseTo(37, 6);
  });

  it("caps growth at 15% and floors it at zero", () => {
    expect(valueOf(grahamFormula(assumptions({ epsPerShare: 2, growthRate: 0.3, bondYield: 0.044 })))).toBeCloseTo(77, 6);
    expect(valueOf(grahamFormula(assumptions({ epsPerShare: 2, growthRate: -0.1, bondYield: 0.044 })))).toBeCloseTo(17, 6);
  });
});

describe("scenarios", () => {
  it("leaves the base case unchanged", () => {
    const base = assumptions();
    expect(applyScenario(base, "base")).toBe(base);
  });

  it("moves assumptions against the stock in the bear case and for it in the bull case", () => {
    const base = assumptions();
    const bear = applyScenario(base, "bear");
    const bull = applyScenario(base, "bull");

    expect(bear.growthRate).toBeCloseTo(0.07);
    expect(bull.growthRate).toBeCloseTo(0.13);
    expect(bear.discountRate).toBeCloseTo(0.09);
    expect(bull.exitPe).toBeCloseTo(18);
    expect(bear.fcfPerShare).toBe(base.fcfPerShare);
  });

  it("orders the range bear ≤ base ≤ bull for every available model", () => {
    for (const id of ["dcf", "earnings", "revenue", "ddm", "residualIncome", "graham"] as const) {
      const range = scenarioRange(id, assumptions());
      expect(range.bear).not.toBeNull();
      expect(range.bear!).toBeLessThanOrEqual(range.base!);
      expect(range.base!).toBeLessThanOrEqual(range.bull!);
    }
  });
});

describe("impliedGrowth", () => {
  it("recovers the growth rate that produced the price", () => {
    const price = valueOf(discountedCashFlow(assumptions({ growthRate: 0.07 })));
    expect(impliedGrowth(assumptions({ currentPrice: price }))).toBeCloseTo(0.07, 6);
  });

  it("returns null without a price or outside the search range", () => {
    expect(impliedGrowth(assumptions({ currentPrice: null }))).toBeNull();
    expect(impliedGrowth(assumptions({ currentPrice: 1e12 }))).toBeNull();
  });
});

describe("dcfSensitivity", () => {
  it("centres on the base inputs and marks impossible cells as null", () => {
    const grid = dcfSensitivity(assumptions({ discountRate: 0.035, terminalGrowth: 0.02 }));
    expect(grid.values[2][2]).toBeCloseTo(valueOf(discountedCashFlow(assumptions({ discountRate: 0.035 }))), 6);
    // 1.5% discount rate with 2.5%+ terminal growth has no finite value.
    expect(grid.values[0][4]).toBeNull();
  });
});

describe("projectionRows", () => {
  it("grows each starting value at its own rate", () => {
    const rows = projectionRows(assumptions({ growthYears: 2, dividendPerShare: null }));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ year: 0, epsPerShare: 5, fcfPerShare: 10, dividendPerShare: null });
    expect(rows[2].epsPerShare).toBeCloseTo(5 * 1.1 ** 2);
    expect(rows[2].revenuePerShare).toBeCloseTo(50 * 1.1 ** 2);
  });
});

describe("verdict", () => {
  it("compares value, buy price and current price", () => {
    expect(verdict(200, assumptions())).toEqual({ upside: 1, buyBelow: 150, label: "Below buy price" });
    expect(verdict(110, assumptions())?.label).toBe("Undervalued, thin margin");
    expect(verdict(80, assumptions())?.label).toBe("Above estimate");
    expect(verdict(80, assumptions({ currentPrice: null }))).toBeNull();
  });
});

describe("blendedValue", () => {
  it("weights recommended models twice and skips unavailable ones", () => {
    const results = runAllModels(assumptions({ dividendPerShare: 0 }));
    const dcf = valueOf(results.dcf);
    const graham = valueOf(results.graham);

    const blended = blendedValue(results, ["dcf", "ddm"], ["graham"]);
    expect(blended?.used).toEqual(["dcf", "graham"]);
    expect(blended?.value).toBeCloseTo((dcf * 2 + graham) / 3, 6);
  });

  it("returns null when nothing can run", () => {
    const results = runAllModels(assumptions({ dividendPerShare: 0 }));
    expect(blendedValue(results, ["ddm"], [])).toBeNull();
  });
});

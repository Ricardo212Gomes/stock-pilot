import { describe, expect, it } from "vitest";
import { classifyStock, compoundGrowth, STOCK_TYPES } from "./classify";
import { MODEL_ORDER } from "./models";
import { annual, history, profile } from "./test-fixtures";

describe("compoundGrowth", () => {
  it("annualizes growth from the oldest to the newest value", () => {
    expect(compoundGrowth([121, 110, 100])).toBeCloseTo(0.1, 10);
    expect(compoundGrowth([121, null, 100])).toBeCloseTo(0.21, 10);
  });

  it("needs two positive endpoints", () => {
    expect(compoundGrowth([100])).toBeNull();
    expect(compoundGrowth([100, -5])).toBeNull();
  });
});

describe("classifyStock", () => {
  it("detects banks and insurers from FMP sector and industry", () => {
    expect(classifyStock(history(0.04), profile({ sector: "Financial Services", industry: "Banks - Diversified" })).type).toBe("financial");
    expect(classifyStock(history(0.04), profile({ sector: "Financial Services", industry: "Insurance - Property & Casualty" })).type).toBe("financial");
  });

  it("detects REITs", () => {
    expect(classifyStock(history(0.04), profile({ sector: "Real Estate", industry: "REIT - Retail" })).type).toBe("reit");
  });

  it("puts loss-making companies first, ahead of growth", () => {
    const financials = history(0.4, { netIncome: -50, eps: -0.5 });
    expect(classifyStock(financials, profile()).type).toBe("unprofitable");
  });

  it("detects cyclicals by sector or by swinging earnings", () => {
    expect(classifyStock(history(0.04), profile({ sector: "Energy", industry: "Oil & Gas Integrated" })).type).toBe("cyclical");

    const swings = [10, 200, 30, 180, 20].map((netIncome, index) => annual({ fiscalYear: String(2024 - index), netIncome }));
    const result = classifyStock(swings, profile());
    expect(result.type).toBe("cyclical");
    expect(result.reasons[0]).toMatch(/swung/);
  });

  it("treats fast growth with soaring earnings as growth, not a cycle", () => {
    const financials = history(0.5).map((row, index) => ({ ...row, netIncome: 1000 / 2.5 ** index }));
    expect(classifyStock(financials, profile({ industry: "Semiconductors" })).type).toBe("highGrowth");
  });

  it("detects high growth and dividend payers", () => {
    expect(classifyStock(history(0.2), profile()).type).toBe("highGrowth");
    expect(classifyStock(history(0.03, { dividendYield: 0.04 }), profile()).type).toBe("dividend");
  });

  it("falls back to a stable compounder, also without a profile", () => {
    const result = classifyStock(history(0.06), null);
    expect(result.type).toBe("stable");
    expect(result.reasons.join(" ")).toMatch(/6\.0%/);
  });
});

describe("STOCK_TYPES", () => {
  it("recommends only known models, each once", () => {
    for (const info of Object.values(STOCK_TYPES)) {
      const models = [...info.primary, ...info.secondary];
      expect(info.primary.length).toBeGreaterThan(0);
      expect(new Set(models).size).toBe(models.length);
      for (const id of models) expect(MODEL_ORDER).toContain(id);
    }
  });
});

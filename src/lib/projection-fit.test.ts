import { describe, expect, it } from "vitest";
import { recommendProjection } from "./projection-fit";
import type { StockType } from "./valuation/classify";

const fit = (type: StockType, buybackYield: number | null = null, dividendYield: number | null = null) =>
  recommendProjection({ type, reasons: [] }, { buybackYield, dividendYield });

describe("recommendProjection", () => {
  it("sends growth stocks and banks to Jeremy's Projection", () => {
    expect(fit("highGrowth").tool).toBe("jeremy-projection");
    expect(fit("financial")).toMatchObject({ tool: "jeremy-projection", reason: expect.stringMatching(/residual income/) });
  });

  it("sends mature, dividend, cyclical and loss-making companies to the Plumas Projection", () => {
    expect(fit("dividend", null, 0.031)).toMatchObject({ tool: "plumas-projection", reason: expect.stringMatching(/add the 3\.1% yield/) });
    expect(fit("cyclical").tool).toBe("plumas-projection");
    expect(fit("unprofitable")).toMatchObject({ tool: "plumas-projection", reason: expect.stringMatching(/can't run/) });
  });

  it("splits stable companies on buybacks, and points REITs to the dividend model", () => {
    expect(fit("stable", 0.025)).toMatchObject({ tool: "plumas-projection", reason: expect.stringMatching(/about 2\.5% of its shares/) });
    expect(fit("stable", 0.004).tool).toBe("jeremy-projection");
    expect(fit("stable").tool).toBe("jeremy-projection");
    expect(fit("reit").tool).toBe("intrinsic-value");
  });
});

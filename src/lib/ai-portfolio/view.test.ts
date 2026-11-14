import { describe, expect, it } from "vitest";
import { buildHistory } from "./view";

const day = (date: string, adjClose: number) => ({ date, close: adjClose, adjClose, splitFactor: 1, divCash: 0 });

describe("buildHistory", () => {
  it("measures the account and SPY from the account's first day, carrying SPY over days it didn't trade", () => {
    const history = buildHistory(
      [
        { date: "2026-11-10", equity: 100_000 },
        { date: "2026-11-11", equity: 102_000 },
        { date: "2026-11-12", equity: 101_000 },
      ],
      [day("2026-11-07", 600), day("2026-11-10", 610), day("2026-11-12", 622.2)],
    );
    expect(history).toEqual([
      { date: "2026-11-10", value: 100_000, cost: 100_000, growth: 1, benchmark: 1 },
      { date: "2026-11-11", value: 102_000, cost: 100_000, growth: 1.02, benchmark: 1 },
      { date: "2026-11-12", value: 101_000, cost: 100_000, growth: 1.01, benchmark: 622.2 / 610 },
    ]);
  });

  it("leaves the S&P 500 out without its prices", () => {
    expect(buildHistory([{ date: "2026-11-10", equity: 100 }], null)).toEqual([{ date: "2026-11-10", value: 100, cost: 100, growth: 1, benchmark: null }]);
    expect(buildHistory([], null)).toEqual([]);
  });
});

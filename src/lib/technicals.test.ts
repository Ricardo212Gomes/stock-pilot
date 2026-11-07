import { describe, expect, it } from "vitest";
import { priceTrend, rsi, sma } from "./technicals";

describe("sma", () => {
  it("averages the last values, and needs enough of them", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toBe(4);
    expect(sma([1, 2], 3)).toBeNull();
  });
});

describe("rsi", () => {
  // StockCharts' worked example; its table rounds the first averages, so it reads 70.53 and 66.32.
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];

  it("matches Wilder's method", () => {
    expect(rsi(closes)).toBeCloseTo(70.5, 0);
    expect(rsi([...closes, 46.0])).toBeCloseTo(66.3, 0);
  });

  it("handles flat and one-way prices", () => {
    expect(rsi(Array(20).fill(10))).toBe(50);
    expect(rsi(Array.from({ length: 20 }, (_, index) => 10 + index))).toBe(100);
    expect(rsi([1, 2, 3])).toBeNull();
  });
});

describe("priceTrend", () => {
  it("reads the averages, range and three-month change from closes in any order", () => {
    // 300 sessions rising by 1 a day from 100, newest first as FMP sends them.
    const points = Array.from({ length: 300 }, (_, index) => ({
      date: new Date(Date.UTC(2025, 0, 1) + index * 86_400_000).toISOString().slice(0, 10),
      close: 100 + index,
    })).reverse();
    const trend = priceTrend(points)!;
    expect(trend.close).toBe(399);
    expect(trend.date).toBe("2025-10-27");
    expect(trend.sma60).toBeCloseTo(369.5);
    expect(trend.sma200).toBeCloseTo(299.5);
    expect(trend.high52).toBe(399);
    expect(trend.low52).toBe(148);
    expect(trend.return3m).toBeCloseTo(399 / 336 - 1);
    expect(trend.rsi14).toBe(100);
  });

  it("is null without closes", () => {
    expect(priceTrend([])).toBeNull();
  });
});

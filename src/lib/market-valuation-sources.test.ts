import { describe, expect, it } from "vitest";
import { buffettIndicator, monthEnds, parseShiller, parseSiblis, shillerLink, shillerMonth } from "./market-valuation-sources";

describe("Shiller's dataset", () => {
  it("reads decimal months: 2026.01 is January, 2026.1 is October", () => {
    expect(shillerMonth(2026.01)).toBe("2026-01-31");
    expect(shillerMonth(2026.1)).toBe("2026-10-31");
    expect(shillerMonth(2024.02)).toBe("2024-02-29");
    expect(shillerMonth(2026.13)).toBeNull();
    expect(shillerMonth(NaN)).toBeNull();
  });

  const header = ["Date", "P", "D", "E", "CPI", "Date  ", "Rate GS10", "Real", "Real", "Real", "Real", "TR", "CAPE"];
  const row = (date: number, price: number, dividend: number | null, earnings: number | null, rate: number, cape: number | string) =>
    [date, price, dividend, earnings, 300, date, rate, 0, 0, 0, 0, 0, cape];

  it("finds the columns by header and works out P/E and the yields", () => {
    const rows = [
      ["Stock Market Data Used in \"Irrational Exuberance\""],
      header,
      row(2025.12, 6800, 80, 240, 4.1, 39.5),
      row(2026.01, 7000, 70, 250, 4.2, 40),
      // Past the last earnings: only the price, the rate and CAPE.
      row(2026.02, 7100, null, null, 4.3, 40.5),
      // Shiller's notes under the data.
      [null, "Oct price is Oct 2nd close"],
    ];
    const series = Object.fromEntries(parseShiller(rows as never).map((item) => [item.metric, item.points]));
    expect(series.pe).toEqual([
      { date: "2025-12-31", value: 28.33, provisional: true },
      { date: "2026-01-31", value: 28, provisional: true },
    ]);
    expect(series.earnings_yield[1]).toEqual({ date: "2026-01-31", value: 3.571, provisional: true });
    expect(series.dividend_yield[1]).toEqual({ date: "2026-01-31", value: 1, provisional: true });
    expect(series.cape.map((point) => point.value)).toEqual([39.5, 40, 40.5]);
    expect(series.ten_year.at(-1)).toEqual({ date: "2026-02-28", value: 4.3 });
    expect(series.price).toHaveLength(3);
  });

  it("marks only the last six months with earnings as provisional, and skips CAPE's NA", () => {
    const rows = [header, ...Array.from({ length: 10 }, (_, index) => row(2020 + (index + 1) / 100, 100, 1, 5, 2, index < 2 ? "NA" : 20))];
    const series = Object.fromEntries(parseShiller(rows as never).map((item) => [item.metric, item.points]));
    expect(series.pe.filter((point) => point.provisional)).toHaveLength(6);
    expect(series.pe[3].provisional).toBeUndefined();
    expect(series.cape).toHaveLength(8);
  });

  it("fails when a column is missing", () => {
    expect(() => parseShiller([["Date", "P", "D"]] as never)).toThrow(/missing a column/);
    expect(() => parseShiller([["nothing"]] as never)).toThrow(/no header row/);
  });

  it("finds the download link on Shiller's page", () => {
    expect(shillerLink('<a href="//img1.wsimg.com/blobby/go/x/downloads/y/ie_data.xls?ver=17&amp;a=1">Data</a>')).toBe(
      "https://img1.wsimg.com/blobby/go/x/downloads/y/ie_data.xls?ver=17&a=1",
    );
    expect(shillerLink('<a href="/other.xls">x</a>')).toBeNull();
  });
});

describe("Siblis", () => {
  it("reads the snapshots and drops empty values", () => {
    const payload = {
      ticker: "NDX",
      data: [
        { "trading_day (EOD)": "2025-12-31", value: 32.32 },
        { "trading_day (EOD)": "2026-06-30", value: null },
        { "trading_day (EOD)": "bad", value: 30 },
        { "trading_day (EOD)": "2026-09-30", value: 35.09 },
      ],
    };
    expect(parseSiblis(payload)).toEqual([
      { date: "2025-12-31", value: 32.32 },
      { date: "2026-09-30", value: 35.09 },
    ]);
    expect(() => parseSiblis({ error: "ticker_not_in_free_tier" })).toThrow(/without data/);
  });
});

describe("FRED series", () => {
  it("keeps each month's last value", () => {
    expect(monthEnds([
      { date: "2026-10-30", value: 1 },
      { date: "2026-10-31", value: 2 },
      { date: "2026-11-12", value: 3 },
      { date: "2026-11-13", value: 4 },
    ])).toEqual([
      { date: "2026-10-31", value: 2 },
      { date: "2026-11-13", value: 4 },
    ]);
  });

  it("divides the stock market's value (millions) by GDP (billions), dated at the quarter's end", () => {
    expect(buffettIndicator(
      [{ date: "2026-01-01", value: 66_000_000 }, { date: "2026-04-01", value: 83_000_000 }],
      [{ date: "2026-04-01", value: 33_000 }],
    )).toEqual([{ date: "2026-06-30", value: 251.52 }]);
  });
});

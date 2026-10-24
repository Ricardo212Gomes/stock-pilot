import { describe, expect, it } from "vitest";
import stocks from "@/data/us-stocks.json";
import { indexStocks, normalizeSearch, searchStocks, type StockEntry } from "./stock-search";

const index = indexStocks([
  ["AAPL", "Apple Inc.", 0],
  ["APLE", "Apple Hospitality REIT, Inc.", 0],
  ["APP", "Applovin Corporation", 0],
  ["KO", "Coca-Cola Company", 0],
  ["COKE", "Coca-Cola Consolidated, Inc.", 0],
  ["GOOGL", "Alphabet Inc.", 0],
  ["GOOG", "Alphabet Inc.", 0],
  ["BRK-B", "Berkshire Hathaway Inc.", 0],
  ["NVDA", "NVIDIA Corporation", 0],
  ["NVDS", "Nvidia Small Example Inc.", 2],
  ["T", "AT&T Inc.", 0],
]);
const symbols = (query: string) => searchStocks(index, query).map((match) => match.symbol);

describe("searchStocks", () => {
  it("finds companies by name, ignoring case and punctuation", () => {
    expect(normalizeSearch("Coca-Cola Co.")).toBe("cocacolaco");
    expect(symbols("nvidia")).toEqual(["NVDA", "NVDS"]);
    expect(symbols("coca cola")).toEqual(["KO", "COKE"]);
  });

  it("puts an exact ticker first, and shorter names and larger exchanges before others", () => {
    expect(symbols("t")[0]).toBe("T");
    expect(symbols("app")).toEqual(["APP", "AAPL", "APLE"]);
    expect(symbols("apple")).toEqual(["AAPL", "APLE"]);
    expect(symbols("brk.b")).toEqual(["BRK-B"]);
  });

  it("knows brands listed under another name, and returns nothing for gibberish", () => {
    expect(symbols("Google")).toEqual(["GOOGL", "GOOG"]);
    expect(symbols("berkshire")).toEqual(["BRK-B"]);
    expect(symbols("xyzzyq")).toEqual([]);
    expect(symbols("   ")).toEqual([]);
  });

  it("works on the bundled list of US stocks", () => {
    const full = indexStocks(stocks as StockEntry[]);
    expect(full.length).toBeGreaterThan(4000);
    for (const [query, symbol] of [["nvidia", "NVDA"], ["microsoft", "MSFT"], ["amazon", "AMZN"], ["tesla", "TSLA"]]) {
      expect(searchStocks(full, query)[0]?.symbol).toBe(symbol);
    }
  });
});

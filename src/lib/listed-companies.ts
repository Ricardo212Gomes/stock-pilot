import stocks from "@/data/us-stocks.json";

// Company names from the bundled US stock list (src/data/us-stocks.json), for headings when a
// provider has no quote. Only server code imports this, so the list stays out of page bundles.
const names = new Map((stocks as [string, string, number][]).map(([symbol, name]) => [symbol, name]));

export function listedName(symbol: string): string | null {
  return names.get(symbol) ?? null;
}

// Company search over the bundled US stock list (src/data/us-stocks.json), run in the browser.

// [symbol, name, tier]: tier 0 is Nasdaq Global Select or NYSE, used to break ties.
export type StockEntry = [string, string, number];
export type StockMatch = { symbol: string; name: string };

type IndexedStock = { symbol: string; name: string; tier: number; flat: string; words: string[] };

export const SEARCH_LIMIT = 8;

// Brands whose listed company has another name.
const BRAND_ALIASES: Record<string, string[]> = {
  google: ["GOOGL", "GOOG"],
  youtube: ["GOOGL"],
  facebook: ["META"],
  instagram: ["META"],
  whatsapp: ["META"],
  coke: ["KO"],
  tsmc: ["TSM"],
  berkshire: ["BRK-B", "BRK-A"],
  jpmorgan: ["JPM"],
  snapchat: ["SNAP"],
};

// Lower case letters and digits only, so "Coca-Cola" and "coca cola" compare equal.
export function normalizeSearch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function indexStocks(list: StockEntry[]): IndexedStock[] {
  return list.map(([symbol, name, tier]) => ({
    symbol,
    name,
    tier,
    flat: normalizeSearch(name),
    words: name.toLowerCase().split(/[\s\-/.,&]+/).map(normalizeSearch).filter(Boolean),
  }));
}

// Exact ticker, then names that start with the query, tickers that start with it, a word that
// starts with it, and finally names containing it. Ties go to the larger exchange tier, then the
// shorter name, so "apple" lists Apple Inc. before Apple Hospitality REIT.
export function searchStocks(index: IndexedStock[], rawQuery: string, limit = SEARCH_LIMIT): StockMatch[] {
  const query = rawQuery.trim();
  const needle = normalizeSearch(query);
  if (!needle) return [];
  const ticker = query.toUpperCase().replace(/\./g, "-");
  const tickerLike = /^[A-Z0-9-]{1,10}$/.test(ticker);

  const ranked: { stock: IndexedStock; rank: number }[] = [];
  for (const stock of index) {
    let rank = -1;
    if (stock.symbol === ticker) rank = 0;
    else if (stock.flat.startsWith(needle)) rank = 1;
    else if (tickerLike && stock.symbol.startsWith(ticker)) rank = 2;
    else if (stock.words.some((word) => word.startsWith(needle))) rank = 3;
    else if (needle.length >= 3 && stock.flat.includes(needle)) rank = 4;
    if (rank >= 0) ranked.push({ stock, rank });
  }
  ranked.sort((left, right) =>
    left.rank - right.rank
    || left.stock.tier - right.stock.tier
    || left.stock.name.length - right.stock.name.length
    || left.stock.symbol.localeCompare(right.stock.symbol));

  const bySymbol = new Map(index.map((stock) => [stock.symbol, stock]));
  const aliases = (BRAND_ALIASES[needle] ?? []).flatMap((symbol) => bySymbol.get(symbol) ?? []);
  const results: StockMatch[] = [];
  const seen = new Set<string>();
  // An exact ticker stays first; brand aliases come right after it.
  const ordered = ranked[0]?.rank === 0 ? [ranked[0].stock, ...aliases, ...ranked.slice(1).map((item) => item.stock)] : [...aliases, ...ranked.map((item) => item.stock)];
  for (const stock of ordered) {
    if (seen.has(stock.symbol)) continue;
    seen.add(stock.symbol);
    results.push({ symbol: stock.symbol, name: stock.name });
    if (results.length >= limit) break;
  }
  return results;
}

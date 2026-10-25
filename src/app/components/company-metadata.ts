import type { Metadata } from "next";
import { normalizeTicker } from "@/lib/fmp";

type SymbolSearchParams = Promise<{ symbol?: string | string[] }>;

// Page titles for company pages and tools: "AAPL Financials — StockPilot", or the section alone
// (or withoutSymbol, e.g. "Market news") before a ticker is chosen.
export function companyMetadata(section: string, description: string, withoutSymbol = section) {
  return async function generateMetadata({ searchParams }: { searchParams: SymbolSearchParams }): Promise<Metadata> {
    const raw = (await searchParams).symbol;
    const symbol = normalizeTicker(Array.isArray(raw) ? raw[0] : raw);
    return { title: symbol ? `${symbol} ${section} — StockPilot` : `${withoutSymbol} — StockPilot`, description };
  };
}

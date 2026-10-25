import { listedName } from "@/lib/listed-companies";
import type { StockQuoteResult } from "@/lib/stock-overview";
import { QuoteHeader } from "./quote-header";

// The header above the company tabs: the quote when there is one, otherwise the company's name
// from the bundled stock list.
export function CompanyHeader({ symbol, quote, currency = "USD" }: { symbol: string; quote: StockQuoteResult | null; currency?: string }) {
  if (quote?.ok) return <QuoteHeader quote={quote.data} currency={currency} />;
  const name = listedName(symbol);
  return (
    <section className="quote-header">
      <h1>{name ? `${name} (${symbol})` : symbol}</h1>
    </section>
  );
}

import type { StockQuote } from "@/lib/stock-overview";
import { FavoriteToggle } from "./favorite-toggle";

function price(value: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

// US listings trade on New York time, so the quote time is shown there.
function formatQuoteTime(seconds: number | null): string | null {
  if (seconds === null) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "America/New_York", timeZoneName: "short",
  }).format(new Date(seconds * 1000));
}

type HeaderQuote = Pick<StockQuote, "symbol" | "name" | "exchange" | "price" | "change" | "changePercent" | "quoteTime">;

// Company name, listing and latest price, shown above the company tabs.
export function QuoteHeader({ quote, currency }: { quote: HeaderQuote; currency: string }) {
  const quoteTime = formatQuoteTime(quote.quoteTime);
  const up = (quote.change ?? 0) >= 0;

  return (
    <section className="quote-header">
      <div className="quote-title-row">
        <h1>{quote.name} ({quote.symbol})</h1>
        <FavoriteToggle symbol={quote.symbol} />
      </div>
      <p className="quote-meta">
        {[quote.exchange ? `${quote.exchange}: ${quote.symbol}` : quote.symbol, currency].join(" · ")}
      </p>
      <div className="quote-price">
        <strong>{price(quote.price)}</strong>
        {quote.change !== null && (
          <span className={up ? "positive-value" : "negative-value"}>
            {`${up ? "+" : ""}${price(quote.change)}`}
            {quote.changePercent !== null && ` (${up ? "+" : ""}${(quote.changePercent * 100).toFixed(2)}%)`}
          </span>
        )}
      </div>
      {quoteTime && <p className="quote-time">As of {quoteTime}</p>}
    </section>
  );
}

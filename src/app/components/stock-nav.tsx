import Link from "next/link";

export type StockSection = "overview" | "financials" | "news" | "transcripts" | "filings" | "valuation";

const SECTIONS: { id: StockSection; label: string; path: string }[] = [
  { id: "overview", label: "Overview", path: "/stock" },
  { id: "financials", label: "Financials", path: "/stock/financials" },
  { id: "news", label: "News", path: "/news" },
  { id: "transcripts", label: "Transcripts", path: "/stock/transcripts" },
  { id: "filings", label: "Filings", path: "/stock/filings" },
  // Opens the first valuation tool; the others are its sub-tabs.
  { id: "valuation", label: "Valuation", path: "/valuation/intrinsic-value" },
];

// The same tabs on every page about one company, like a quote site's stock header.
export function StockNav({ symbol, active }: { symbol: string; active: StockSection }) {
  return (
    <nav className="stock-nav" aria-label={`${symbol} sections`}>
      {SECTIONS.map((section) => (
        <Link
          key={section.id}
          href={`${section.path}?symbol=${encodeURIComponent(symbol)}`}
          className={section.id === active ? "stock-nav-active" : ""}
          aria-current={section.id === active ? "page" : undefined}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "./components/app-shell";
import { TickerSearch } from "./components/ticker-search";
import { currentUserId } from "@/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { listFavorites } from "@/lib/favorites";
import { listedName } from "@/lib/listed-companies";

const POPULAR = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM"];
// Company pages link to a real example, so each card opens something useful.
const EXAMPLE = "AAPL";

type Card = { title: string; detail: string; href: string; cta: string };

const COMPANY_CARDS: Card[] = [
  { title: "Overview", detail: "Price, market cap, P/E, analyst targets, the price chart and the company profile.", href: `/stock?symbol=${EXAMPLE}`, cta: "Apple overview" },
  { title: "Financials", detail: "Income statement, balance sheet, cash flow and ratios, annual and quarterly, with an AI review of each.", href: `/stock/financials?symbol=${EXAMPLE}`, cta: "Apple financials" },
  { title: "Transcripts", detail: "Earnings calls speaker by speaker, with an AI summary of results, outlook and analysts' questions.", href: `/stock/transcripts?symbol=${EXAMPLE}`, cta: "Apple's latest call" },
  { title: "Filings", detail: "10-Ks, 10-Qs, earnings releases and other SEC filings, with the press release a click away.", href: `/stock/filings?symbol=${EXAMPLE}`, cta: "Apple filings" },
  { title: "News", detail: "Headlines that mention the company from the last two weeks.", href: `/news?symbol=${EXAMPLE}`, cta: "Apple news" },
  { title: "Recommendations", detail: "Large stocks rated Buy, well below analysts' targets and pulled back under their 12-week average.", href: "/recommendations", cta: "See today's matches" },
  { title: "Compare", detail: "Up to five stocks side by side: P/E, expected EPS and revenue growth and margins, next to a typical range.", href: "/compare?symbols=AAPL,MSFT,GOOGL", cta: "Compare Apple, Microsoft and Alphabet" },
];

const VALUATION_CARDS: Card[] = [
  { title: "Intrinsic Value", detail: "Six valuation models picked for the type of company, with every assumption explained.", href: `/valuation/intrinsic-value?symbol=${EXAMPLE}`, cta: "Value Apple" },
  { title: "Jeremy's Projection", detail: "Best for growth stocks: bull, base and bear cases from this year's analyst consensus, with revenue and net income growth and a P/E range.", href: `/valuation/jeremy-projection?symbol=${EXAMPLE}`, cta: "Project Apple" },
  { title: "Plumas Projection", detail: "Best for mature, dividend, cyclical and loss-making companies: five years from the last report, down to costs, interest and buybacks.", href: `/valuation/plumas-projection?symbol=${EXAMPLE}`, cta: "Project Apple in detail" },
  { title: "DCF Calculator", detail: "Ten years of free cash flow and a terminal value, discounted to a value per share.", href: `/valuation/dcf-calculator?symbol=${EXAMPLE}`, cta: "Discount Apple's cash flows" },
];

const MARKET_CARDS: Card[] = [
  { title: "Market maps", detail: "Heat maps of the S&P 500, the Nasdaq 100 and crypto.", href: "/maps", cta: "Open the maps" },
  { title: "Fear gauge", detail: "The VIX as a fear and greed gauge, against last week, month and year.", href: "/vix", cta: "Check the market's mood" },
  { title: "Market events", detail: "Fed decisions, CPI and jobs reports, elections and deadlines in the news, on one timeline.", href: "/events", cta: "See what's coming" },
  { title: "Market news", detail: "Markets, deals, currencies and crypto headlines.", href: "/news", cta: "Read the news" },
  { title: "Earnings calendar", detail: "Who reports each day, with estimates and results.", href: "/earnings", cta: "This week's earnings" },
  { title: "Dividend calendar", detail: "Ex-dividend and payment dates, with yields.", href: "/dividends", cta: "This month's dividends" },
];

function CardGrid({ label, title, description, cards }: { label: string; title: string; description: string; cards: Card[] }) {
  const id = `home-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section className="home-section" aria-labelledby={id}>
      <div className="home-section-heading">
        <p className="section-label">{label}</p>
        <h2 id={id}>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="home-grid">
        {cards.map((card) => (
          <Link key={card.title} href={card.href} className="home-card">
            <h3>{card.title}</h3>
            <p>{card.detail}</p>
            <span className="home-card-cta">{card.cta} →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function TickerChips({ label, symbols }: { label: ReactNode; symbols: string[] }) {
  return (
    <div className="home-chips">
      <span>{label}</span>
      {symbols.map((symbol) => (
        <Link key={symbol} href={`/stock?symbol=${symbol}`} title={listedName(symbol) ?? symbol}>
          <strong>{symbol}</strong>
          {listedName(symbol) && <small>{listedName(symbol)!.replace(/,? (Inc|Corp|Corporation|Company|Co|Holdings|Platforms|Group|& Co)\.?$/i, "")}</small>}
        </Link>
      ))}
    </div>
  );
}

// The signed-in user's favorites, if any; the home page still renders when there's no account or database.
async function favoriteSymbols(): Promise<string[]> {
  if (!isDatabaseConfigured()) return [];
  try {
    const userId = await currentUserId();
    return userId ? (await listFavorites(userId)).slice(0, 8).map((favorite) => favorite.symbol) : [];
  } catch {
    return [];
  }
}

export default async function Home() {
  const favorites = await favoriteSymbols();

  return (
    <AppShell contentClassName="dashboard-content home" activeSection="home" dataSource="Data from FMP, SEC EDGAR, Finnhub, Alpha Vantage and FINVIZ">
      <section className="home-hero">
        <p className="section-label">STOCK RESEARCH</p>
        <h1>Research any US stock, from its filings to its fair value.</h1>
        <p className="home-lede">
          Search a company by name or ticker for its financials, earnings calls, SEC filings and news, then
          estimate what it&apos;s worth.
        </p>
        <TickerSearch />
        {favorites.length > 0 && <TickerChips label={<Link href="/favorites">Your favorites</Link>} symbols={favorites} />}
        <TickerChips label="Popular" symbols={POPULAR} />
      </section>

      <CardGrid
        label="EVERY COMPANY"
        title="Everything about a company, in one place"
        description="Five tabs for each stock. The examples open Apple."
        cards={COMPANY_CARDS}
      />
      <CardGrid
        label="VALUATION"
        title="Estimate what it's worth"
        description="Three calculators that start from the company's filings and let you change every assumption."
        cards={VALUATION_CARDS}
      />
      <CardGrid
        label="MARKETS"
        title="Follow the market"
        description="What's moving, who reports and who pays dividends."
        cards={MARKET_CARDS}
      />

      <p className="news-footnote">
        Data from Financial Modeling Prep, SEC EDGAR, Finnhub, Alpha Vantage and FINVIZ. Free plans have daily
        limits; when FMP can&apos;t provide a company, statements come from its SEC filings. Not investment advice.
      </p>
    </AppShell>
  );
}

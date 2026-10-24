import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../components/app-shell";
import { FinvizMarketMap } from "./finviz-market-map";

export const metadata: Metadata = {
  title: "Market maps — StockPilot",
  description: "View S&P 500 and Nasdaq 100 market maps and daily stock performance.",
};

// FINVIZ map types: "sec" is the S&P 500 by sector, "sec_ndx" the Nasdaq 100, "crypto" coins priced in USD.
const INDEXES = [
  { id: "sp500", label: "S&P 500", mapType: "sec", description: "Daily performance across the S&P 500." },
  { id: "ndx", label: "Nasdaq 100", mapType: "sec_ndx", description: "Daily performance across the Nasdaq 100, the largest non-financial companies listed on the Nasdaq." },
  { id: "crypto", label: "Crypto", mapType: "crypto", description: "Daily performance of the largest cryptocurrencies in US dollars, each sized by its market cap." },
] as const;

type MapsPageProps = {
  searchParams: Promise<{ index?: string | string[] }>;
};

export default async function MapsPage({ searchParams }: MapsPageProps) {
  const params = await searchParams;
  const requested = Array.isArray(params.index) ? params.index[0] : params.index;
  const index = INDEXES.find((item) => item.id === requested) ?? INDEXES[0];

  return (
    <AppShell contentClassName="market-map-content" activeSection="maps">
      <section className="market-map-heading" aria-labelledby="market-map-title">
        <div>
          <p className="section-label">MARKET SNAPSHOT</p>
          <h1 id="market-map-title">Market maps</h1>
          <p className="market-map-description">{index.description}</p>
        </div>
        <span className="access-badge">{index.label.toUpperCase()} · 1 DAY</span>
      </section>

      <nav className="statement-tabs market-map-tabs" aria-label="Market index">
        {INDEXES.map((item) => (
          <Link
            key={item.id}
            href={item.id === "sp500" ? "/maps" : `/maps?index=${item.id}`}
            className={item.id === index.id ? "statement-tab-active" : ""}
            aria-current={item.id === index.id ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <aside className="market-map-limit" aria-label="FINVIZ free plan limit">
        <span className="market-map-limit-mark" aria-hidden="true">i</span>
        <p>
          <strong>Free plan limit</strong>
          Free plan embeds are limited to 1-Day maps. Upgrade to Elite to embed
          any time period.
        </p>
        <a
          href="https://finviz.com/elite?utm_source=finviz&utm_medium=banner&utm_campaign=embed-map"
          target="_blank"
          rel="noopener noreferrer"
        >
          Upgrade to Elite <span aria-hidden="true">↗</span>
        </a>
      </aside>

      <section className="market-map-panel" aria-label={`${index.label} market map`}>
        <div className="market-map-panel-heading">
          <div>
            <p className="section-label">PERFORMANCE PERIOD</p>
            <h2>{index.label} · 1 day</h2>
          </div>
          <span className="market-map-live"><span aria-hidden="true" /> FINVIZ EMBED</span>
        </div>
        <div className="market-map-frame-wrap">
          <FinvizMarketMap mapType={index.mapType} label={index.label} />
        </div>
        <div className="market-map-attribution">
          <span>Market data visualization</span>
          <a
            href={`https://finviz.com/map?t=${index.mapType}&st=d1&utm_source=finviz_widget&utm_medium=widget&utm_campaign=map&utm_content=99lau70j`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Market map by FINVIZ <span aria-hidden="true">↗</span>
          </a>
        </div>
      </section>
    </AppShell>
  );
}

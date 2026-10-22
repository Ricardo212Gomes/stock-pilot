import type { Metadata } from "next";
import { AppShell } from "../components/app-shell";
import { FinvizMarketMap } from "./finviz-market-map";

export const metadata: Metadata = {
  title: "Market maps — StockPilot",
  description: "View the S&P 500 market map and daily stock performance.",
};

export default function MapsPage() {
  return (
    <AppShell contentClassName="market-map-content" activeSection="maps">
      <section className="market-map-heading" aria-labelledby="market-map-title">
        <div>
          <p className="section-label">MARKET SNAPSHOT</p>
          <h1 id="market-map-title">Market maps</h1>
          <p className="market-map-description">
            Daily performance across the S&amp;P 500.
          </p>
        </div>
        <span className="access-badge">S&amp;P 500 · 1 DAY</span>
      </section>

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

      <section className="market-map-panel" aria-label="S&P 500 market map">
        <div className="market-map-panel-heading">
          <div>
            <p className="section-label">PERFORMANCE PERIOD</p>
            <h2>S&amp;P 500 · 1 day</h2>
          </div>
          <span className="market-map-live"><span aria-hidden="true" /> FINVIZ EMBED</span>
        </div>
        <div className="market-map-frame-wrap">
          <FinvizMarketMap />
        </div>
        <div className="market-map-attribution">
          <span>Market data visualization</span>
          <a
            href="https://finviz.com/map?t=sec&st=d1&utm_source=finviz_widget&utm_medium=widget&utm_campaign=map&utm_content=99lau70j"
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

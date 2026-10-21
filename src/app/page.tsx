import { TickerSearch } from "./components/ticker-search";

const dataGroups = [
  {
    number: "01",
    title: "Profitability",
    detail: "Revenue, earnings and margins over time.",
  },
  {
    number: "02",
    title: "Balance sheet",
    detail: "Debt, cash, equity and liquidity ratios.",
  },
  {
    number: "03",
    title: "Cash generation",
    detail: "Operating cash flow and free cash flow.",
  },
];

const sampleTickers = ["AAPL", "MSFT", "NVDA", "GOOGL"];

export default function Home() {
  return (
    <main className="landing-page">
      <div className="page-shell">
        <header className="topbar">
          <a className="brand" href="/" aria-label="StockPilot home">
            <span className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>stockpilot</span>
          </a>
          <span className="topbar-note">Company fundamentals, in one place</span>
        </header>

        <section className="hero-section">
          <div className="hero-copy">
            <p className="eyebrow"><span className="eyebrow-line" /> FUNDAMENTAL RESEARCH</p>
            <h1>
              Understand the
              <br />
              <span>business</span> behind
              <br />
              the ticker.
            </h1>
            <p className="hero-description">
              Explore the numbers that shape a company: revenue, earnings,
              margins, debt and cash flow across the last five years.
            </p>

            <TickerSearch />

            <div className="popular-tickers" aria-label="Example stocks">
              <span>Try a ticker</span>
              {sampleTickers.map((ticker) => (
                <a key={ticker} href={`/stock?symbol=${ticker}`}>
                  {ticker}
                </a>
              ))}
            </div>
          </div>

          <div className="hero-visual" role="img" aria-label="The three financial statements used for analysis">
            <div className="visual-orbit orbit-one" />
            <div className="visual-orbit orbit-two" />
            <div className="visual-center">
              <span className="visual-center-kicker">COMPANY</span>
              <span className="visual-center-title">Fundamentals</span>
              <span className="visual-center-caption">A clearer view of financial health</span>
            </div>
            <div className="visual-node node-income">
              <span className="node-icon node-icon-bars" aria-hidden="true"><i /><i /><i /></span>
              <span><strong>Income</strong><small>Revenue &amp; profit</small></span>
            </div>
            <div className="visual-node node-balance">
              <span className="node-icon node-icon-balance" aria-hidden="true"><i /></span>
              <span><strong>Balance sheet</strong><small>Debt &amp; equity</small></span>
            </div>
            <div className="visual-node node-cash">
              <span className="node-icon node-icon-cash" aria-hidden="true"><i /></span>
              <span><strong>Cash flow</strong><small>Cash generation</small></span>
            </div>
            <span className="visual-caption">THREE STATEMENTS · ONE VIEW</span>
          </div>
        </section>

        <section className="data-section" aria-labelledby="data-heading">
          <div className="section-heading">
            <p className="eyebrow">BUILT FOR THE FIRST PASS</p>
            <h2 id="data-heading">The essentials for a deeper look.</h2>
          </div>
          <div className="data-groups">
            {dataGroups.map((group) => (
              <article className="data-group" key={group.number}>
                <span className="data-group-number">{group.number}</span>
                <h3>{group.title}</h3>
                <p>{group.detail}</p>
                <span className="data-group-arrow" aria-hidden="true">↗</span>
              </article>
            ))}
          </div>
        </section>

        <footer className="landing-footer">
          <span>StockPilot</span>
          <span>Financial data provided by Financial Modeling Prep</span>
        </footer>
      </div>
    </main>
  );
}

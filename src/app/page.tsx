import { AppShell } from "./components/app-shell";

const researchAreas = [
  {
    index: "01",
    title: "Profitability",
    detail: "Revenue, earnings and margins across annual periods.",
    access: "INCOME STATEMENT",
  },
  {
    index: "02",
    title: "Financial position",
    detail: "Debt, cash, equity and short-term liquidity.",
    access: "BALANCE SHEET",
  },
  {
    index: "03",
    title: "Cash generation",
    detail: "Operating cash flow and free cash flow trends.",
    access: "CASH FLOW",
  },
];

const sampleTickers = ["AAPL", "MSFT", "NVDA", "GOOGL"];

export default function Home() {
  return (
    <AppShell contentClassName="landing-main">
        <section className="landing-hero">
          <div className="landing-intro">
            <div className="intro-meta">
              <span className="access-badge">NO ACCOUNT NEEDED</span>
              <span>Company fundamentals</span>
            </div>
            <h1>Research the business behind the ticker.</h1>
            <p>
              A clear view of revenue, profit, margins, debt and cash flow. Start
              with a ticker to explore up to five annual periods.
            </p>
            <div className="ticker-examples">
              <span>Popular tickers</span>
              {sampleTickers.map((ticker) => (
                <a key={ticker} href={`/stock?symbol=${ticker}`}>
                  {ticker}
                </a>
              ))}
            </div>
          </div>

          <aside className="research-preview" aria-label="Financial data available in StockPilot">
            <div className="preview-heading">
              <div>
                <p className="section-label">RESEARCH SNAPSHOT</p>
                <h2>Company fundamentals</h2>
              </div>
              <span className="preview-icon" aria-hidden="true">↗</span>
            </div>
            <div className="preview-list">
              <div className="preview-row">
                <span className="preview-index">01</span>
                <span className="preview-name">Revenue &amp; earnings</span>
                <span className="preview-detail">UP TO 5</span>
              </div>
              <div className="preview-row">
                <span className="preview-index">02</span>
                <span className="preview-name">Margins &amp; profitability</span>
                <span className="preview-detail">UP TO 5</span>
              </div>
              <div className="preview-row">
                <span className="preview-index">03</span>
                <span className="preview-name">Debt &amp; liquidity</span>
                <span className="preview-detail">UP TO 5</span>
              </div>
              <div className="preview-row">
                <span className="preview-index">04</span>
                <span className="preview-name">Operating &amp; free cash flow</span>
                <span className="preview-detail">UP TO 5</span>
              </div>
            </div>
            <p className="preview-footnote">Annual filings · Financial Modeling Prep</p>
          </aside>
        </section>

        <section className="research-section" id="coverage" aria-labelledby="coverage-heading">
          <div className="section-heading-row">
            <div>
              <p className="section-label">WHAT YOU CAN REVIEW</p>
              <h2 id="coverage-heading">The financial picture, organized.</h2>
            </div>
            <p className="section-description">
              Three statements, key ratios and a consistent year-by-year view.
            </p>
          </div>
          <div className="research-grid">
            {researchAreas.map((area) => (
              <article className="research-card" key={area.index}>
                <div className="research-card-top">
                  <span>{area.index}</span>
                  <span className="research-access">{area.access}</span>
                </div>
                <h3>{area.title}</h3>
                <p>{area.detail}</p>
                <span className="research-rule" aria-hidden="true" />
              </article>
            ))}
          </div>
        </section>

    </AppShell>
  );
}

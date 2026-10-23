import type { ReactNode } from "react";
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";
import { TickerSearch } from "./ticker-search";

type AppShellProps = {
  children: ReactNode;
  contentClassName: string;
  tickerValue?: string;
  activeSection?: "research" | "projections" | "maps" | "news" | "earnings";
  // Overrides the top bar label, e.g. "AAPL overview".
  headerLabel?: string;
};

function headerContext(section: AppShellProps["activeSection"], ticker: string): string {
  if (section === "maps") return "Market maps";
  if (section === "news") return ticker ? `${ticker} news` : "Market news";
  if (section === "earnings") return "Earnings calendar";
  if (section === "projections") return ticker ? `${ticker} projections` : "Stock projections";
  return ticker ? `${ticker} fundamentals` : "Company fundamentals";
}

export function AppShell({
  children,
  contentClassName,
  tickerValue = "",
  activeSection = "research",
  headerLabel,
}: AppShellProps) {
  return (
    <div className="site-page">
      <div className="app-layout">
        <aside className="sidebar" aria-label="Application sidebar">
          <Link className="brand" href="/" aria-label="StockPilot home">
            <span className="brand-mark" aria-hidden="true">S</span>
            <span>StockPilot</span>
          </Link>

          <nav className="sidebar-nav" aria-label="Workspace">
            <p className="sidebar-section-label">WORKSPACE</p>
            <Link
              className={`sidebar-link${activeSection === "research" ? " sidebar-link-active" : ""}`}
              href="/"
              title="Company research"
              aria-current={activeSection === "research" ? "page" : undefined}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 16.5h14M4.5 14V9.5M8.2 14V5.5M11.8 14v-3M15.5 14V7" />
              </svg>
              <span>Company research</span>
            </Link>
            <Link
              className={`sidebar-link${activeSection === "projections" ? " sidebar-link-active" : ""}`}
              href={tickerValue ? `/projections?symbol=${tickerValue}` : "/projections"}
              title="Stock projections"
              aria-current={activeSection === "projections" ? "page" : undefined}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 16.5h14M4 13l4-4 3 2.5L16.5 5M12.5 5h4v4" />
              </svg>
              <span>Projections</span>
            </Link>
          </nav>

          <nav className="sidebar-nav sidebar-nav-markets" aria-label="Markets">
            <p className="sidebar-section-label">MARKETS</p>
            <Link
              className={`sidebar-link${activeSection === "maps" ? " sidebar-link-active" : ""}`}
              href="/maps"
              title="Market maps"
              aria-current={activeSection === "maps" ? "page" : undefined}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 3.5h6v6H3zM11 3.5h6v4h-6zM11 9.5h6v7h-6zM3 11.5h6v5H3z" />
              </svg>
              <span>Maps</span>
            </Link>
            <Link
              className={`sidebar-link${activeSection === "news" ? " sidebar-link-active" : ""}`}
              href={tickerValue ? `/news?symbol=${tickerValue}` : "/news"}
              title="News"
              aria-current={activeSection === "news" ? "page" : undefined}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M4 4.5h10v11H5.5A1.5 1.5 0 0 1 4 14V4.5ZM14 7.5h2v6.5a1.5 1.5 0 0 1-3 0M6.5 7.5h5M6.5 10h5M6.5 12.5h3" />
              </svg>
              <span>News</span>
            </Link>
            <Link
              className={`sidebar-link${activeSection === "earnings" ? " sidebar-link-active" : ""}`}
              href="/earnings"
              title="Earnings calendar"
              aria-current={activeSection === "earnings" ? "page" : undefined}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M4 5.5h12v10.5H4zM4 8.5h12M7.5 3.5v3M12.5 3.5v3M7 11.5h2M11 11.5h2M7 13.5h2" />
              </svg>
              <span>Earnings</span>
            </Link>
          </nav>

          <div className="sidebar-note">
            <span className="sidebar-tool-count"><span aria-hidden="true" /> 5 TOOLS</span>
            <p>Company research, projections, market maps, news and earnings.</p>
          </div>

          <div className="sidebar-theme">
            <ThemeToggle />
          </div>
        </aside>

        <div className="app-main">
          <header className="topbar">
            <span className="header-context">
              {headerLabel ?? headerContext(activeSection, tickerValue)}
            </span>
            <div className="header-actions">
              <TickerSearch
                compact
                value={tickerValue}
                action={activeSection === "projections" || activeSection === "news" ? `/${activeSection}` : "/stock"}
              />
              <ThemeToggle />
            </div>
          </header>

          <main className={`app-content ${contentClassName}`}>{children}</main>

          <footer className="app-footer">
            <span>StockPilot</span>
            <span>
              {activeSection === "maps"
                ? "Market map by FINVIZ"
                : activeSection === "news" || activeSection === "earnings"
                  ? `${activeSection === "news" ? "News" : "Earnings data"} provided by Finnhub`
                  : "Financial data provided by Financial Modeling Prep"}
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}

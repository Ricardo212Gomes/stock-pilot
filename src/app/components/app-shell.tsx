import type { ReactNode } from "react";
import Link from "next/link";
import { VALUATION_TOOLS, type ValuationTool } from "../valuation/tools";
import { SidebarToggle } from "./sidebar-toggle";
import { ThemeToggle } from "./theme-toggle";
import { TickerSearch } from "./ticker-search";
import { UserMenu } from "./user-menu";

type AppShellProps = {
  children: ReactNode;
  contentClassName: string;
  tickerValue?: string;
  activeSection?: "home" | "research" | "compare" | "recommendations" | "portfolio" | "favorites" | "settings" | ValuationTool | "maps" | "vix" | "events" | "news" | "earnings" | "dividends";
  // Overrides the top bar label, e.g. "AAPL · Overview".
  headerLabel?: string;
  // Overrides the footer's data credit, for pages with their own source.
  dataSource?: string;
};

function headerContext(section: AppShellProps["activeSection"], ticker: string): string {
  if (section === "home") return "Home";
  if (section === "compare") return "Compare stocks";
  if (section === "recommendations") return "Recommendations";
  if (section === "portfolio") return "Portfolio";
  if (section === "favorites") return "Favorites";
  if (section === "maps") return "Market maps";
  if (section === "vix") return "VIX fear gauge";
  if (section === "events") return "Market events";
  if (section === "news") return ticker ? `${ticker} news` : "Market news";
  if (section === "earnings") return "Earnings calendar";
  if (section === "dividends") return "Dividend calendar";
  const tool = VALUATION_TOOLS.find(({ id }) => id === section);
  if (tool) return ticker ? `${ticker} · ${tool.label}` : tool.label;
  return ticker ? `${ticker} · Overview` : "Stocks";
}

export function AppShell({
  children,
  contentClassName,
  tickerValue = "",
  activeSection = "research",
  headerLabel,
  dataSource,
}: AppShellProps) {
  const valuationPath = VALUATION_TOOLS.find(({ id }) => id === activeSection)?.path;
  // The valuation tools are a company's Valuation tab, so they sit under Stocks.
  const onStocks = activeSection === "research" || valuationPath !== undefined;
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
              className={`sidebar-link${activeSection === "home" ? " sidebar-link-active" : ""}`}
              href="/"
              title="Home"
              aria-current={activeSection === "home" ? "page" : undefined}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3.5 9 10 3.5 16.5 9M5 8v8.5h3.5V12h3v4.5H15V8" />
              </svg>
              <span>Home</span>
            </Link>
            <Link
              className={`sidebar-link${onStocks ? " sidebar-link-active" : ""}`}
              // Always the leaderboards: a company's own pages are its tabs.
              href="/stock"
              title="Stocks"
              aria-current={onStocks ? "page" : undefined}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 16.5h14M4.5 14V9.5M8.2 14V5.5M11.8 14v-3M15.5 14V7" />
              </svg>
              <span>Stocks</span>
            </Link>
            <Link
              className={`sidebar-link${activeSection === "compare" ? " sidebar-link-active" : ""}`}
              href="/compare"
              title="Compare stocks"
              aria-current={activeSection === "compare" ? "page" : undefined}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3.5 4.5h5v11h-5zM11.5 4.5h5v11h-5zM5 8h2M5 10.5h2M13 8h2M13 10.5h2" />
              </svg>
              <span>Compare</span>
            </Link>
            <Link
              className={`sidebar-link${activeSection === "recommendations" ? " sidebar-link-active" : ""}`}
              href="/recommendations"
              title="Recommendations"
              aria-current={activeSection === "recommendations" ? "page" : undefined}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3.5 15.5 8 11l3 3 5.5-6.5M12.5 8.5h4v4" />
              </svg>
              <span>Recommendations</span>
            </Link>
            <Link
              className={`sidebar-link${activeSection === "portfolio" ? " sidebar-link-active" : ""}`}
              href="/portfolio"
              title="Portfolio"
              aria-current={activeSection === "portfolio" ? "page" : undefined}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3.5 7h13v9h-13zM7.5 7V5h5v2M3.5 11h13M9 11v1.5h2V11" />
              </svg>
              <span>Portfolio</span>
            </Link>
            <Link
              className={`sidebar-link${activeSection === "favorites" ? " sidebar-link-active" : ""}`}
              href="/favorites"
              title="Favorites"
              aria-current={activeSection === "favorites" ? "page" : undefined}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="m10 2.8 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7L10 2.8Z" />
              </svg>
              <span>Favorites</span>
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
              className={`sidebar-link${activeSection === "vix" ? " sidebar-link-active" : ""}`}
              href="/vix"
              title="VIX fear gauge"
              aria-current={activeSection === "vix" ? "page" : undefined}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 14.5a7 7 0 0 1 14 0M10 14.5l3.2-4.2M5.2 9.6l1 .8M10 7.5v1.2M14.8 9.6l-1 .8" />
              </svg>
              <span>Fear gauge</span>
            </Link>
            <Link
              className={`sidebar-link${activeSection === "events" ? " sidebar-link-active" : ""}`}
              href="/events"
              title="Market events"
              aria-current={activeSection === "events" ? "page" : undefined}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M5 3.5v13M5 5.5h9.5l-2 3 2 3H5M5 16.5h-1.5M5 16.5h1.5" />
              </svg>
              <span>Events</span>
            </Link>
            <Link
              className={`sidebar-link${activeSection === "news" ? " sidebar-link-active" : ""}`}
              // Market news; a company's news is its News tab.
              href="/news"
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
            <Link
              className={`sidebar-link${activeSection === "dividends" ? " sidebar-link-active" : ""}`}
              href="/dividends"
              title="Dividend calendar"
              aria-current={activeSection === "dividends" ? "page" : undefined}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="10" cy="10" r="6.5" />
                <path d="M12 7.6c-.4-.6-1.1-.9-2-.9-1.2 0-2 .6-2 1.5 0 2 4 1.1 4 3.3 0 .9-.9 1.6-2.1 1.6-.9 0-1.7-.4-2.1-1M10 5.5v1.2M10 13.3v1.2" />
              </svg>
              <span>Dividends</span>
            </Link>
          </nav>

          <div className="sidebar-collapse">
            <SidebarToggle />
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
                action={valuationPath ?? (activeSection === "news" ? "/news" : "/stock")}
              />
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>

          <main className={`app-content ${contentClassName}`}>{children}</main>

          <footer className="app-footer">
            <span>StockPilot</span>
            <span>
              {dataSource ?? (activeSection === "maps"
                ? "Market map by FINVIZ"
                : activeSection === "news" || activeSection === "earnings"
                  ? `${activeSection === "news" ? "News" : "Earnings data"} provided by Finnhub`
                  : "Financial data provided by Financial Modeling Prep")}
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}

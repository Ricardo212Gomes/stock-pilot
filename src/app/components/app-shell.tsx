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
  activeSection?: "research" | "favorites" | ValuationTool | "maps" | "news" | "earnings" | "dividends";
  // Overrides the top bar label, e.g. "AAPL overview".
  headerLabel?: string;
};

function headerContext(section: AppShellProps["activeSection"], ticker: string): string {
  if (section === "favorites") return "Favorites";
  if (section === "maps") return "Market maps";
  if (section === "news") return ticker ? `${ticker} news` : "Market news";
  if (section === "earnings") return "Earnings calendar";
  if (section === "dividends") return "Dividend calendar";
  const tool = VALUATION_TOOLS.find(({ id }) => id === section);
  if (tool) return ticker ? `${ticker} · ${tool.label}` : tool.label;
  return ticker ? `${ticker} fundamentals` : "Company fundamentals";
}

const VALUATION_ICONS: Record<ValuationTool, string> = {
  // A balance scale: what a company is worth.
  "intrinsic-value": "M10 3.5v13M6 16.5h8M4 6h12M4 6l-2 5a2 2 0 0 0 4 0L4 6M16 6l-2 5a2 2 0 0 0 4 0l-2-5",
  // A rising line: where the price could go.
  "three-year-projection": "M3 16.5h14M4 13l4-4 3 2.5L16.5 5M12.5 5h4v4",
  // A percent sign: cash flows discounted at a rate.
  "dcf-calculator": "M5.5 14.5l9-9M7 8.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM13 14.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z",
};

export function AppShell({
  children,
  contentClassName,
  tickerValue = "",
  activeSection = "research",
  headerLabel,
}: AppShellProps) {
  const valuationPath = VALUATION_TOOLS.find(({ id }) => id === activeSection)?.path;
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

          <nav className="sidebar-nav sidebar-nav-markets" aria-label="Valuation">
            <p className="sidebar-section-label">VALUATION</p>
            {VALUATION_TOOLS.map((tool) => (
              <Link
                key={tool.id}
                className={`sidebar-link${activeSection === tool.id ? " sidebar-link-active" : ""}`}
                // Keep the company when switching between tools.
                href={tickerValue ? `${tool.path}?symbol=${tickerValue}` : tool.path}
                title={tool.label}
                aria-current={activeSection === tool.id ? "page" : undefined}
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d={VALUATION_ICONS[tool.id]} />
                </svg>
                <span>{tool.label}</span>
              </Link>
            ))}
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

          <div className="sidebar-note">
            <span className="sidebar-tool-count"><span aria-hidden="true" /> 9 TOOLS</span>
            <p>Company research, favorites, three valuation calculators, market maps, news, earnings and dividends.</p>
          </div>

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

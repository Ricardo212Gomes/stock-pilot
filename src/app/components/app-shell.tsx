import type { ReactNode } from "react";
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";
import { TickerSearch } from "./ticker-search";

type AppShellProps = {
  children: ReactNode;
  contentClassName: string;
  tickerValue?: string;
  activeSection?: "research" | "maps";
};

export function AppShell({
  children,
  contentClassName,
  tickerValue = "",
  activeSection = "research",
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
          </nav>

          <div className="sidebar-note">
            <span className="sidebar-tool-count"><span aria-hidden="true" /> 2 TOOLS</span>
            <p>Company research and market maps.</p>
          </div>

          <div className="sidebar-theme">
            <ThemeToggle />
          </div>
        </aside>

        <div className="app-main">
          <header className="topbar">
            <span className="header-context">
              {activeSection === "maps"
                ? "Market maps"
                : tickerValue
                  ? `${tickerValue} fundamentals`
                  : "Company fundamentals"}
            </span>
            <div className="header-actions">
              <TickerSearch compact value={tickerValue} />
              <ThemeToggle />
            </div>
          </header>

          <main className={`app-content ${contentClassName}`}>{children}</main>

          <footer className="app-footer">
            <span>StockPilot</span>
            <span>
              {activeSection === "maps"
                ? "Market map by FINVIZ"
                : "Financial data provided by Financial Modeling Prep"}
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}

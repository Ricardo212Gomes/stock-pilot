import type { ReactNode } from "react";
import { ThemeToggle } from "./theme-toggle";
import { TickerSearch } from "./ticker-search";

type AppShellProps = {
  children: ReactNode;
  contentClassName: string;
  tickerValue?: string;
};

export function AppShell({
  children,
  contentClassName,
  tickerValue = "",
}: AppShellProps) {
  return (
    <div className="site-page">
      <div className="app-layout">
        <aside className="sidebar" aria-label="Application sidebar">
          <a className="brand" href="/" aria-label="StockPilot home">
            <span className="brand-mark" aria-hidden="true">S</span>
            <span>StockPilot</span>
          </a>

          <nav className="sidebar-nav" aria-label="Workspace">
            <p className="sidebar-section-label">WORKSPACE</p>
            <a className="sidebar-link sidebar-link-active" href="/" title="Company research">
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 16.5h14M4.5 14V9.5M8.2 14V5.5M11.8 14v-3M15.5 14V7" />
              </svg>
              <span>Company research</span>
            </a>
          </nav>

          <div className="sidebar-note">
            <span className="sidebar-tool-count"><span aria-hidden="true" /> 1 TOOL</span>
            <p>More tools can be added here as StockPilot grows.</p>
          </div>

          <div className="sidebar-theme">
            <ThemeToggle />
          </div>
        </aside>

        <div className="app-main">
          <header className="topbar">
            <span className="header-context">
              {tickerValue ? `${tickerValue} fundamentals` : "Company fundamentals"}
            </span>
            <div className="header-actions">
              <TickerSearch compact value={tickerValue} />
              <ThemeToggle />
            </div>
          </header>

          <main className={`app-content ${contentClassName}`}>{children}</main>

          <footer className="app-footer">
            <span>StockPilot</span>
            <span>Financial data provided by Financial Modeling Prep</span>
          </footer>
        </div>
      </div>
    </div>
  );
}

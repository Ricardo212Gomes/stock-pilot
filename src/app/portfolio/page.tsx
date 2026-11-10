import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "../components/app-shell";
import { currentUserId, isAuthConfigured, signIn } from "@/auth";
import { isDatabaseConfigured } from "@/lib/db";
import type { Currency } from "@/lib/fx";
import { ExchangeRatesUnavailable, getPortfolio, portfolioToday, type Income, type PortfolioView, type Trade } from "@/lib/portfolio";
import { getPortfolioCurrency, listIncome, listTrades } from "@/lib/portfolio-trades";
import { CurrencySwitch } from "./currency-switch";
import { PortfolioDashboard } from "./dashboard";
import { ImportStatement } from "./import-statement";
import { TradeForm } from "./trade-form";

export const metadata: Metadata = {
  title: "Portfolio — StockPilot",
  description: "What you own, what it's worth and how it has done against the S&P 500.",
};

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="empty-state empty-state-info" role="status">
      <span className="empty-state-icon" aria-hidden="true">i</span>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

type PortfolioPageProps = {
  searchParams: Promise<{ trades?: string | string[] }>;
};

async function PortfolioBody({ showAllTrades }: { showAllTrades: boolean }) {
  if (!isAuthConfigured()) {
    return <Notice title="Sign-in isn't set up"><p>The portfolio is saved to your Google account. Add the Google sign-in keys to the environment file (see docs/auth.md).</p></Notice>;
  }
  if (!isDatabaseConfigured()) {
    return <Notice title="No database connected"><p>Trades are stored in Postgres. Set DATABASE_URL and run <code>npm run db:setup</code> (see docs/portfolio.md).</p></Notice>;
  }

  const userId = await currentUserId();
  if (!userId) {
    return (
      <Notice title="Sign in to see your portfolio">
        <p>Record your trades to see what you own, what it&apos;s worth and how it has done against the S&amp;P 500.</p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/portfolio" });
          }}
        >
          <button className="favorites-sign-in" type="submit">Sign in with Google</button>
        </form>
      </Notice>
    );
  }

  let trades: Trade[];
  let income: Income[];
  let currency: Currency;
  try {
    [trades, income, currency] = await Promise.all([listTrades(userId), listIncome(userId), getPortfolioCurrency(userId)]);
  } catch {
    return <Notice title="We couldn't load your trades"><p>The database didn&apos;t respond, or the trades table is missing. Check DATABASE_URL and run <code>npm run db:setup</code>.</p></Notice>;
  }
  if (trades.length === 0) {
    return (
      <>
        <Notice title="No trades yet">
          <p>
            Import a Trading 212 or Trade Republic statement, or add what you bought: the ticker, the date, the shares and the price
            (leave it empty for that day&apos;s close). Sales go in the same way.
          </p>
        </Notice>
        <section className="portfolio-section" aria-labelledby="portfolio-first-trade-heading">
          <h2 id="portfolio-first-trade-heading">Add your trades</h2>
          <TradeForm today={portfolioToday()} defaultCurrency={currency} />
          <ImportStatement startOpen />
        </section>
      </>
    );
  }

  let view: PortfolioView;
  try {
    view = await getPortfolio(trades, undefined, currency, income);
  } catch (error) {
    if (!(error instanceof ExchangeRatesUnavailable)) throw error;
    return (
      <>
        <CurrencySwitch current={currency} />
        <Notice title="The exchange rates didn't load">
          <p>
            Your portfolio needs the ECB&apos;s euro rates, from Frankfurter, which didn&apos;t answer. Try again in a minute
            {currency === "EUR" ? ", or show the portfolio in dollars." : "."}
          </p>
        </Notice>
      </>
    );
  }
  return <PortfolioDashboard view={view} showAllTrades={showAllTrades} />;
}

export default async function PortfolioPage({ searchParams }: PortfolioPageProps) {
  const { trades } = await searchParams;
  const showAllTrades = (Array.isArray(trades) ? trades[0] : trades) === "all";
  return (
    <AppShell contentClassName="dashboard-content" activeSection="portfolio" dataSource="Prices from Finnhub and Tiingo, euro rates from the ECB">
      <section className="company-heading">
        <div>
          <p className="section-label">WORKSPACE</p>
          <div className="company-title-row">
            <h1>Portfolio</h1>
          </div>
          <p className="company-subtitle">What you own, what it&apos;s worth and how it has done against the S&amp;P 500.</p>
        </div>
      </section>
      <Suspense fallback={<p className="portfolio-loading" role="status">Pricing your portfolio…</p>}>
        <PortfolioBody showAllTrades={showAllTrades} />
      </Suspense>
    </AppShell>
  );
}

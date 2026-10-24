import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../components/app-shell";
import { DividendBoard } from "./dividend-board";
import { providerFailureMessage } from "@/lib/fmp-messages";
import { addMonths, getDividendMonth, isMonth, monthOf, type DividendDateField } from "@/lib/dividend-calendar";

export const metadata: Metadata = {
  title: "Dividend calendar — StockPilot",
  description: "Upcoming ex-dividend and payment dates, with amounts and yields.",
};

type DividendsPageProps = {
  searchParams: Promise<{ month?: string | string[]; by?: string | string[] }>;
};

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Today in New York, where US dividend dates are set.
function marketToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function monthHref(month: string, by: DividendDateField): string {
  const params = new URLSearchParams({ month });
  if (by === "pay") params.set("by", "pay");
  return `/dividends?${params}`;
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));
}

export default async function DividendsPage({ searchParams }: DividendsPageProps) {
  const params = await searchParams;
  const today = marketToday();
  const thisMonth = monthOf(today);
  const rawMonth = single(params.month);
  const month = isMonth(rawMonth) ? rawMonth : thisMonth;
  const by: DividendDateField = single(params.by) === "pay" ? "pay" : "ex";
  const result = await getDividendMonth(month, by, today);
  const todayDate = new Date(`${today}T12:00:00Z`);

  return (
    <AppShell contentClassName="dashboard-content" activeSection="dividends">
      <section className="company-heading">
        <div>
          <p className="section-label">MARKET CALENDAR</p>
          <div className="company-title-row">
            <h1>Dividend calendar</h1>
          </div>
          <p className="company-subtitle">
            When companies go ex-dividend and pay. To receive a dividend you need to own the stock before its ex-dividend date.
          </p>
        </div>
      </section>

      <div className="earnings-bar">
        <div className="earnings-bar-nav">
          <Link href={monthHref(addMonths(month, -1), by)} className="earnings-round" aria-label="Previous month">‹</Link>
          {month !== thisMonth ? (
            <Link href={monthHref(thisMonth, by)} className="earnings-round earnings-date-chip" aria-label="Go to this month" title="Go to this month">
              <span>{new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(todayDate)}</span>
              <strong>{todayDate.getUTCDate()}</strong>
            </Link>
          ) : (
            <span className="earnings-round earnings-date-chip" aria-hidden="true">
              <span>{new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(todayDate)}</span>
              <strong>{todayDate.getUTCDate()}</strong>
            </span>
          )}
          <Link href={monthHref(addMonths(month, 1), by)} className="earnings-round" aria-label="Next month">›</Link>
          <div className="earnings-bar-title">
            <p className="section-label">DIVIDENDS</p>
            <strong>{monthLabel(month)}</strong>
          </div>
        </div>
        <div className="earnings-bar-tools">
          <nav className="chart-view-switch" aria-label="Date shown">
            <Link href={monthHref(month, "ex")} className={by === "ex" ? "chart-view-active" : ""} aria-current={by === "ex" ? "page" : undefined}>
              Ex-dividend date
            </Link>
            <Link href={monthHref(month, "pay")} className={by === "pay" ? "chart-view-active" : ""} aria-current={by === "pay" ? "page" : undefined}>
              Payment date
            </Link>
          </nav>
        </div>
      </div>

      {!result.ok ? (
        <section className="empty-state" role="status">
          <span className="empty-state-icon" aria-hidden="true">!</span>
          <div>
            <h2>We couldn&apos;t load the calendar</h2>
            <p>
              {result.reason === "plan-restricted"
                ? "The free FMP plan only covers dividends from about four weeks ago onward. Go to a more recent month, or upgrade your FMP plan for the full history."
                : providerFailureMessage(result.reason, "the dividend calendar")}
            </p>
          </div>
        </section>
      ) : (
        <>
          <p className="earnings-summary">
            {result.data.count === 0
              ? `No dividends ${by === "ex" ? "go ex-dividend" : "are paid"} in ${monthLabel(month)} among the companies FMP covers.`
              : `${result.data.count} ${result.data.count === 1 ? "dividend" : "dividends"} ${by === "ex" ? "go ex-dividend" : "are paid"} in ${monthLabel(month)}. Select a company for its dates and yield.`}
          </p>
          <DividendBoard weeks={result.data.weeks} today={today} />
        </>
      )}

      <p className="news-footnote">
        Dividend dates and amounts from Financial Modeling Prep; the free plan covers a selection of large US companies,
        and a paid plan adds every dividend payer. Dates can change until the company declares the dividend.
      </p>
    </AppShell>
  );
}

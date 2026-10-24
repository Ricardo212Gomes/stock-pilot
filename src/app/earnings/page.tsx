import type { Metadata } from "next";
import { AppShell } from "../components/app-shell";
import { EarningsBoard } from "./earnings-board";
import { finnhubFailureMessage } from "@/lib/finnhub";
import {
  LARGE_REVENUE_ESTIMATE,
  addDays,
  defaultWeek,
  getEarningsWeek,
  isIsoDate,
  weekStart,
} from "@/lib/earnings-calendar";

export const metadata: Metadata = {
  title: "Earnings calendar — StockPilot",
  description: "Upcoming and recent earnings reports, with estimates, results and surprises.",
};

type EarningsPageProps = {
  searchParams: Promise<{ week?: string | string[]; all?: string | string[] }>;
};

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function dateLabel(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

// Today in New York, where US companies report, so the calendar's "today" matches the market's.
function marketToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function weekHref(start: string, all: boolean): string {
  const params = new URLSearchParams({ week: start });
  if (all) params.set("all", "1");
  return `/earnings?${params}`;
}

export default async function EarningsPage({ searchParams }: EarningsPageProps) {
  const params = await searchParams;
  const today = marketToday();
  const rawWeek = single(params.week);
  const thisWeek = defaultWeek(today);
  const start = isIsoDate(rawWeek) ? weekStart(rawWeek) : thisWeek;
  const all = single(params.all) === "1";
  const isWeekend = thisWeek !== weekStart(today);
  const result = await getEarningsWeek(start, !all);

  const largeThreshold = new Intl.NumberFormat("en-US", { notation: "compact" }).format(LARGE_REVENUE_ESTIMATE);
  const summary = result.ok
    ? [
        all
          ? `${result.data.shown} companies report this week.`
          : `${result.data.shown} of ${result.data.total} companies report this week, showing those expecting $${largeThreshold}+ in quarterly revenue.`,
        result.data.reported > 0
          ? `${result.data.beats} of ${result.data.reported} that have reported beat the EPS estimate (green dot: beat, red dot: missed).`
          : "",
        "Select a company for its estimates and results.",
      ].filter(Boolean).join(" ")
    : "";

  return (
    <AppShell contentClassName="dashboard-content" activeSection="earnings">
      <section className="company-heading">
        <div>
          <p className="section-label">MARKET CALENDAR</p>
          <div className="company-title-row">
            <h1>Earnings calendar</h1>
          </div>
          <p className="company-subtitle">
            Which companies report results each day, what analysts expect, and how the results compared once they&apos;re out.
          </p>
        </div>
      </section>

      {!result.ok ? (
        <section className="empty-state" role="status">
          <span className="empty-state-icon" aria-hidden="true">!</span>
          <div>
            <h2>We couldn&apos;t load the calendar</h2>
            <p>{finnhubFailureMessage(result.reason, "the earnings calendar")}</p>
          </div>
        </section>
      ) : (
        <EarningsBoard
          days={result.data.days}
          today={today}
          rangeLabel={`${dateLabel(start, { month: "short", day: "numeric" })} – ${dateLabel(addDays(start, 4), { month: "short", day: "numeric", year: "numeric" })}`}
          summary={summary}
          previousHref={weekHref(addDays(start, -7), all)}
          nextHref={weekHref(addDays(start, 7), all)}
          currentHref={start !== thisWeek ? weekHref(thisWeek, all) : null}
          currentLabel={isWeekend ? "Go to the upcoming week" : "Go to this week"}
          largeHref={weekHref(start, false)}
          allHref={weekHref(start, true)}
          all={all}
        />
      )}

      <p className="news-footnote">
        Earnings dates, estimates and results from Finnhub; logos from Financial Modeling Prep. Dates can change;
        companies confirm them shortly before reporting.
      </p>
    </AppShell>
  );
}

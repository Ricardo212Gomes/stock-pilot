import type { Metadata } from "next";
import { AppShell } from "../components/app-shell";
import { EventsTimeline } from "./events-timeline";
import { countdown, formatRange, getMarketEvents, type FedSnapshot, type MarketEvent } from "@/lib/market-events";
import { cachedNewsEvents } from "@/lib/news-events";

export const metadata: Metadata = {
  title: "Market events — StockPilot",
  description: "Fed decisions, key US economic data, elections and global events that can move markets.",
};

function formatDay(isoDay: string, options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", year: "numeric" }): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${isoDay}T12:00:00Z`));
}

function NextCard({ label, event, today, children }: { label: string; event: MarketEvent | undefined; today: string; children?: React.ReactNode }) {
  return (
    <section className="events-next-card" aria-label={label}>
      <p className="events-next-label">{label}</p>
      {event ? (
        <>
          <p className="events-next-date">{event.monthOnly ? formatDay(event.date, { month: "long", year: "numeric" }) : formatDay(event.date)}</p>
          <p className="events-next-meta">
            {event.monthOnly ? "Date not set yet" : countdown(today, event.date)}
            {event.time && ` · ${event.time} ET`}
          </p>
          {children}
        </>
      ) : (
        <p className="events-next-meta">Not scheduled yet</p>
      )}
    </section>
  );
}

function FedLine({ fed }: { fed: FedSnapshot }) {
  const change = fed.lastChange;
  return (
    <p className="events-next-detail">
      Target range <strong>{formatRange(fed.lower, fed.upper)}</strong>
      {change && change.change !== 0 && (
        <>; {change.change > 0 ? "raised" : "cut"} by {Math.abs(change.change).toFixed(2)} pt on {formatDay(change.date, { month: "short", day: "numeric", year: "numeric" })}</>
      )}
    </p>
  );
}

export default async function EventsPage() {
  const { events, today, fed, missing } = await getMarketEvents();
  const scan = cachedNewsEvents();
  const upcoming = events.filter((event) => event.date >= today);
  const next = (match: (event: MarketEvent) => boolean) => upcoming.find(match);
  const fedDecision = next((event) => event.kind === "fomc");

  return (
    <AppShell contentClassName="dashboard-content" activeSection="events" dataSource="Federal Reserve, FRED, BLS, BEA, Census Bureau and Wikipedia">
      <section className="company-heading">
        <div>
          <p className="section-label">MARKETS</p>
          <div className="company-title-row">
            <h1>Market events</h1>
          </div>
          <p className="company-subtitle">
            What&apos;s scheduled that can move US markets: Federal Reserve decisions, the inflation and jobs reports,
            elections at home and abroad, and deadlines in the news.
          </p>
        </div>
      </section>

      <div className="events-next">
        <NextCard label="Next Fed decision" event={fedDecision} today={today}>
          {fed && <FedLine fed={fed} />}
          {fedDecision?.tags.includes("Projections") && <p className="events-next-detail">With new projections and the dot plot.</p>}
        </NextCard>
        <NextCard label="Next CPI report" event={next((event) => event.kind === "cpi")} today={today}>
          <p className="events-next-detail">Inflation for the month before.</p>
        </NextCard>
        <NextCard label="Next jobs report" event={next((event) => event.kind === "jobs")} today={today}>
          <p className="events-next-detail">Payrolls and the unemployment rate.</p>
        </NextCard>
        {(() => {
          const election = next((event) => event.kind === "election" && event.importance === "high");
          return (
            <NextCard label="Next major election" event={election} today={today}>
              {election && <p className="events-next-detail">{election.title}</p>}
            </NextCard>
          );
        })()}
      </div>

      <EventsTimeline
        events={events}
        today={today}
        aiConfigured={Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY)}
        initialNews={scan?.ok ? { events: scan.events, headlines: scan.headlines } : null}
      />

      <div className="news-footnote events-footnote">
        <p>
          Fed meetings come from the Federal Reserve&apos;s calendar and past decisions from FRED&apos;s target range; data
          releases from the BLS, BEA and Census Bureau calendars (BLS publishes the next year&apos;s dates late in the year);
          US elections, the new Congress, the inauguration and the September 30 funding deadline are set by law; elections
          in major economies come from Wikipedia&apos;s national electoral calendar. Times are Eastern.
        </p>
        <p>
          Summits, trade and tariff deadlines and other events in the news are found on request by AI, which reads the last
          two weeks of headlines from Google News and Finnhub and keeps only events a headline dates.
        </p>
        {missing.length > 0 && <p className="events-missing">Couldn&apos;t load {missing.join(", ")} just now, so those events are missing.</p>}
      </div>
    </AppShell>
  );
}
